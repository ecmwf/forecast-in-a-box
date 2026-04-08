# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Integration tests for the v2 blueprint and job endpoints.

There are two very important tests:
 - test_blueprint_expand -- the interactive building which UI does
 - test_blueprint_basic_execute -- an actual execution
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
from typing import Any, get_args

import httpx
from fiab_core.fable import BlockInstance, PluginBlockFactoryId, PluginCompositeId

from forecastbox.domain.blueprint.cascade import EnvironmentSpecification
from forecastbox.domain.blueprint.service import BlueprintBuilder, BlueprintSaveCommand
from forecastbox.domain.variables.automatic import AvailableAutomaticVariables
from forecastbox.routes.run import RunCreateResponse

from .conftest import testPluginId
from .utils import retry_until


def ensure_completed_v2(backend_client: httpx.Client, job_id: str, sleep: float = 0.5, attempts: int = 20) -> None:
    def do_action() -> Any:
        response = backend_client.get("/run/get", params={"run_id": job_id}, timeout=10)
        assert response.is_success, response.text
        return response.json()

    def verify_ok(data: Any) -> bool | None:
        if data["status"] == "failed":
            raise RuntimeError(f"Job {job_id} failed: {data}")
        assert data["status"] in {"submitted", "running", "completed"}, data["status"]
        return True if data["status"] == "completed" else None

    retry_until(do_action, verify_ok, attempts=attempts, sleep=sleep, error_msg=f"Failed to finish job {job_id}")


def _make_builder_source_only() -> BlueprintBuilder:
    source_42 = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=testPluginId, factory="source_42"),
        configuration_values={},
        input_ids={},
    )
    return BlueprintBuilder(blocks={"source_42": source_42})


def _make_builder_full(tmpdir: str) -> BlueprintBuilder:
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
    sink_main = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=testPluginId, factory="sink_file"),
        configuration_values={"fname": f"{tmpdir}/output${{runId}}.main.txt"},
        input_ids={"data": "product_join"},
    )
    source_time = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=testPluginId, factory="source_text"),
        configuration_values={"text": "${submitDatetime};${startDatetime}"},
        input_ids={},
    )
    sink_time = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=testPluginId, factory="sink_file"),
        configuration_values={"fname": f"{tmpdir}/output${{runId}}.time.txt"},
        input_ids={"data": "source_time"},
    )
    return BlueprintBuilder(
        blocks={
            "source_42": source_42,
            "transform_increment": transform_increment,
            "product_join": product_join,
            "sink_main": sink_main,
            "source_time": source_time,
            "sink_time": sink_time,
        }
    )


def test_blueprint_save_and_retrieve(backend_client_with_auth: httpx.Client) -> None:
    builder = _make_builder_source_only()
    builder.environment = EnvironmentSpecification(hosts=2, workers_per_host=4)
    payload = BlueprintSaveCommand(
        builder=builder,
        display_name="Test Blueprint",
        display_description="A blueprint saved via the v2 API",
        tags=["test", "integration"],
    )

    # Save new blueprint
    response = backend_client_with_auth.post("/blueprint/create", json=payload.model_dump())
    assert response.is_success, response.text
    saved = response.json()
    assert "blueprint_id" in saved
    assert saved["version"] == 1

    # Retrieve by id (latest version)
    response = backend_client_with_auth.get("/blueprint/get", params={"blueprint_id": saved["blueprint_id"]})
    assert response.is_success, response.text
    retrieved = response.json()
    assert retrieved["blueprint_id"] == saved["blueprint_id"]
    assert retrieved["version"] == 1
    assert retrieved["display_name"] == "Test Blueprint"
    assert retrieved["tags"] == ["test", "integration"]
    assert retrieved["builder"]["blocks"]["source_42"]["factory_id"]["factory"] == "source_42"
    assert retrieved["builder"]["environment"]["hosts"] == 2
    assert retrieved["builder"]["environment"]["workers_per_host"] == 4

    # Saving again with the same id creates a new version
    payload2 = BlueprintSaveCommand(builder=_make_builder_source_only(), display_name="Test Blueprint v2")
    response = backend_client_with_auth.post(
        "/blueprint/update",
        json={**payload2.model_dump(), "blueprint_id": saved["blueprint_id"], "version": saved["version"]},
    )
    assert response.is_success, response.text
    saved2 = response.json()
    assert saved2["blueprint_id"] == saved["blueprint_id"]
    assert saved2["version"] == 2

    # Retrieve latest returns version 2
    response = backend_client_with_auth.get("/blueprint/get", params={"blueprint_id": saved["blueprint_id"]})
    assert response.is_success, response.text
    latest = response.json()
    assert latest["version"] == 2
    assert latest["display_name"] == "Test Blueprint v2"
    assert latest["builder"]["environment"] is None

    # Retrieve specific version 1 still works
    response = backend_client_with_auth.get("/blueprint/get", params={"blueprint_id": saved["blueprint_id"], "version": 1})
    assert response.is_success, response.text
    assert response.json()["version"] == 1
    assert response.json()["display_name"] == "Test Blueprint"


