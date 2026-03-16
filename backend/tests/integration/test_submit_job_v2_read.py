# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Integration tests for v2 job read and restart endpoints.

Covers: submit -> inspect (status, outputs, specification) -> restart semantics.
"""

from fiab_core.fable import BlockInstance, PluginBlockFactoryId, PluginCompositeId

from forecastbox.api.types.fable import FableBuilderV1, FableSaveV2Request


def _save_and_execute(client, tmpdir) -> tuple[str, int, str]:
    """Save a minimal compilable definition, execute it, and return (definition_id, definition_version, execution_id)."""
    plugin_id = PluginCompositeId(store="ecmwf", local="ecmwf-base")
    source = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=plugin_id, factory="ekdSource"),
        configuration_values={"source": "ecmwf-open-data", "date": "2026-01-01", "expver": "0001"},
        input_ids={},
    )
    sink = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=plugin_id, factory="zarrSink"),
        configuration_values={"path": f"{tmpdir}/output.zarr"},
        input_ids={"dataset": "source1"},
    )
    builder = FableBuilderV1(blocks={"source1": source, "sinkMean": sink})
    save_resp = client.post("/fable/upsert_v2", json=FableSaveV2Request(builder=builder, display_name="v2 read test").model_dump())
    assert save_resp.is_success, save_resp.text
    def_id = save_resp.json()["id"]
    def_version = save_resp.json()["version"]

    exec_resp = client.post("/job/execute_v2", json={"job_definition_id": def_id, "job_definition_version": def_version})
    assert exec_resp.is_success, exec_resp.text
    execution_id = exec_resp.json()["execution_id"]
    return def_id, def_version, execution_id


def test_submit_job_v2_read_status_list(tmpdir, backend_client_with_auth):
    """GET /job/status_v2 returns a list containing the submitted execution."""
    _, _, execution_id = _save_and_execute(backend_client_with_auth, tmpdir)

    resp = backend_client_with_auth.get("/job/status_v2")
    assert resp.is_success, resp.text
    data = resp.json()
    assert "executions" in data
    assert "total" in data
    assert data["total"] >= 1
    ids = [e["execution_id"] for e in data["executions"]]
    assert execution_id in ids


def test_submit_job_v2_read_status_single(tmpdir, backend_client_with_auth):
    """GET /job/{execution_id}/status_v2 returns the status for the latest attempt."""
    _, _, execution_id = _save_and_execute(backend_client_with_auth, tmpdir)

    resp = backend_client_with_auth.get(f"/job/{execution_id}/status_v2")
    assert resp.is_success, resp.text
    data = resp.json()
    assert data["execution_id"] == execution_id
    assert data["attempt_count"] == 1
    assert "status" in data
    assert "job_definition_id" in data


def test_submit_job_v2_read_status_single_explicit_attempt(tmpdir, backend_client_with_auth):
    """GET /job/{execution_id}/status_v2?attempt_count=1 returns attempt 1 explicitly."""
    _, _, execution_id = _save_and_execute(backend_client_with_auth, tmpdir)

    resp = backend_client_with_auth.get(f"/job/{execution_id}/status_v2", params={"attempt_count": 1})
    assert resp.is_success, resp.text
    data = resp.json()
    assert data["attempt_count"] == 1


def test_submit_job_v2_read_status_not_found(backend_client_with_auth):
    """GET /job/{execution_id}/status_v2 with unknown id returns 404."""
    resp = backend_client_with_auth.get("/job/nonexistent-exec-id/status_v2")
    assert resp.status_code == 404


def test_submit_job_v2_read_specification(tmpdir, backend_client_with_auth):
    """GET /job/{execution_id}/specification_v2 returns the linked JobDefinition spec."""
    def_id, def_version, execution_id = _save_and_execute(backend_client_with_auth, tmpdir)

    resp = backend_client_with_auth.get(f"/job/{execution_id}/specification_v2")
    assert resp.is_success, resp.text
    data = resp.json()
    assert data["definition_id"] == def_id
    assert data["definition_version"] == def_version
    assert "blocks" in data
    assert data["blocks"] is not None


def test_submit_job_v2_read_specification_not_found(backend_client_with_auth):
    """GET /job/{execution_id}/specification_v2 with unknown id returns 404."""
    resp = backend_client_with_auth.get("/job/nonexistent-exec-id/specification_v2")
    assert resp.status_code == 404


def test_submit_job_v2_restart_creates_new_attempt(tmpdir, backend_client_with_auth):
    """POST /job/{execution_id}/restart_v2 creates attempt 2 under the same execution_id."""
    _, _, execution_id = _save_and_execute(backend_client_with_auth, tmpdir)

    restart_resp = backend_client_with_auth.post(f"/job/{execution_id}/restart_v2")
    assert restart_resp.is_success, restart_resp.text
    data = restart_resp.json()
    assert data["execution_id"] == execution_id
    assert data["attempt_count"] == 2

    # Latest-attempt status reflects attempt 2
    status_resp = backend_client_with_auth.get(f"/job/{execution_id}/status_v2")
    assert status_resp.is_success, status_resp.text
    assert status_resp.json()["attempt_count"] == 2

    # Attempt 1 is still accessible explicitly
    status_1_resp = backend_client_with_auth.get(f"/job/{execution_id}/status_v2", params={"attempt_count": 1})
    assert status_1_resp.is_success, status_1_resp.text
    assert status_1_resp.json()["attempt_count"] == 1


def test_submit_job_v2_restart_not_found(backend_client_with_auth):
    """POST /job/{execution_id}/restart_v2 with unknown id returns 500 (execution not found)."""
    resp = backend_client_with_auth.post("/job/nonexistent-exec-id/restart_v2")
    assert resp.status_code == 500
