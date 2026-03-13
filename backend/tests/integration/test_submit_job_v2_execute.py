# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Integration tests for the v2 execute endpoint (POST /job/execute_v2)."""

from fiab_core.fable import BlockInstance, PluginBlockFactoryId, PluginCompositeId

from forecastbox.api.types.fable import FableBuilderV1, FableSaveV2Request

from .utils import ensure_completed


def _save_builder(client, tmpdir) -> tuple[str, int]:
    """Helper: save a minimal compilable fable and return (id, version)."""
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
    save_resp = client.post("/fable/upsert_v2", json=FableSaveV2Request(builder=builder, display_name="v2 exec test").model_dump())
    assert save_resp.is_success, save_resp.text
    return save_resp.json()["id"], save_resp.json()["version"]


def test_submit_job_v2_execute_saved_definition(tmpdir, backend_client_with_auth):
    """Submitting a saved JobDefinition reference creates a linked JobExecution."""
    fable_id, fable_version = _save_builder(backend_client_with_auth, tmpdir)

    payload = {"job_definition_id": fable_id, "job_definition_version": fable_version}
    exec_resp = backend_client_with_auth.post("/job/execute_v2", json=payload)
    assert exec_resp.is_success, exec_resp.text
    data = exec_resp.json()

    assert "execution_id" in data
    assert "attempt_count" in data
    assert data["attempt_count"] == 1


def test_submit_job_v2_execute_missing_definition_id(backend_client_with_auth):
    """Omitting job_definition_id (required field) returns 422."""
    response = backend_client_with_auth.post("/job/execute_v2", json={})
    assert response.status_code == 422


def test_submit_job_v2_execute_unknown_definition(backend_client_with_auth):
    """Referencing a non-existent JobDefinition returns 404."""
    payload = {"job_definition_id": "does-not-exist"}
    response = backend_client_with_auth.post("/job/execute_v2", json=payload)
    assert response.status_code == 404