def test_blueprint_retrieve_nonexistent(backend_client_with_auth: httpx.Client) -> None:
    response = backend_client_with_auth.get("/blueprint/get", params={"blueprint_id": "does-not-exist"})
    assert response.status_code == 404


def test_blueprint_upsert_nonexistent_id(backend_client_with_auth: httpx.Client) -> None:
    """Attempting to add a version to a non-existent id returns 404."""
    builder = _make_builder_source_only()
    payload = BlueprintSaveCommand(builder=builder)
    response = backend_client_with_auth.post("/blueprint/update", json={**payload.model_dump(), "blueprint_id": "no-such-id", "version": 1})
    assert response.status_code == 404


def test_blueprint_expand(tmpdir: Any, backend_client_with_auth: httpx.Client) -> None:
    response = backend_client_with_auth.get("/blueprint/catalogue").raise_for_status()
    assert len(response.json()) > 0

    builder = BlueprintBuilder(blocks={})
    response = backend_client_with_auth.request(url="/blueprint/expand", method="put", json=builder.model_dump())
    assert response.json()["possible_sources"] == [
        {"plugin": {"store": "localTest", "local": "single"}, "factory": "source_42"},
        {"plugin": {"store": "localTest", "local": "single"}, "factory": "source_text"},
    ]
    assert response.json()["possible_expansions"] == {}

    source_42 = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=testPluginId, factory="source_42"),
        configuration_values={},
        input_ids={},
    )
    blocks = {"source_42": source_42}
    builder = BlueprintBuilder(blocks=blocks)
    response = backend_client_with_auth.request(url="/blueprint/expand", method="put", json=builder.model_dump())
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
    builder = BlueprintBuilder(blocks=blocks)
    response = backend_client_with_auth.request(url="/blueprint/expand", method="put", json=builder.model_dump())
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
    # Using a missing variable should fail validation
    sink_file_bad = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=testPluginId, factory="sink_file"),
        configuration_values={"fname": f"{tmpdir}/output${{missingVariable}}.main.txt"},
        input_ids={"data": "product_join"},
    )
    blocks["product_join"] = product_join
    blocks["sink_file"] = sink_file_bad

    builder = BlueprintBuilder(blocks=blocks)
    response = backend_client_with_auth.request(url="/blueprint/expand", method="put", json=builder.model_dump())
    assert "sink_file" in response.json()["block_errors"]

    # Using a known variable should pass validation
    sink_file_ok = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=testPluginId, factory="sink_file"),
        configuration_values={"fname": f"{tmpdir}/output${{runId}}.main.txt"},
        input_ids={"data": "product_join"},
    )
    blocks["sink_file"] = sink_file_ok

    builder = BlueprintBuilder(blocks=blocks)
    response = backend_client_with_auth.request(url="/blueprint/expand", method="put", json=builder.model_dump())
    assert len(response.json()["possible_expansions"]["sink_file"]) == 0
    assert len(response.json()["block_errors"]) == 0


