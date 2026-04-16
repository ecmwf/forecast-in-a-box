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
- v2 schedule runs read model (GET /experiment/runs/list)."""

import datetime as dt
import pathlib
import time
from typing import Any

import httpx
from fiab_core.fable import BlockInstance, PluginBlockFactoryId

from forecastbox.domain.blueprint.service import BlueprintBuilder
from forecastbox.domain.blueprint.service import BlueprintSaveCommand as BlueprintSaveRequest
from forecastbox.domain.blueprint.types import BlueprintId
from forecastbox.domain.glyphs.resolution import value_dt2str
from forecastbox.routes.experiment import ExperimentCreateRequest, ExperimentUpdateRequest

from .conftest import testPluginId
from .utils import (
    compare_with_tolerance,
    ensure_schedule_run_v2,
    retry_until,
    scheduling_endpoint_with_retries,
)

# *** helpers **


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


def _save_blueprint(client: httpx.Client) -> tuple[str, int]:
    """Save a minimal BlueprintBuilder and return (blueprint_id, version)."""
    source = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=testPluginId, factory="source_42"),
        configuration_values={},
        input_ids={},
    )
    builder = BlueprintBuilder(blocks={"source1": source})
    resp = client.post("/blueprint/create", json=BlueprintSaveRequest(builder=builder, display_name="sched-v2 test").model_dump())
    assert resp.is_success, resp.text
    data = resp.json()
    return data["blueprint_id"], data["version"]


def _save_full_blueprint(client: httpx.Client, output_path: str, time_output_path: str) -> tuple[str, int]:
    """Save a full BlueprintBuilder (with sink) and return (blueprint_id, version)."""
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
    source_time = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=testPluginId, factory="source_text"),
        configuration_values={"text": "${submitDatetime};${startDatetime}"},
        input_ids={},
    )
    sink_time = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=testPluginId, factory="sink_file"),
        configuration_values={"fname": time_output_path},
        input_ids={"data": "source_time"},
    )
    builder = BlueprintBuilder(
        blocks={
            "source_42": source_42,
            "transform_increment": transform_increment,
            "product_join": product_join,
            "sink_file": sink_file,
            "source_time": source_time,
            "sink_time": sink_time,
        }
    )
    resp = client.post("/blueprint/create", json=BlueprintSaveRequest(builder=builder).model_dump())
    assert resp.is_success, resp.text
    data = resp.json()
    return data["blueprint_id"], data["version"]


def _create_schedule_v2(client: httpx.Client, job_def_id: str, job_def_version: int, cron_expr: str = "0 0 * * *") -> str:
    """Create a v2 cron schedule and return experiment_id."""
    spec = ExperimentCreateRequest(
        blueprint_id=BlueprintId(job_def_id),
        blueprint_version=job_def_version,
        cron_expr=cron_expr,
        max_acceptable_delay_hours=24,
        display_name="Runs v2 Test Schedule",
    )
    resp = client.put("/experiment/create", headers={"Content-Type": "application/json"}, json=spec.model_dump())
    assert resp.is_success, resp.text
    return resp.json()["experiment_id"]


# *** schedule crud endpoints ***


def test_schedule_v2_crud(backend_client_with_auth: httpx.Client) -> None:
    """Create, get, update, and verify persistence of a v2 schedule."""
    headers = {"Content-Type": "application/json"}
    job_def_id, job_def_version = _save_blueprint(backend_client_with_auth)

    # miss on unknown experiment_id
    response = backend_client_with_auth.get("/experiment/get", params={"experiment_id": "notToBeFound"})
    assert response.status_code == 404

    # create
    spec = ExperimentCreateRequest(
        blueprint_id=BlueprintId(job_def_id),
        blueprint_version=job_def_version,
        cron_expr="0 0 * * *",
        max_acceptable_delay_hours=24,
        display_name="Test v2 Schedule",
    )
    response = backend_client_with_auth.put("/experiment/create", headers=headers, json=spec.model_dump())
    assert response.is_success, response.text
    experiment_id = response.json()["experiment_id"]
    assert experiment_id

    # get
    response = backend_client_with_auth.get("/experiment/get", params={"experiment_id": experiment_id})
    assert response.is_success, response.text
    data = response.json()
    assert data["experiment_id"] == experiment_id
    assert data["cron_expr"] == "0 0 * * *"
    assert data["enabled"] is True
    assert data["blueprint_id"] == job_def_id
    experiment_version = data["experiment_version"]

    # update cron and enabled
    updated_cron = "0 1 * * *"
    update_body = ExperimentUpdateRequest(
        experiment_id=experiment_id, version=experiment_version, cron_expr=updated_cron, enabled=False
    ).model_dump(exclude_unset=True)
    response = scheduling_endpoint_with_retries(
        lambda: backend_client_with_auth.post("/experiment/update", headers=headers, json=update_body)
    )
    assert response.is_success, response.text
    updated = response.json()
    assert updated["cron_expr"] == updated_cron
    assert updated["enabled"] is False

    # confirm updated values are persisted
    response = backend_client_with_auth.get("/experiment/get", params={"experiment_id": experiment_id})
    assert response.is_success, response.text
    persisted = response.json()
    assert persisted["cron_expr"] == updated_cron
    assert persisted["enabled"] is False


def test_schedule_v2_list(backend_client_with_auth: httpx.Client) -> None:
    """Creating v2 schedules makes them appear in the list_v2 endpoint with pagination."""
    headers = {"Content-Type": "application/json"}
    job_def_id, job_def_version = _save_blueprint(backend_client_with_auth)

    # baseline count
    response = backend_client_with_auth.get("/experiment/list")
    assert response.is_success, response.text
    baseline_total = response.json()["total"]

    spec1 = ExperimentCreateRequest(
        blueprint_id=BlueprintId(job_def_id),
        blueprint_version=job_def_version,
        cron_expr="0 0 * * *",
    )
    spec2 = ExperimentCreateRequest(
        blueprint_id=BlueprintId(job_def_id),
        blueprint_version=job_def_version,
        cron_expr="0 6 * * *",
    )
    r1 = backend_client_with_auth.put("/experiment/create", headers=headers, json=spec1.model_dump())
    assert r1.is_success, r1.text
    exp_id_1 = r1.json()["experiment_id"]
    r2 = backend_client_with_auth.put("/experiment/create", headers=headers, json=spec2.model_dump())
    assert r2.is_success, r2.text
    exp_id_2 = r2.json()["experiment_id"]

    response = backend_client_with_auth.get("/experiment/list")
    assert response.is_success, response.text
    list_data = response.json()
    assert list_data["total"] == baseline_total + 2
    assert list_data["page"] == 1
    assert list_data["page_size"] == 10
    experiment_ids = [s["experiment_id"] for s in list_data["experiments"]]
    assert exp_id_1 in experiment_ids
    assert exp_id_2 in experiment_ids

    # pagination: page_size=1
    response = backend_client_with_auth.get("/experiment/list", params={"page": 1, "page_size": 1})
    assert response.is_success, response.text
    paged = response.json()
    assert len(paged["experiments"]) == 1
    assert paged["total"] == baseline_total + 2
    assert paged["total_pages"] == baseline_total + 2

    # invalid params — now 422 (Pydantic validation) instead of 400
    response = backend_client_with_auth.get("/experiment/list", params={"page": 0, "page_size": 1})
    assert response.status_code == 422
    response = backend_client_with_auth.get("/experiment/list", params={"page": 1, "page_size": 0})
    assert response.status_code == 422


def test_schedule_v2_next_run(backend_client_with_auth: httpx.Client) -> None:
    """Next-run endpoint reflects cron changes and disabled state."""
    headers = {"Content-Type": "application/json"}
    job_def_id, job_def_version = _save_blueprint(backend_client_with_auth)

    spec = ExperimentCreateRequest(
        blueprint_id=BlueprintId(job_def_id),
        blueprint_version=job_def_version,
        cron_expr="0 0 * * *",
    )
    response = backend_client_with_auth.put("/experiment/create", headers=headers, json=spec.model_dump())
    assert response.is_success, response.text
    experiment_id = response.json()["experiment_id"]

    # initial next run at midnight
    response = backend_client_with_auth.get("/experiment/runs/next", params={"experiment_id": experiment_id})
    assert response.is_success, response.text
    initial_next_run = response.json()
    assert "00:00:00" in initial_next_run

    # fetch current version before first update
    get_resp = backend_client_with_auth.get("/experiment/get", params={"experiment_id": experiment_id})
    assert get_resp.is_success, get_resp.text
    experiment_version = get_resp.json()["experiment_version"]

    # update cron to 2 AM
    update_body = ExperimentUpdateRequest(experiment_id=experiment_id, version=experiment_version, cron_expr="0 2 * * *").model_dump(
        exclude_unset=True
    )
    response = scheduling_endpoint_with_retries(
        lambda: backend_client_with_auth.post("/experiment/update", headers=headers, json=update_body)
    )
    assert response.is_success, response.text
    experiment_version = response.json()["experiment_version"]

    response = backend_client_with_auth.get("/experiment/runs/next", params={"experiment_id": experiment_id})
    assert response.is_success, response.text
    updated_next_run = response.json()
    assert updated_next_run != initial_next_run
    assert "02:00:00" in updated_next_run

    # disable: next run should be cleared
    disable_body = ExperimentUpdateRequest(experiment_id=experiment_id, version=experiment_version, enabled=False).model_dump(
        exclude_unset=True
    )
    response = scheduling_endpoint_with_retries(
        lambda: backend_client_with_auth.post(
            "/experiment/update",
            headers=headers,
            json=disable_body,
        )
    )
    assert response.is_success, response.text

    response = backend_client_with_auth.get("/experiment/runs/next", params={"experiment_id": experiment_id})
    assert response.is_success, response.text
    assert response.json() == "not scheduled currently"


def test_schedule_v2_create_invalid_cron(backend_client_with_auth: httpx.Client) -> None:
    """create_v2 with an invalid cron expression returns 400."""
    headers = {"Content-Type": "application/json"}
    job_def_id, job_def_version = _save_blueprint(backend_client_with_auth)

    spec = ExperimentCreateRequest(
        blueprint_id=BlueprintId(job_def_id),
        blueprint_version=job_def_version,
        cron_expr="not a cron",
    )
    response = backend_client_with_auth.put("/experiment/create", headers=headers, json=spec.model_dump())
    assert response.status_code == 400


def test_schedule_v2_create_unknown_blueprint(backend_client_with_auth: httpx.Client) -> None:
    """create_v2 referencing a non-existent Blueprint returns 404."""
    headers = {"Content-Type": "application/json"}
    spec = ExperimentCreateRequest(
        blueprint_id=BlueprintId("does-not-exist"),
        cron_expr="0 0 * * *",
    )
    response = backend_client_with_auth.put("/experiment/create", headers=headers, json=spec.model_dump())
    assert response.status_code == 404


# *** runs endpoints ***


def test_schedule_v2_runs_empty(backend_client_with_auth: httpx.Client) -> None:
    """A newly created v2 schedule with no executions returns an empty runs list."""
    job_def_id, job_def_version = _save_blueprint(backend_client_with_auth)
    experiment_id = _create_schedule_v2(backend_client_with_auth, job_def_id, job_def_version)

    response = backend_client_with_auth.get("/experiment/runs/list", params={"experiment_id": experiment_id})
    assert response.is_success, response.text
    data = response.json()
    assert data["total"] == 0
    assert data["runs"] == []
    assert data["page"] == 1
    assert data["page_size"] == 10
    assert data["total_pages"] == 0


def test_schedule_v2_runs_not_found(backend_client_with_auth: httpx.Client) -> None:
    """runs_v2 returns 404 for an unknown experiment_id."""
    response = backend_client_with_auth.get("/experiment/runs/list", params={"experiment_id": "does-not-exist"})
    assert response.status_code == 404


def test_schedule_v2_runs_invalid_pagination(backend_client_with_auth: httpx.Client) -> None:
    """runs_v2 returns 422 for invalid page or page_size values."""
    job_def_id, job_def_version = _save_blueprint(backend_client_with_auth)
    experiment_id = _create_schedule_v2(backend_client_with_auth, job_def_id, job_def_version)

    response = backend_client_with_auth.get("/experiment/runs/list", params={"experiment_id": experiment_id, "page": 0, "page_size": 10})
    assert response.status_code == 422

    response = backend_client_with_auth.get("/experiment/runs/list", params={"experiment_id": experiment_id, "page": 1, "page_size": 0})
    assert response.status_code == 422


def test_schedule_v2_runs_page_beyond_empty(backend_client_with_auth: httpx.Client) -> None:
    """Page 2 of an empty schedule returns an empty list (not 404), since total is 0."""
    job_def_id, job_def_version = _save_blueprint(backend_client_with_auth)
    experiment_id = _create_schedule_v2(backend_client_with_auth, job_def_id, job_def_version)

    response = backend_client_with_auth.get("/experiment/runs/list", params={"experiment_id": experiment_id, "page": 2, "page_size": 10})
    assert response.is_success, response.text
    data = response.json()
    assert data["total"] == 0
    assert data["runs"] == []


def test_schedule_v2_runs_independent_per_experiment(backend_client_with_auth: httpx.Client) -> None:
    """Two different experiments have independent runs_v2 results."""
    job_def_id, job_def_version = _save_blueprint(backend_client_with_auth)
    exp_id_1 = _create_schedule_v2(backend_client_with_auth, job_def_id, job_def_version, cron_expr="0 0 * * *")
    exp_id_2 = _create_schedule_v2(backend_client_with_auth, job_def_id, job_def_version, cron_expr="0 6 * * *")

    r1 = backend_client_with_auth.get("/experiment/runs/list", params={"experiment_id": exp_id_1})
    r2 = backend_client_with_auth.get("/experiment/runs/list", params={"experiment_id": exp_id_2})
    assert r1.is_success and r2.is_success
    assert r1.json()["total"] == 0
    assert r2.json()["total"] == 0


def test_schedule_v2_execute(tmpdir: Any, backend_client_with_auth: httpx.Client) -> None:
    """Create a schedule with first_run_override in the past; verify the scheduler executes it and produces the correct output."""
    output_path = str(pathlib.Path(str(tmpdir)) / "output")
    time_output_path = str(pathlib.Path(str(tmpdir)) / "time_output")
    job_def_id, job_def_version = _save_full_blueprint(backend_client_with_auth, output_path, time_output_path)

    first_run_override = dt.datetime.now() - dt.timedelta(minutes=5)
    spec = ExperimentCreateRequest(
        blueprint_id=BlueprintId(job_def_id),
        blueprint_version=job_def_version,
        cron_expr="0 0 * * *",
        max_acceptable_delay_hours=1,
        first_run_override=first_run_override,
    )
    create_resp = backend_client_with_auth.put(
        "/experiment/create",
        headers={"Content-Type": "application/json"},
        json=spec.model_dump(mode="json"),
    )
    assert create_resp.is_success, create_resp.text
    experiment_id = create_resp.json()["experiment_id"]

    run_id = ensure_schedule_run_v2(backend_client_with_auth, experiment_id, sleep=1, attempts=30)
    ensure_completed_v2(backend_client_with_auth, run_id, sleep=1, attempts=120)

    assert pathlib.Path(output_path).read_text() == "85"  # 42 + 1 + 42

    # submitDatetime must equal exec_time (first_run_override), startDatetime must equal run's created_at.
    status_resp = backend_client_with_auth.get("/run/get", params={"run_id": run_id})
    assert status_resp.is_success, status_resp.text
    created_at_sec = status_resp.json()["created_at"].split(".", 1)[0]
    expected_submit = value_dt2str(first_run_override)
    _time_line = pathlib.Path(time_output_path).read_text()
    _time_parts = _time_line.split(";")
    assert _time_parts[0] == expected_submit
    assert compare_with_tolerance(_time_parts[1], dt.datetime.fromisoformat(created_at_sec))
