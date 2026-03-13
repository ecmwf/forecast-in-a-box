# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Integration tests for the v2 execute endpoint (POST /job/execute_v2)."""

from cascade.low.builders import JobBuilder, TaskBuilder

from forecastbox.api.types.fable import FableBuilderV1, FableSaveV2Request
from forecastbox.api.types.jobs import EnvironmentSpecification, ExecutionSpecification, RawCascadeJob

from .utils import ensure_completed


def _make_raw_spec() -> ExecutionSpecification:
    """Build a trivial raw cascade job spec that always succeeds."""
    job_instance = JobBuilder().with_node("n1", TaskBuilder.from_callable(eval).with_values("1+2")).build().get_or_raise()
    return ExecutionSpecification(
        job=RawCascadeJob(job_type="raw_cascade_job", job_instance=job_instance),
        environment=EnvironmentSpecification(hosts=1, workers_per_host=2),
    )


def test_submit_job_v2_execute_raw_spec(backend_client_with_auth):
    """Submitting a raw spec via execute_v2 creates a one-off JobDefinition and a linked JobExecution."""
    spec = _make_raw_spec()
    payload = {"spec": spec.model_dump()}

    response = backend_client_with_auth.post("/job/execute_v2", json=payload)
    assert response.is_success, response.text
    data = response.json()

    assert "execution_id" in data
    assert "id" in data
    assert "definition_id" in data
    assert "definition_version" in data
    assert data["definition_version"] == 1

    # The cascade job id can be polled via the v1 status endpoint
    cascade_job_id = data["id"]
    ensure_completed(backend_client_with_auth, cascade_job_id)


def test_submit_job_v2_execute_saved_definition(tmpdir, backend_client_with_auth):
    """Submitting a saved JobDefinition reference links the execution to the existing definition."""
    from fiab_core.fable import BlockInstance, PluginBlockFactoryId, PluginCompositeId

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

    save_resp = backend_client_with_auth.post("/fable/upsert_v2", json=FableSaveV2Request(builder=builder, display_name="v2 exec test").model_dump())
    assert save_resp.is_success, save_resp.text
    fable_id = save_resp.json()["id"]
    fable_version = save_resp.json()["version"]

    # Execute the saved definition
    payload = {"job_definition_id": fable_id, "job_definition_version": fable_version}
    exec_resp = backend_client_with_auth.post("/job/execute_v2", json=payload)
    assert exec_resp.is_success, exec_resp.text
    data = exec_resp.json()

    assert "execution_id" in data
    assert "id" in data
    # The definition_id must match the saved fable (not a new one-off clone)
    assert data["definition_id"] == fable_id
    assert data["definition_version"] == fable_version


def test_submit_job_v2_execute_missing_both(backend_client_with_auth):
    """Providing neither job_definition_id nor spec returns a 422 validation error."""
    response = backend_client_with_auth.post("/job/execute_v2", json={})
    assert response.status_code == 422


def test_submit_job_v2_execute_both_provided(backend_client_with_auth):
    """Providing both job_definition_id and spec returns a 422 validation error."""
    spec = _make_raw_spec()
    payload = {"job_definition_id": "some-id", "spec": spec.model_dump()}
    response = backend_client_with_auth.post("/job/execute_v2", json=payload)
    assert response.status_code == 422


def test_submit_job_v2_execute_unknown_definition(backend_client_with_auth):
    """Referencing a non-existent JobDefinition returns a 500 error."""
    payload = {"job_definition_id": "does-not-exist"}
    response = backend_client_with_auth.post("/job/execute_v2", json=payload)
    assert response.status_code == 500
