# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Integration tests for the v2 fable and job endpoints.

There are two very important tests:
 - test_fable_expand -- the interactive building which UI does
 - test_fable_v2_basic_execute -- an actual execution
Those two must be preserved under any refactoring, and their failure is always
suspicious. The remaining ones test edge cases and funcionality which is
possibly subject of changes, and their failure may be a legitimate behavioral
change (such as change of return error code).

NOTE: there is not enough coverage in terms of job variety -- see the test_submit_job.py
"""

import io
import os
import pathlib
import zipfile

from fiab_core.fable import BlockInstance, PluginBlockFactoryId, PluginCompositeId

from forecastbox.api.types.fable import FableBuilder, FableSaveRequest
from forecastbox.api.types.jobs import EnvironmentSpecification
from forecastbox.routes.execution import ExecutionCreateResponse

from .conftest import testPluginId
from .utils import ensure_completed_v2


def _make_builder_source_only() -> FableBuilder:
    source_42 = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=testPluginId, factory="source_42"),
        configuration_values={},
        input_ids={},
    )
    return FableBuilder(blocks={"source_42": source_42})


def _make_builder_full(tmpdir: str) -> FableBuilder:
    source_42 = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=testPluginId, factory="source_42"),
        configuration_values={},
        input_ids={},
    )
    transform_increment = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=testPluginId, factory="transform_increment"),
        configuration_values={"amount": "1"},
        input_ids={"a": "source_42"},
    )
    product_join = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=testPluginId, factory="product_join"),
        configuration_values={},
        input_ids={"a": "transform_increment", "b": "source_42"},
    )
    sink_file = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=testPluginId, factory="sink_file"),
        configuration_values={"fname": f"{tmpdir}/output"},
        input_ids={"data": "product_join"},
    )
    return FableBuilder(
        blocks={
            "source_42": source_42,
            "transform_increment": transform_increment,
            "product_join": product_join,
            "sink_file": sink_file,
        }
    )


def test_fable_v2_save_and_retrieve(backend_client_with_auth):
    builder = _make_builder_source_only()
    builder.environment = EnvironmentSpecification(hosts=2, workers_per_host=4)
    payload = FableSaveRequest(
        builder=builder,
        display_name="Test Fable",
        display_description="A fable saved via the v2 API",
        tags=["test", "integration"],
    )

    # Save new definition
    response = backend_client_with_auth.post("/definition/create", json=payload.model_dump())
    assert response.is_success, response.text
    saved = response.json()
    assert "id" in saved
    assert saved["version"] == 1

    # Retrieve by id (latest version)
    response = backend_client_with_auth.get("/definition/get", params={"id": saved["id"]})
    assert response.is_success, response.text
    retrieved = response.json()
    assert retrieved["id"] == saved["id"]
    assert retrieved["version"] == 1
    assert retrieved["display_name"] == "Test Fable"
    assert retrieved["tags"] == ["test", "integration"]
    assert retrieved["builder"]["blocks"]["source_42"]["factory_id"]["factory"] == "source_42"
    assert retrieved["builder"]["environment"]["hosts"] == 2
    assert retrieved["builder"]["environment"]["workers_per_host"] == 4

    # Saving again with the same id creates a new version
    payload2 = FableSaveRequest(builder=_make_builder_source_only(), display_name="Test Fable v2")
    response = backend_client_with_auth.post("/definition/update", json={**payload2.model_dump(), "id": saved["id"]})
    assert response.is_success, response.text
    saved2 = response.json()
    assert saved2["id"] == saved["id"]
    assert saved2["version"] == 2

    # Retrieve latest returns version 2
    response = backend_client_with_auth.get("/definition/get", params={"id": saved["id"]})
    assert response.is_success, response.text
    latest = response.json()
    assert latest["version"] == 2
    assert latest["display_name"] == "Test Fable v2"
    assert latest["builder"]["environment"] is None

    # Retrieve specific version 1 still works
    response = backend_client_with_auth.get("/definition/get", params={"id": saved["id"], "version": 1})
    assert response.is_success, response.text
    assert response.json()["version"] == 1
    assert response.json()["display_name"] == "Test Fable"


def test_fable_v2_retrieve_nonexistent(backend_client_with_auth):
    response = backend_client_with_auth.get("/definition/get", params={"id": "does-not-exist"})
    assert response.status_code == 404


def test_fable_v2_upsert_nonexistent_id(backend_client_with_auth):
    """Attempting to add a version to a non-existent id returns 404."""
    builder = _make_builder_source_only()
    payload = FableSaveRequest(builder=builder)
    response = backend_client_with_auth.post("/definition/update", json={**payload.model_dump(), "id": "no-such-id"})
    assert response.status_code == 404


def test_fable_v2_compile_latest_version(tmpdir, backend_client_with_auth):
    """A builder saved via upsert_v2 can be compiled by reference (no version = latest)."""
    builder = _make_builder_full(str(tmpdir))
    payload = FableSaveRequest(builder=builder, display_name="Compile Test")
    save_resp = backend_client_with_auth.post("/definition/create", json=payload.model_dump())
    assert save_resp.is_success, save_resp.text
    fable_id = save_resp.json()["id"]

    compile_resp = backend_client_with_auth.put("/definition/building/compile", json={"id": fable_id})
    assert compile_resp.is_success, compile_resp.text
    spec = compile_resp.json()
    assert "job" in spec
    assert "environment" in spec
    assert len(spec["job"]["job_instance"]["tasks"]) > 0


def test_fable_v2_compile_specific_version(tmpdir, backend_client_with_auth):
    """Omitting version resolves to latest; specifying version compiles that exact version."""
    builder_v1 = _make_builder_full(str(tmpdir.mkdir("v1")))
    payload_v1 = FableSaveRequest(builder=builder_v1, display_name="Version Test v1")
    save_resp = backend_client_with_auth.post("/definition/create", json=payload_v1.model_dump())
    assert save_resp.is_success, save_resp.text
    fable_id = save_resp.json()["id"]

    # Save a second version with a different builder (source-only, no sink)
    source_only = _make_builder_source_only()
    payload_v2 = FableSaveRequest(builder=source_only, display_name="Version Test v2")
    save_resp2 = backend_client_with_auth.post("/definition/update", json={**payload_v2.model_dump(), "id": fable_id})
    assert save_resp2.is_success, save_resp2.text
    assert save_resp2.json()["version"] == 2

    # Compile v1 explicitly — should produce tasks (has a sink)
    resp_v1 = backend_client_with_auth.put("/definition/building/compile", json={"id": fable_id, "version": 1})
    assert resp_v1.is_success, resp_v1.text
    assert len(resp_v1.json()["job"]["job_instance"]["tasks"]) > 0

    # Compile latest (v2, source-only, no sink) — produces empty tasks
    resp_latest = backend_client_with_auth.put("/definition/building/compile", json={"id": fable_id})
    assert resp_latest.is_success, resp_latest.text
    assert len(resp_latest.json()["job"]["job_instance"]["tasks"]) == 0


def test_fable_v2_compile_nonexistent(backend_client_with_auth):
    """Compiling an unknown fable id returns 404."""
    resp = backend_client_with_auth.put("/definition/building/compile", json={"id": "does-not-exist"})
    assert resp.status_code == 404


def test_fable_expand(tmpdir, backend_client_with_auth):
    response = backend_client_with_auth.get("/definition/building/catalogue").raise_for_status()
    assert len(response.json()) > 0

    builder = FableBuilder(blocks={})
    response = backend_client_with_auth.request(url="/definition/building/expand", method="put", json=builder.model_dump())
    assert response.json()["possible_sources"] == [{"plugin": {"store": "localTest", "local": "single"}, "factory": "source_42"}]
    assert response.json()["possible_expansions"] == {}

    source_42 = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=testPluginId, factory="source_42"),
        configuration_values={},
        input_ids={},
    )
    blocks = {"source_42": source_42}
    builder = FableBuilder(blocks=blocks)
    response = backend_client_with_auth.request(url="/definition/building/expand", method="put", json=builder.model_dump())
    assert response.json()["possible_expansions"] == {
        "source_42": [
            {"plugin": {"store": "localTest", "local": "single"}, "factory": "transform_increment"},
            {"plugin": {"store": "localTest", "local": "single"}, "factory": "product_join"},
            {"plugin": {"store": "localTest", "local": "single"}, "factory": "sink_file"},
        ]
    }

    transform_increment = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=testPluginId, factory="transform_increment"),
        configuration_values={"amount": "2"},
        input_ids={"a": "source_42"},
    )
    blocks["transform_increment"] = transform_increment
    builder = FableBuilder(blocks=blocks)
    response = backend_client_with_auth.request(url="/definition/building/expand", method="put", json=builder.model_dump())
    assert response.json()["possible_expansions"]["transform_increment"] == [
        {"plugin": {"store": "localTest", "local": "single"}, "factory": "transform_increment"},
        {"plugin": {"store": "localTest", "local": "single"}, "factory": "product_join"},
        {"plugin": {"store": "localTest", "local": "single"}, "factory": "sink_file"},
    ]

    product_join = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=testPluginId, factory="product_join"),
        configuration_values={},
        input_ids={"a": "transform_increment", "b": "source_42"},
    )
    sink_file = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=testPluginId, factory="sink_file"),
        configuration_values={"fname": f"{tmpdir}/output"},
        input_ids={"data": "product_join"},
    )
    blocks["product_join"] = product_join
    blocks["sink_file"] = sink_file

    builder = FableBuilder(blocks=blocks)
    response = backend_client_with_auth.request(url="/definition/building/expand", method="put", json=builder.model_dump())
    assert len(response.json()["possible_expansions"]["sink_file"]) == 0
    assert len(response.json()["block_errors"]) == 0

    save_req = FableSaveRequest(builder=builder)
    save_resp = backend_client_with_auth.post("/definition/create", json=save_req.model_dump())
    assert save_resp.is_success, save_resp.text
    fable_id = save_resp.json()["id"]
    compile_resp = backend_client_with_auth.put("/definition/building/compile", json={"id": fable_id})
    assert compile_resp.is_success, compile_resp.text


def test_fable_v2_basic_execute(tmpdir, backend_client_with_auth):
    builder = _make_builder_full(tmpdir)
    save_req = FableSaveRequest(builder=builder)
    save_resp = backend_client_with_auth.post("/definition/create", json=save_req.model_dump())
    assert save_resp.is_success, save_resp.text
    fable_id = save_resp.json()["id"]
    exec_response = backend_client_with_auth.post("/execution/create", json={"definition_id": fable_id})
    assert exec_response.is_success, exec_response.text
    response = ExecutionCreateResponse(**exec_response.json())
    execution_id = response.execution_id
    assert response.attempt_count == 1
    ensure_completed_v2(backend_client_with_auth, execution_id, sleep=1, attempts=120)

    output = pathlib.Path(tmpdir) / "output"
    assert output.read_text() == "85"  # the output of 42 + 1 + 42, thats what the job is configured to do
    output.unlink()

    list_resp = backend_client_with_auth.get("/execution/list")
    assert list_resp.is_success, list_resp.text
    data = list_resp.json()
    assert "executions" in data
    assert "total" in data
    assert "page" in data
    assert "page_size" in data
    assert "total_pages" in data
    assert data["total"] >= 1
    ids = [e["execution_id"] for e in data["executions"]]
    assert execution_id in ids

    resp = backend_client_with_auth.get("/execution/definition", params={"execution_id": execution_id})
    assert resp.is_success, resp.text
    data = resp.json()
    assert data["definition_id"] == fable_id
    assert data["definition_version"] == 1
    assert "blocks" in data
    assert data["blocks"] is not None

    restart_resp = backend_client_with_auth.post("/execution/restart", json={"execution_id": execution_id})
    assert restart_resp.is_success, restart_resp.text
    data = restart_resp.json()
    assert data["execution_id"] == execution_id
    assert data["attempt_count"] == 2

    # Latest-attempt status reflects attempt 2
    status_resp = backend_client_with_auth.get("/execution/get", params={"execution_id": execution_id})
    assert status_resp.is_success, status_resp.text
    assert status_resp.json()["attempt_count"] == 2

    # Attempt 1 is still accessible explicitly
    status_1_resp = backend_client_with_auth.get("/execution/get", params={"execution_id": execution_id, "attempt_count": 1})
    assert status_1_resp.is_success, status_1_resp.text
    assert status_1_resp.json()["attempt_count"] == 1

    ensure_completed_v2(backend_client_with_auth, execution_id, sleep=1, attempts=120)
    assert output.read_text() == "85"  # the output of 42 + 1 + 42, thats what the job is configured to do

    avail_resp = backend_client_with_auth.get("/execution/outputAvailability", params={"execution_id": execution_id})
    assert avail_resp.is_success, avail_resp.text
    available_tasks = avail_resp.json()
    assert isinstance(available_tasks, list)
    assert len(available_tasks) > 0

    logs_resp = backend_client_with_auth.get("/execution/logs", params={"execution_id": execution_id})
    assert logs_resp.is_success, logs_resp.text
    assert "zip" in logs_resp.headers["content-type"]
    with zipfile.ZipFile(io.BytesIO(logs_resp.content), "r") as zf:
        # NOTE dbEntity, gwState, gateway, controller, host0, host0.dsr, host0.shm, host0.w1, host0.w2
        expected_log_count = 9
        assert len(zf.namelist()) == expected_log_count or os.getenv("FIAB_LOGSTDOUT", "nay") == "yea"


def test_submit_job_v2_execute_missing_definition_id(backend_client_with_auth):
    """Omitting job_definition_id (required field) returns 422."""
    response = backend_client_with_auth.post("/execution/create", json={})
    assert response.status_code == 422


def test_submit_job_v2_execute_unknown_definition(backend_client_with_auth):
    """Referencing a non-existent JobDefinition returns 404."""
    payload = {"definition_id": "does-not-exist"}
    response = backend_client_with_auth.post("/execution/create", json=payload)
    assert response.status_code == 404


def test_submit_job_v2_read_status_not_found(backend_client_with_auth):
    """GET /execution/get with unknown execution_id returns 404."""
    resp = backend_client_with_auth.get("/execution/get", params={"execution_id": "nonexistent-exec-id"})
    assert resp.status_code == 404


def test_submit_job_v2_read_specification_not_found(backend_client_with_auth):
    """GET /execution/definition with unknown execution_id returns 404."""
    resp = backend_client_with_auth.get("/execution/definition", params={"execution_id": "nonexistent-exec-id"})
    assert resp.status_code == 404


def test_submit_job_v2_restart_not_found(backend_client_with_auth):
    """POST /execution/restart with unknown execution_id returns 404."""
    resp = backend_client_with_auth.post("/execution/restart", json={"execution_id": "nonexistent-exec-id"})
    assert resp.status_code == 404