def test_blueprint_basic_execute(tmpdir: Any, backend_client_with_auth: httpx.Client) -> None:
    builder = _make_builder_full(tmpdir)
    save_req = BlueprintSaveCommand(builder=builder)
    save_resp = backend_client_with_auth.post("/blueprint/create", json=save_req.model_dump())
    assert save_resp.is_success, save_resp.text
    blueprint_id = save_resp.json()["blueprint_id"]
    exec_response = backend_client_with_auth.post("/run/create", json={"blueprint_id": blueprint_id})
    assert exec_response.is_success, exec_response.text
    response = RunCreateResponse(**exec_response.json())
    run_id = response.run_id
    assert response.attempt_count == 1
    ensure_completed_v2(backend_client_with_auth, run_id, sleep=1, attempts=120)

    outputMain = pathlib.Path(f"{tmpdir}/output{run_id}.main.txt")
    assert outputMain.read_text() == "85"  # the output of 42 + 1 + 42, thats what the job is configured to do
    outputMain.unlink()
    status_resp = backend_client_with_auth.get("/run/get", params={"run_id": run_id})
    assert status_resp.is_success, status_resp.text
    created_at = status_resp.json()["created_at"]
    outputTime = pathlib.Path(f"{tmpdir}/output{run_id}.time.txt")
    # Both submitDatetime and startDatetime equal created_at on the first run.
    # created_at is at higher precision than the second-resolution variable values.
    created_at_sec = created_at.split(".", 1)[0]
    assert outputTime.read_text() == f"{created_at_sec};{created_at_sec}"
    outputTime.unlink()

    list_resp = backend_client_with_auth.get("/run/list")
    assert list_resp.is_success, list_resp.text
    data = list_resp.json()
    assert "runs" in data
    assert "total" in data
    assert "page" in data
    assert "page_size" in data
    assert "total_pages" in data
    assert data["total"] >= 1
    ids = [e["run_id"] for e in data["runs"]]
    assert run_id in ids

    restart_resp = backend_client_with_auth.post("/run/restart", json={"run_id": run_id, "attempt_count": 1})
    assert restart_resp.is_success, restart_resp.text
    data = restart_resp.json()
    assert data["run_id"] == run_id
    assert data["attempt_count"] == 2

    # Latest-attempt status reflects attempt 2
    status_resp = backend_client_with_auth.get("/run/get", params={"run_id": run_id})
    assert status_resp.is_success, status_resp.text
    assert status_resp.json()["attempt_count"] == 2

    # Attempt 1 is still accessible explicitly
    status_1_resp = backend_client_with_auth.get("/run/get", params={"run_id": run_id, "attempt_count": 1})
    assert status_1_resp.is_success, status_1_resp.text
    assert status_1_resp.json()["attempt_count"] == 1

    ensure_completed_v2(backend_client_with_auth, run_id, sleep=1, attempts=120)
    assert outputMain.read_text() == "85"  # the output of 42 + 1 + 42, thats what the job is configured to do

    # After restart: submitDatetime must still equal original created_at; startDatetime
    # must reflect the restart's own created_at (attempt 2).
    status_restarted_resp = backend_client_with_auth.get("/run/get", params={"run_id": run_id})
    assert status_restarted_resp.is_success, status_restarted_resp.text
    created_at_restarted = status_restarted_resp.json()["created_at"].split(".", 1)[0]
    assert outputTime.read_text() == f"{created_at_sec};{created_at_restarted}"

    avail_resp = backend_client_with_auth.get("/run/outputAvailability", params={"run_id": run_id})
    assert avail_resp.is_success, avail_resp.text
    available_tasks = avail_resp.json()
    assert isinstance(available_tasks, list)
    assert len(available_tasks) > 0

    logs_resp = backend_client_with_auth.get("/run/logs", params={"run_id": run_id})
    assert logs_resp.is_success, logs_resp.text
    assert "zip" in logs_resp.headers["content-type"]
    with zipfile.ZipFile(io.BytesIO(logs_resp.content), "r") as zf:
        # NOTE dbEntity, gwState, gateway, controller, host0, host0.dsr, host0.shm, host0.w1, host0.w2
        expected_log_count = 9
        assert len(zf.namelist()) == expected_log_count or os.getenv("FIAB_LOGSTDOUT", "nay") == "yea"


def test_submit_job_v2_execute_missing_blueprint_id(backend_client_with_auth: httpx.Client) -> None:
    """Omitting blueprint_id (required field) returns 422."""
    response = backend_client_with_auth.post("/run/create", json={})
    assert response.status_code == 422


def test_submit_job_v2_execute_unknown_definition(backend_client_with_auth: httpx.Client) -> None:
    """Referencing a non-existent Blueprint returns 404."""
    payload = {"blueprint_id": "does-not-exist"}
    response = backend_client_with_auth.post("/run/create", json=payload)
    assert response.status_code == 404


def test_submit_job_v2_read_status_not_found(backend_client_with_auth: httpx.Client) -> None:
    """GET /execution/get with unknown run_id returns 404."""
    resp = backend_client_with_auth.get("/run/get", params={"run_id": "nonexistent-exec-id"})
    assert resp.status_code == 404


def test_submit_job_v2_restart_not_found(backend_client_with_auth: httpx.Client) -> None:
    """POST /execution/restart with unknown run_id returns 404."""
    resp = backend_client_with_auth.post("/run/restart", json={"run_id": "nonexistent-exec-id", "attempt_count": 1})
    assert resp.status_code == 404


def test_list_available_variables(backend_client_with_auth: httpx.Client) -> None:
    """The variables/list endpoint returns exactly the set of AvailableAutomaticVariables."""
    response = backend_client_with_auth.get("/blueprint/variables/list")
    assert response.is_success, response.text
    data = response.json()
    assert isinstance(data, list)
    returned_names = {item["name"] for item in data}
    expected_names = set(get_args(AvailableAutomaticVariables))
    assert returned_names == expected_names
    for item in data:
        assert "display_name" in item
        assert "valueExample" in item
        assert item["display_name"]
        assert item["valueExample"]
