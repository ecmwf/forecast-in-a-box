# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Integration tests for
- v2 schedule persistence (ExperimentDefinition / ExperimentNext)
- v2 schedule runs read model (GET /schedule/runs)."""

import datetime as dt
import pathlib
import time

from fiab_core.fable import BlockInstance, PluginBlockFactoryId, PluginCompositeId

from forecastbox.api.types.fable import FableBuilder, FableSaveRequest
from forecastbox.api.types.scheduling import ScheduleSpecification, ScheduleUpdate

from .conftest import testPluginId
from .utils import ensure_completed_v2, ensure_schedule_run_v2, scheduling_endpoint_with_retries

# *** helpers **


def _save_fable(client) -> tuple[str, int]:
    """Save a minimal FableBuilder and return (job_definition_id, version)."""
    plugin_id = PluginCompositeId(store="ecmwf", local="ecmwf-base")
    source = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=plugin_id, factory="ekdSource"),
        configuration_values={"source": "ecmwf-open-data", "date": "2026-01-01", "expver": "0001"},
        input_ids={},
    )
    builder = FableBuilder(blocks={"source1": source})
    resp = client.post("/fable/upsert", json=FableSaveRequest(builder=builder, display_name="sched-v2 test").model_dump())
    assert resp.is_success, resp.text
    data = resp.json()
    return data["id"], data["version"]


def _save_full_fable(client, output_path: str) -> tuple[str, int]:
    """Save a full FableBuilder (with sink) and return (job_definition_id, version)."""
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
        configuration_values={"fname": output_path},
        input_ids={"data": "product_join"},
    )
    builder = FableBuilder(
        blocks={
            "source_42": source_42,
            "transform_increment": transform_increment,
            "product_join": product_join,
            "sink_file": sink_file,
        }
    )
    resp = client.post("/fable/upsert", json=FableSaveRequest(builder=builder).model_dump())
    assert resp.is_success, resp.text
    data = resp.json()
    return data["id"], data["version"]


def _create_schedule_v2(client, job_def_id: str, job_def_version: int, cron_expr: str = "0 0 * * *") -> str:
    """Create a v2 cron schedule and return experiment_id."""
    spec = ScheduleSpecification(
        job_definition_id=job_def_id,
        job_definition_version=job_def_version,
        cron_expr=cron_expr,
        dynamic_expr={},
        max_acceptable_delay_hours=24,
        display_name="Runs v2 Test Schedule",
    )
    resp = client.put("/schedule/create", headers={"Content-Type": "application/json"}, json=spec.model_dump())
    assert resp.is_success, resp.text
    return resp.json()["experiment_id"]


# *** schedule crud endpoints ***


def test_schedule_v2_crud(backend_client_with_auth):
    """Create, get, update, and verify persistence of a v2 schedule."""
    headers = {"Content-Type": "application/json"}
    job_def_id, job_def_version = _save_fable(backend_client_with_auth)

    # miss on unknown experiment_id
    response = backend_client_with_auth.get("/schedule/get", params={"experiment_id": "notToBeFound"})
    assert response.status_code == 404

    # create
    spec = ScheduleSpecification(
        job_definition_id=job_def_id,
        job_definition_version=job_def_version,
        cron_expr="0 0 * * *",
        dynamic_expr={},
        max_acceptable_delay_hours=24,
        display_name="Test v2 Schedule",
    )
    response = backend_client_with_auth.put("/schedule/create", headers=headers, json=spec.model_dump())
    assert response.is_success, response.text
    experiment_id = response.json()["experiment_id"]
    assert experiment_id

    # get
    response = backend_client_with_auth.get("/schedule/get", params={"experiment_id": experiment_id})
    assert response.is_success, response.text
    data = response.json()
    assert data["experiment_id"] == experiment_id
    assert data["cron_expr"] == "0 0 * * *"
    assert data["enabled"] is True
    assert data["job_definition_id"] == job_def_id

    # update cron and enabled
    updated_cron = "0 1 * * *"
    update = ScheduleUpdate(cron_expr=updated_cron, enabled=False)
    response = scheduling_endpoint_with_retries(
        lambda: backend_client_with_auth.post(
            "/schedule/update", params={"experiment_id": experiment_id}, headers=headers, json=update.model_dump(exclude_unset=True)
        )
    )
    assert response.is_success, response.text
    updated = response.json()
    assert updated["cron_expr"] == updated_cron
    assert updated["enabled"] is False

    # confirm updated values are persisted
    response = backend_client_with_auth.get("/schedule/get", params={"experiment_id": experiment_id})
    assert response.is_success, response.text
    persisted = response.json()
    assert persisted["cron_expr"] == updated_cron
    assert persisted["enabled"] is False


def test_schedule_v2_list(backend_client_with_auth):
    """Creating v2 schedules makes them appear in the list_v2 endpoint with pagination."""
    headers = {"Content-Type": "application/json"}
    job_def_id, job_def_version = _save_fable(backend_client_with_auth)

    # baseline count
    response = backend_client_with_auth.get("/schedule/list")
    assert response.is_success, response.text
    baseline_total = response.json()["total"]

    spec1 = ScheduleSpecification(
        job_definition_id=job_def_id,
        job_definition_version=job_def_version,
        cron_expr="0 0 * * *",
    )
    spec2 = ScheduleSpecification(
        job_definition_id=job_def_id,
        job_definition_version=job_def_version,
        cron_expr="0 6 * * *",
    )
    r1 = backend_client_with_auth.put("/schedule/create", headers=headers, json=spec1.model_dump())
    assert r1.is_success, r1.text
    exp_id_1 = r1.json()["experiment_id"]
    r2 = backend_client_with_auth.put("/schedule/create", headers=headers, json=spec2.model_dump())
    assert r2.is_success, r2.text
    exp_id_2 = r2.json()["experiment_id"]

    response = backend_client_with_auth.get("/schedule/list")
    assert response.is_success, response.text
    list_data = response.json()
    assert list_data["total"] == baseline_total + 2
    assert list_data["page"] == 1
    assert list_data["page_size"] == 10
    experiment_ids = [s["experiment_id"] for s in list_data["schedules"]]
    assert exp_id_1 in experiment_ids
    assert exp_id_2 in experiment_ids

    # pagination: page_size=1
    response = backend_client_with_auth.get("/schedule/list", params={"page": 1, "page_size": 1})
    assert response.is_success, response.text
    paged = response.json()
    assert len(paged["schedules"]) == 1
    assert paged["total"] == baseline_total + 2
    assert paged["total_pages"] == baseline_total + 2

    # invalid params
    response = backend_client_with_auth.get("/schedule/list", params={"page": 0, "page_size": 1})
    assert response.status_code == 400
    response = backend_client_with_auth.get("/schedule/list", params={"page": 1, "page_size": 0})
    assert response.status_code == 400


def test_schedule_v2_next_run(backend_client_with_auth):
    """Next-run endpoint reflects cron changes and disabled state."""
    headers = {"Content-Type": "application/json"}
    job_def_id, job_def_version = _save_fable(backend_client_with_auth)

    spec = ScheduleSpecification(
        job_definition_id=job_def_id,
        job_definition_version=job_def_version,
        cron_expr="0 0 * * *",
    )
    response = backend_client_with_auth.put("/schedule/create", headers=headers, json=spec.model_dump())
    assert response.is_success, response.text
    experiment_id = response.json()["experiment_id"]

    # initial next run at midnight
    response = backend_client_with_auth.get("/schedule/next_run", params={"experiment_id": experiment_id})
    assert response.is_success, response.text
    initial_next_run = response.json()
    assert "00:00:00" in initial_next_run

    # update cron to 2 AM
    update = ScheduleUpdate(cron_expr="0 2 * * *")
    response = scheduling_endpoint_with_retries(
        lambda: backend_client_with_auth.post(
            "/schedule/update", params={"experiment_id": experiment_id}, headers=headers, json=update.model_dump(exclude_unset=True)
        )
    )
    assert response.is_success, response.text

    response = backend_client_with_auth.get("/schedule/next_run", params={"experiment_id": experiment_id})
    assert response.is_success, response.text
    updated_next_run = response.json()
    assert updated_next_run != initial_next_run
    assert "02:00:00" in updated_next_run

    # disable: next run should be cleared
    disable_update = ScheduleUpdate(enabled=False)
    response = scheduling_endpoint_with_retries(
        lambda: backend_client_with_auth.post(
            "/schedule/update", params={"experiment_id": experiment_id}, headers=headers, json=disable_update.model_dump(exclude_unset=True)
        )
    )
    assert response.is_success, response.text

    response = backend_client_with_auth.get("/schedule/next_run", params={"experiment_id": experiment_id})
    assert response.is_success, response.text
    assert response.json() == "not scheduled currently"


def test_schedule_v2_create_invalid_cron(backend_client_with_auth):
    """create_v2 with an invalid cron expression returns 400."""
    headers = {"Content-Type": "application/json"}
    job_def_id, job_def_version = _save_fable(backend_client_with_auth)

    spec = ScheduleSpecification(
        job_definition_id=job_def_id,
        job_definition_version=job_def_version,
        cron_expr="not a cron",
    )
    response = backend_client_with_auth.put("/schedule/create", headers=headers, json=spec.model_dump())
    assert response.status_code == 400


def test_schedule_v2_create_unknown_job_definition(backend_client_with_auth):
    """create_v2 referencing a non-existent JobDefinition returns 404."""
    headers = {"Content-Type": "application/json"}
    spec = ScheduleSpecification(
        job_definition_id="does-not-exist",
        cron_expr="0 0 * * *",
    )
    response = backend_client_with_auth.put("/schedule/create", headers=headers, json=spec.model_dump())
    assert response.status_code == 404


# *** runs endpoints ***


def test_schedule_v2_runs_empty(backend_client_with_auth):
    """A newly created v2 schedule with no executions returns an empty runs list."""
    job_def_id, job_def_version = _save_fable(backend_client_with_auth)
    experiment_id = _create_schedule_v2(backend_client_with_auth, job_def_id, job_def_version)

    response = backend_client_with_auth.get("/schedule/runs", params={"experiment_id": experiment_id})
    assert response.is_success, response.text
    data = response.json()
    assert data["total"] == 0
    assert data["runs"] == []
    assert data["page"] == 1
    assert data["page_size"] == 10
    assert data["total_pages"] == 0


def test_schedule_v2_runs_not_found(backend_client_with_auth):
    """runs_v2 returns 404 for an unknown experiment_id."""
    response = backend_client_with_auth.get("/schedule/runs", params={"experiment_id": "does-not-exist"})
    assert response.status_code == 404


def test_schedule_v2_runs_invalid_pagination(backend_client_with_auth):
    """runs_v2 returns 400 for invalid page or page_size values."""
    job_def_id, job_def_version = _save_fable(backend_client_with_auth)
    experiment_id = _create_schedule_v2(backend_client_with_auth, job_def_id, job_def_version)

    response = backend_client_with_auth.get("/schedule/runs", params={"experiment_id": experiment_id, "page": 0, "page_size": 10})
    assert response.status_code == 400

    response = backend_client_with_auth.get("/schedule/runs", params={"experiment_id": experiment_id, "page": 1, "page_size": 0})
    assert response.status_code == 400


def test_schedule_v2_runs_page_beyond_empty(backend_client_with_auth):
    """Page 2 of an empty schedule returns an empty list (not 404), since total is 0."""
    job_def_id, job_def_version = _save_fable(backend_client_with_auth)
    experiment_id = _create_schedule_v2(backend_client_with_auth, job_def_id, job_def_version)

    response = backend_client_with_auth.get("/schedule/runs", params={"experiment_id": experiment_id, "page": 2, "page_size": 10})
    assert response.is_success, response.text
    data = response.json()
    assert data["total"] == 0
    assert data["runs"] == []


def test_schedule_v2_runs_independent_per_experiment(backend_client_with_auth):
    """Two different experiments have independent runs_v2 results."""
    job_def_id, job_def_version = _save_fable(backend_client_with_auth)
    exp_id_1 = _create_schedule_v2(backend_client_with_auth, job_def_id, job_def_version, cron_expr="0 0 * * *")
    exp_id_2 = _create_schedule_v2(backend_client_with_auth, job_def_id, job_def_version, cron_expr="0 6 * * *")

    r1 = backend_client_with_auth.get("/schedule/runs", params={"experiment_id": exp_id_1})
    r2 = backend_client_with_auth.get("/schedule/runs", params={"experiment_id": exp_id_2})
    assert r1.is_success and r2.is_success
    assert r1.json()["total"] == 0
    assert r2.json()["total"] == 0


def test_schedule_v2_execute(tmpdir, backend_client_with_auth):
    """Create a schedule with first_run_override in the past; verify the scheduler executes it and produces the correct output."""
    output_path = str(pathlib.Path(str(tmpdir)) / "output")
    job_def_id, job_def_version = _save_full_fable(backend_client_with_auth, output_path)

    first_run_override = dt.datetime.now() - dt.timedelta(minutes=5)
    spec = ScheduleSpecification(
        job_definition_id=job_def_id,
        job_definition_version=job_def_version,
        cron_expr="0 0 * * *",
        max_acceptable_delay_hours=1,
        first_run_override=first_run_override,
    )
    create_resp = backend_client_with_auth.put(
        "/schedule/create",
        headers={"Content-Type": "application/json"},
        json=spec.model_dump(mode="json"),
    )
    assert create_resp.is_success, create_resp.text
    experiment_id = create_resp.json()["experiment_id"]

    execution_id = ensure_schedule_run_v2(backend_client_with_auth, experiment_id, sleep=1, attempts=30)
    ensure_completed_v2(backend_client_with_auth, execution_id, sleep=1, attempts=120)

    assert pathlib.Path(output_path).read_text() == "85"  # 42 + 1 + 42
