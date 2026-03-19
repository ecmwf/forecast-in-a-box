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

The tests currently rely on a data file and a mocked ecmwf plugin (where
the mocking is actually hacked inside the non-test code). We would rather
test the ecmwf plugin only in the nonpytest scenario, and here utilize
some sort of test plugin or a proper mock.

Therefore there is not enough coverage in terms of job variety -- see the
test_submit_job.py
"""

from fiab_core.fable import BlockInstance, PluginBlockFactoryId, PluginCompositeId

from forecastbox.api.types.fable import FableBuilder, FableSaveRequest
from forecastbox.api.types.jobs import EnvironmentSpecification, JobExecuteResponse

from .utils import ensure_completed_v2


def _make_builder_source_only() -> FableBuilder:
    plugin_id = PluginCompositeId(store="ecmwf", local="ecmwf-base")
    source = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=plugin_id, factory="ekdSource"),
        configuration_values={"source": "ecmwf-open-data", "date": "2026-01-01", "expver": "0001"},
        input_ids={},
    )
    return FableBuilder(blocks={"source1": source})


def _make_builder_full(tmpdir: str) -> FableBuilder:
    plugin_id = PluginCompositeId(store="ecmwf", local="ecmwf-base")
    source = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=plugin_id, factory="ekdSource"),
        configuration_values={"source": "ecmwf-open-data", "date": "2026-02-18", "expver": "0001"},
        input_ids={},
    )
    temporal_mean = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=plugin_id, factory="temporalStatistics"),
        configuration_values={"param": "2t", "statistic": "mean"},
        input_ids={"dataset": "source1"},
    )
    ensemble_mean = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=plugin_id, factory="ensembleStatistics"),
        configuration_values={"param": "2t", "statistic": "mean"},
        input_ids={"dataset": "temporalMean"},
    )
    sink = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=plugin_id, factory="zarrSink"),
        configuration_values={"path": f"{tmpdir}/output.zarr"},
        input_ids={"dataset": "ensembleMean"},
    )
    return FableBuilder(
        blocks={
            "source1": source,
            "temporalMean": temporal_mean,
            "ensembleMean": ensemble_mean,
            "sinkMean": sink,
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
    response = backend_client_with_auth.post("/fable/upsert", json=payload.model_dump())
    assert response.is_success, response.text
    saved = response.json()
    assert "id" in saved
    assert saved["version"] == 1

    # Retrieve by id (latest version)
    response = backend_client_with_auth.get("/fable/retrieve", params={"fable_id": saved["id"]})
    assert response.is_success, response.text
    retrieved = response.json()
    assert retrieved["id"] == saved["id"]
    assert retrieved["version"] == 1
    assert retrieved["display_name"] == "Test Fable"
    assert retrieved["tags"] == ["test", "integration"]
    assert retrieved["builder"]["blocks"]["source1"]["factory_id"]["factory"] == "ekdSource"
    assert retrieved["builder"]["environment"]["hosts"] == 2
    assert retrieved["builder"]["environment"]["workers_per_host"] == 4

    # Saving again with the same id creates a new version
    payload2 = FableSaveRequest(builder=_make_builder_source_only(), display_name="Test Fable v2")
    response = backend_client_with_auth.post("/fable/upsert", params={"fable_id": saved["id"]}, json=payload2.model_dump())
    assert response.is_success, response.text
    saved2 = response.json()
    assert saved2["id"] == saved["id"]
    assert saved2["version"] == 2

    # Retrieve latest returns version 2
    response = backend_client_with_auth.get("/fable/retrieve", params={"fable_id": saved["id"]})
    assert response.is_success, response.text
    latest = response.json()
    assert latest["version"] == 2
    assert latest["display_name"] == "Test Fable v2"
    assert latest["builder"]["environment"] is None

    # Retrieve specific version 1 still works
    response = backend_client_with_auth.get("/fable/retrieve", params={"fable_id": saved["id"], "version": 1})
    assert response.is_success, response.text
    assert response.json()["version"] == 1
    assert response.json()["display_name"] == "Test Fable"


def test_fable_v2_retrieve_nonexistent(backend_client_with_auth):
    response = backend_client_with_auth.get("/fable/retrieve", params={"fable_id": "does-not-exist"})
    assert response.status_code == 404


def test_fable_v2_upsert_nonexistent_id(backend_client_with_auth):
    """Attempting to add a version to a non-existent id returns 404."""
    builder = _make_builder_source_only()
    payload = FableSaveRequest(builder=builder)
    response = backend_client_with_auth.post("/fable/upsert", params={"fable_id": "no-such-id"}, json=payload.model_dump())
    assert response.status_code == 404


def test_fable_v2_compile_latest_version(tmpdir, backend_client_with_auth):
    """A builder saved via upsert_v2 can be compiled by reference (no version = latest)."""
    builder = _make_builder_full(str(tmpdir))
    payload = FableSaveRequest(builder=builder, display_name="Compile Test")
    save_resp = backend_client_with_auth.post("/fable/upsert", json=payload.model_dump())
    assert save_resp.is_success, save_resp.text
    fable_id = save_resp.json()["id"]

    compile_resp = backend_client_with_auth.put("/fable/compile", json={"id": fable_id})
    assert compile_resp.is_success, compile_resp.text
    spec = compile_resp.json()
    assert "job" in spec
    assert "environment" in spec
    assert len(spec["job"]["job_instance"]["tasks"]) > 0


def test_fable_v2_compile_specific_version(tmpdir, backend_client_with_auth):
    """Omitting version resolves to latest; specifying version compiles that exact version."""
    builder_v1 = _make_builder_full(str(tmpdir.mkdir("v1")))
    payload_v1 = FableSaveRequest(builder=builder_v1, display_name="Version Test v1")
    save_resp = backend_client_with_auth.post("/fable/upsert", json=payload_v1.model_dump())
    assert save_resp.is_success, save_resp.text
    fable_id = save_resp.json()["id"]

    # Save a second version with a different builder (source-only, no sink)
    source_only = _make_builder_source_only()
    payload_v2 = FableSaveRequest(builder=source_only, display_name="Version Test v2")
    save_resp2 = backend_client_with_auth.post("/fable/upsert", params={"fable_id": fable_id}, json=payload_v2.model_dump())
    assert save_resp2.is_success, save_resp2.text
    assert save_resp2.json()["version"] == 2

    # Compile v1 explicitly — should produce tasks (has a sink)
    resp_v1 = backend_client_with_auth.put("/fable/compile", json={"id": fable_id, "version": 1})
    assert resp_v1.is_success, resp_v1.text
    assert len(resp_v1.json()["job"]["job_instance"]["tasks"]) > 0

    # Compile latest (v2, source-only, no sink) — produces empty tasks
    resp_latest = backend_client_with_auth.put("/fable/compile", json={"id": fable_id})
    assert resp_latest.is_success, resp_latest.text
    assert len(resp_latest.json()["job"]["job_instance"]["tasks"]) == 0


def test_fable_v2_compile_nonexistent(backend_client_with_auth):
    """Compiling an unknown fable id returns 404."""
    resp = backend_client_with_auth.put("/fable/compile", json={"id": "does-not-exist"})
    assert resp.status_code == 404


def test_fable_expand(tmpdir, backend_client_with_auth):
    response = backend_client_with_auth.get("/fable/catalogue").raise_for_status()
    assert len(response.json()) > 0

    builder = FableBuilder(blocks={})
    response = backend_client_with_auth.request(url="/fable/expand", method="put", json=builder.model_dump())
    assert len(response.json()["possible_sources"]) == 1
    assert len(response.json()["possible_expansions"]) == 0

    pluginId = PluginCompositeId(store="ecmwf", local="ecmwf-base")
    source = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=pluginId, factory="ekdSource"),
        configuration_values={
            "source": "ecmwf-open-data",
            "date": "2026-02-18",
            "expver": "0001",
        },
        input_ids={},
    )
    blocks = {"source1": source}
    builder = FableBuilder(blocks=blocks)
    response = backend_client_with_auth.request(url="/fable/expand", method="put", json=builder.model_dump())
    assert len(response.json()["possible_expansions"]["source1"]) > 0

    temporalMean = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=pluginId, factory="temporalStatistics"),
        configuration_values={"param": "2t", "statistic": "mean"},
        input_ids={"dataset": "source1"},
    )
    blocks["temporalMean"] = temporalMean
    builder = FableBuilder(blocks=blocks)
    response = backend_client_with_auth.request(url="/fable/expand", method="put", json=builder.model_dump())
    assert len(response.json()["possible_expansions"]["temporalMean"]) > 0

    block = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=pluginId, factory="ensembleStatistics"),
        configuration_values={"param": "2t", "statistic": "mean"},
        input_ids={"dataset": "temporalMean"},
    )
    sink = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=pluginId, factory="zarrSink"),
        configuration_values={"path": f"{tmpdir}/output.zarr"},
        input_ids={"dataset": f"ensembleMean"},
    )
    blocks[f"ensembleMean"] = block
    blocks[f"sinkMean"] = sink

    builder = FableBuilder(blocks=blocks)
    response = backend_client_with_auth.request(url="/fable/expand", method="put", json=builder.model_dump())
    assert len(response.json()["possible_expansions"]["sinkMean"]) == 0
    assert len(response.json()["block_errors"]) == 0

    save_req = FableSaveRequest(builder=builder)
    save_resp = backend_client_with_auth.post("/fable/upsert", json=save_req.model_dump())
    assert save_resp.is_success, save_resp.text
    fable_id = save_resp.json()["id"]
    compile_resp = backend_client_with_auth.put("/fable/compile", json={"id": fable_id})
    assert compile_resp.is_success, compile_resp.text


def test_fable_v2_basic_execute(tmpdir, backend_client_with_auth):
    builder = _make_builder_full(tmpdir)
    save_req = FableSaveRequest(builder=builder)
    save_resp = backend_client_with_auth.post("/fable/upsert", json=save_req.model_dump())
    assert save_resp.is_success, save_resp.text
    fable_id = save_resp.json()["id"]
    exec_response = backend_client_with_auth.post("/job/execute", json={"job_definition_id": fable_id})
    assert exec_response.is_success, exec_response.text
    response = JobExecuteResponse(**exec_response.json())
    execution_id = response.execution_id
    assert response.attempt_count == 1
    ensure_completed_v2(backend_client_with_auth, execution_id, sleep=1, attempts=120)

    list_resp = backend_client_with_auth.get("/job/status")
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

    resp = backend_client_with_auth.get(f"/job/{execution_id}/specification")
    assert resp.is_success, resp.text
    data = resp.json()
    assert data["definition_id"] == fable_id
    assert data["definition_version"] == 1
    assert "blocks" in data
    assert data["blocks"] is not None

    restart_resp = backend_client_with_auth.post(f"/job/{execution_id}/restart")
    assert restart_resp.is_success, restart_resp.text
    data = restart_resp.json()
    assert data["execution_id"] == execution_id
    assert data["attempt_count"] == 2

    # Latest-attempt status reflects attempt 2
    status_resp = backend_client_with_auth.get(f"/job/{execution_id}/status")
    assert status_resp.is_success, status_resp.text
    assert status_resp.json()["attempt_count"] == 2

    # Attempt 1 is still accessible explicitly
    status_1_resp = backend_client_with_auth.get(f"/job/{execution_id}/status", params={"attempt_count": 1})
    assert status_1_resp.is_success, status_1_resp.text
    assert status_1_resp.json()["attempt_count"] == 1

    ensure_completed_v2(backend_client_with_auth, execution_id, sleep=1, attempts=120)

    avail_resp = backend_client_with_auth.get(f"/job/{execution_id}/available")
    assert avail_resp.is_success, avail_resp.text
    available_tasks = avail_resp.json()
    assert isinstance(available_tasks, list)
    assert len(available_tasks) > 0


def test_submit_job_v2_execute_missing_definition_id(backend_client_with_auth):
    """Omitting job_definition_id (required field) returns 422."""
    response = backend_client_with_auth.post("/job/execute", json={})
    assert response.status_code == 422


def test_submit_job_v2_execute_unknown_definition(backend_client_with_auth):
    """Referencing a non-existent JobDefinition returns 404."""
    payload = {"job_definition_id": "does-not-exist"}
    response = backend_client_with_auth.post("/job/execute", json=payload)
    assert response.status_code == 404


def test_submit_job_v2_read_status_not_found(backend_client_with_auth):
    """GET /job/{execution_id}/status with unknown id returns 404."""
    resp = backend_client_with_auth.get("/job/nonexistent-exec-id/status")
    assert resp.status_code == 404


def test_submit_job_v2_read_specification_not_found(backend_client_with_auth):
    """GET /job/{execution_id}/specification with unknown id returns 404."""
    resp = backend_client_with_auth.get("/job/nonexistent-exec-id/specification")
    assert resp.status_code == 404


def test_submit_job_v2_restart_not_found(backend_client_with_auth):
    """POST /job/{execution_id}/restart with unknown id returns 500 (execution not found)."""
    resp = backend_client_with_auth.post("/job/nonexistent-exec-id/restart")
    assert resp.status_code == 500
