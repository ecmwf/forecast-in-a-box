# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Integration tests for the v2 schedule runs read model (GET /schedule/runs_v2)."""

import datetime as dt

from fiab_core.fable import BlockInstance, PluginBlockFactoryId, PluginCompositeId

from forecastbox.api.types.fable import FableBuilderV1, FableSaveV2Request
from forecastbox.api.types.scheduling import ScheduleSpecificationV2


def _save_fable(client) -> tuple[str, int]:
    """Save a minimal FableBuilderV1 and return (job_definition_id, version)."""
    plugin_id = PluginCompositeId(store="ecmwf", local="ecmwf-base")
    source = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=plugin_id, factory="ekdSource"),
        configuration_values={"source": "ecmwf-open-data", "date": "2026-01-01", "expver": "0001"},
        input_ids={},
    )
    builder = FableBuilderV1(blocks={"source1": source})
    resp = client.post("/fable/upsert_v2", json=FableSaveV2Request(builder=builder, display_name="runs-v2 test").model_dump())
    assert resp.is_success, resp.text
    data = resp.json()
    return data["id"], data["version"]


def _create_schedule_v2(client, job_def_id: str, job_def_version: int, cron_expr: str = "0 0 * * *") -> str:
    """Create a v2 cron schedule and return experiment_id."""
    spec = ScheduleSpecificationV2(
        job_definition_id=job_def_id,
        job_definition_version=job_def_version,
        cron_expr=cron_expr,
        dynamic_expr={},
        max_acceptable_delay_hours=24,
        display_name="Runs v2 Test Schedule",
    )
    resp = client.put("/schedule/create_v2", headers={"Content-Type": "application/json"}, json=spec.model_dump())
    assert resp.is_success, resp.text
    return resp.json()["experiment_id"]


def test_schedule_v2_runs_empty(backend_client_with_auth):
    """A newly created v2 schedule with no executions returns an empty runs list."""
    job_def_id, job_def_version = _save_fable(backend_client_with_auth)
    experiment_id = _create_schedule_v2(backend_client_with_auth, job_def_id, job_def_version)

    response = backend_client_with_auth.get("/schedule/runs_v2", params={"experiment_id": experiment_id})
    assert response.is_success, response.text
    data = response.json()
    assert data["total"] == 0
    assert data["runs"] == []
    assert data["page"] == 1
    assert data["page_size"] == 10
    assert data["total_pages"] == 0


def test_schedule_v2_runs_not_found(backend_client_with_auth):
    """runs_v2 returns 404 for an unknown experiment_id."""
    response = backend_client_with_auth.get("/schedule/runs_v2", params={"experiment_id": "does-not-exist"})
    assert response.status_code == 404


def test_schedule_v2_runs_invalid_pagination(backend_client_with_auth):
    """runs_v2 returns 400 for invalid page or page_size values."""
    job_def_id, job_def_version = _save_fable(backend_client_with_auth)
    experiment_id = _create_schedule_v2(backend_client_with_auth, job_def_id, job_def_version)

    response = backend_client_with_auth.get("/schedule/runs_v2", params={"experiment_id": experiment_id, "page": 0, "page_size": 10})
    assert response.status_code == 400

    response = backend_client_with_auth.get("/schedule/runs_v2", params={"experiment_id": experiment_id, "page": 1, "page_size": 0})
    assert response.status_code == 400


def test_schedule_v2_runs_page_beyond_empty(backend_client_with_auth):
    """Page 2 of an empty schedule returns an empty list (not 404), since total is 0."""
    job_def_id, job_def_version = _save_fable(backend_client_with_auth)
    experiment_id = _create_schedule_v2(backend_client_with_auth, job_def_id, job_def_version)

    response = backend_client_with_auth.get("/schedule/runs_v2", params={"experiment_id": experiment_id, "page": 2, "page_size": 10})
    assert response.is_success, response.text
    data = response.json()
    assert data["total"] == 0
    assert data["runs"] == []


def test_schedule_v2_runs_independent_per_experiment(backend_client_with_auth):
    """Two different experiments have independent runs_v2 results."""
    job_def_id, job_def_version = _save_fable(backend_client_with_auth)
    exp_id_1 = _create_schedule_v2(backend_client_with_auth, job_def_id, job_def_version, cron_expr="0 0 * * *")
    exp_id_2 = _create_schedule_v2(backend_client_with_auth, job_def_id, job_def_version, cron_expr="0 6 * * *")

    r1 = backend_client_with_auth.get("/schedule/runs_v2", params={"experiment_id": exp_id_1})
    r2 = backend_client_with_auth.get("/schedule/runs_v2", params={"experiment_id": exp_id_2})
    assert r1.is_success and r2.is_success
    assert r1.json()["total"] == 0
    assert r2.json()["total"] == 0
