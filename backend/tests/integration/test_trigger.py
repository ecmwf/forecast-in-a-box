# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Integration tests of the event trigger routes (/trigger/*): CRUD, and handling of synthetic events
fired through /trigger/operational/fire, on a blueprint using a trigger glyph as a local glyph."""

import contextlib
import pathlib
from collections.abc import Generator
from typing import Any, cast

import httpx
from fiab_core.fable import BlockFactoryId, BlockInstance, BlockInstanceId, ConfigurationOptionId

from forecastbox.domain.blueprint.service import BlueprintBuilder, RoutableBlock
from forecastbox.domain.blueprint.service import BlueprintSaveCommand as BlueprintSaveRequest
from forecastbox.domain.blueprint.types import BlueprintId
from forecastbox.domain.experiment.types import ExperimentDefinitionId
from forecastbox.routes.trigger import TriggerCreateRequest, TriggerDeleteRequest, TriggerFireRequest, TriggerUpdateRequest

from .conftest import testPluginId
from .utils import extract_auth_token_from_response, prepare_cookie_with_auth_token, retry_until

HEADERS = {"Content-Type": "application/json"}
EVENT_DATE = "20261103"


def _config(values: dict[str, str]) -> dict[ConfigurationOptionId, str]:
    return {ConfigurationOptionId(key): value for key, value in values.items()}


def _save_glyph_blueprint(client: httpx.Client, output_path: str) -> tuple[BlueprintId, int]:
    """Save a blueprint writing `${aviso_date}` to a file, declaring the glyph local with a placeholder value."""
    source = RoutableBlock(
        instance_id=BlockInstanceId("source_date"),
        plugin=testPluginId,
        factory=BlockFactoryId("source_text"),
        instance=BlockInstance(configuration_values=_config({"text": "${aviso_date}"}), input_ids={}),
    )
    sink = RoutableBlock(
        instance_id=BlockInstanceId("sink_date"),
        plugin=testPluginId,
        factory=BlockFactoryId("sink_file"),
        instance=BlockInstance(configuration_values=_config({"fname": output_path}), input_ids={"data": BlockInstanceId("source_date")}),
    )
    builder = BlueprintBuilder(blocks=[source, sink], local_glyphs={"aviso_date": "PLACEHOLDER"})
    resp = client.post("/blueprint/create", json=BlueprintSaveRequest(builder=builder, display_name="trigger test").model_dump())
    assert resp.is_success, resp.text
    data = resp.json()
    return BlueprintId(data["blueprint_id"]), data["version"]


def _create_trigger(
    client: httpx.Client,
    blueprint_id: BlueprintId,
    blueprint_version: int,
    filter: dict[str, Any] | None = None,
    glyph_map: dict[str, str] | None = None,
    max_acceptable_delay_hours: int = 24,
    enabled: bool = True,
    display_name: str | None = None,
) -> tuple[ExperimentDefinitionId, int]:
    request = TriggerCreateRequest(
        blueprint_id=blueprint_id,
        blueprint_version=blueprint_version,
        event_type="mars",
        filter=filter or {},
        glyph_map=glyph_map or {},
        max_acceptable_delay_hours=max_acceptable_delay_hours,
        enabled=enabled,
        display_name=display_name,
    )
    response = client.put("/trigger/create", headers=HEADERS, json=request.model_dump(mode="json"))
    assert response.is_success, response.text
    experiment_id = ExperimentDefinitionId(response.json()["experiment_id"])
    get_response = client.get("/trigger/get", params={"experiment_id": experiment_id})
    assert get_response.is_success, get_response.text
    return experiment_id, get_response.json()["experiment_version"]


def _fire(client: httpx.Client, experiment_id: ExperimentDefinitionId, identifier: dict[str, Any]) -> httpx.Response:
    request = TriggerFireRequest(experiment_id=experiment_id, identifier=identifier)
    return client.post("/trigger/operational/fire", headers=HEADERS, json=request.model_dump(mode="json"))


def _wait_for_runs(client: httpx.Client, experiment_id: ExperimentDefinitionId, expected: int = 1) -> list[dict[str, Any]]:
    def do_action() -> Any:
        response = client.get("/trigger/runs/list", params={"experiment_id": experiment_id}, timeout=10)
        assert response.is_success, response.text
        return response.json()

    def verify_ok(data: Any) -> list[dict[str, Any]] | None:
        return data["runs"] if data["total"] >= expected else None

    return cast(
        list[dict[str, Any]],
        retry_until(do_action, verify_ok, attempts=30, sleep=1, error_msg=f"expected {expected} runs of trigger {experiment_id}"),
    )


def _wait_for_completed(client: httpx.Client, run_id: str) -> dict[str, Any]:
    def do_action() -> Any:
        response = client.get("/run/get", params={"run_id": run_id}, timeout=10)
        assert response.is_success, response.text
        return response.json()

    def verify_ok(data: Any) -> dict[str, Any] | None:
        if data["status"] == "failed":
            raise RuntimeError(f"Run {run_id} failed: {data}")
        return data if data["status"] == "completed" else None

    return cast(dict[str, Any], retry_until(do_action, verify_ok, attempts=120, sleep=1, error_msg=f"run {run_id} did not complete"))


def test_trigger_fire_runs_blueprint_with_event_glyphs(
    tmpdir: Any, backend_client_user: httpx.Client, backend_client_admin: httpx.Client
) -> None:
    output_path = pathlib.Path(str(tmpdir)) / "output"
    blueprint_id, blueprint_version = _save_glyph_blueprint(backend_client_user, str(output_path))
    experiment_id, _ = _create_trigger(backend_client_user, blueprint_id, blueprint_version)

    response = _fire(backend_client_admin, experiment_id, {"date": EVENT_DATE, "step": 6, "class": "od"})
    assert response.is_success, response.text
    fired = response.json()
    assert fired["status"] == "submitted", fired
    assert fired["run_id"]

    # exactly one run, owned by the trigger creator, with the event as the context
    runs = _wait_for_runs(backend_client_user, experiment_id)
    assert len(runs) == 1
    assert runs[0]["run_id"] == fired["run_id"]
    assert runs[0]["experiment_context"] == f"synthetic:mars#{fired['sequence']}"

    # the event glyph reached the run: persisted resolution, and the output of the run
    run = _wait_for_completed(backend_client_user, fired["run_id"])
    assert run["resolution"]["source_date"]["text"] == EVENT_DATE
    assert output_path.read_text() == EVENT_DATE

    # exactly one handled event, submitted
    response = backend_client_user.get("/trigger/events/list", params={"experiment_id": experiment_id})
    assert response.is_success, response.text
    events = response.json()
    assert events["has_more"] is False
    assert len(events["events"]) == 1
    event = events["events"][0]
    assert (event["source"], event["event_type"], event["status"], event["run_id"]) == (
        "synthetic",
        "mars",
        "submitted",
        fired["run_id"],
    )
    assert event["sequence"] == fired["sequence"]
    assert backend_client_user.get("/trigger/runs/list", params={"experiment_id": experiment_id}).json()["total"] == 1

    # a second fire is a new event, not a duplicate
    again = _fire(backend_client_admin, experiment_id, {"date": EVENT_DATE}).json()
    assert again["status"] == "submitted"
    assert again["sequence"] != fired["sequence"]
    _wait_for_runs(backend_client_user, experiment_id, expected=2)
    page = backend_client_user.get("/trigger/events/list", params={"experiment_id": experiment_id, "page": 1, "page_size": 1}).json()
    assert len(page["events"]) == 1
    assert page["has_more"] is True
    assert page["events"][0]["sequence"] == again["sequence"]


def test_trigger_fire_admin_only(backend_client_user: httpx.Client, backend_client_admin: httpx.Client) -> None:
    blueprint_id, blueprint_version = _save_glyph_blueprint(backend_client_user, "/dev/null")
    experiment_id, _ = _create_trigger(backend_client_user, blueprint_id, blueprint_version)

    response = _fire(backend_client_user, experiment_id, {"date": EVENT_DATE})
    assert response.status_code == 403, response.text
    assert backend_client_user.get("/trigger/runs/list", params={"experiment_id": experiment_id}).json()["total"] == 0
    assert backend_client_user.get("/trigger/events/list", params={"experiment_id": experiment_id}).json()["events"] == []

    response = _fire(backend_client_admin, ExperimentDefinitionId("does-not-exist"), {"date": EVENT_DATE})
    assert response.status_code == 404


def test_trigger_disabled_fire_ignored(backend_client_user: httpx.Client, backend_client_admin: httpx.Client) -> None:
    blueprint_id, blueprint_version = _save_glyph_blueprint(backend_client_user, "/dev/null")
    experiment_id, _ = _create_trigger(backend_client_user, blueprint_id, blueprint_version, enabled=False)

    response = _fire(backend_client_admin, experiment_id, {"date": EVENT_DATE})
    assert response.is_success, response.text
    assert response.json()["status"] == "ignored_disabled"
    assert backend_client_user.get("/trigger/events/list", params={"experiment_id": experiment_id}).json()["events"] == []


def test_trigger_crud_and_versioning(backend_client_user: httpx.Client) -> None:
    blueprint_id, blueprint_version = _save_glyph_blueprint(backend_client_user, "/dev/null")

    response = backend_client_user.get("/trigger/get", params={"experiment_id": "notToBeFound"})
    assert response.status_code == 404

    experiment_id, version = _create_trigger(
        backend_client_user,
        blueprint_id,
        blueprint_version,
        filter={"class": "od"},
        glyph_map={"date": "forecastDate"},
        max_acceptable_delay_hours=12,
        display_name="Trigger test",
    )
    data = backend_client_user.get("/trigger/get", params={"experiment_id": experiment_id}).json()
    assert data["blueprint_id"] == blueprint_id
    assert data["event_type"] == "mars"
    assert data["filter"] == {"class": "od"}
    assert data["glyph_map"] == {"date": "forecastDate"}
    assert data["max_acceptable_delay_hours"] == 12
    assert data["enabled"] is True
    assert data["source"] == "aviso"
    assert data["display_name"] == "Trigger test"

    listed = backend_client_user.get("/trigger/list").json()
    assert experiment_id in [t["experiment_id"] for t in listed["triggers"]]
    assert backend_client_user.get("/trigger/list", params={"page": 0}).status_code == 422

    # update creates a new version, keeping what is not given
    body = TriggerUpdateRequest(experiment_id=experiment_id, version=version, enabled=False).model_dump(mode="json", exclude_unset=True)
    response = backend_client_user.post("/trigger/update", headers=HEADERS, json=body)
    assert response.is_success, response.text
    updated = response.json()
    assert updated["enabled"] is False
    assert updated["experiment_version"] == version + 1
    assert updated["glyph_map"] == {"date": "forecastDate"}
    assert updated["max_acceptable_delay_hours"] == 12

    # a stale version is a conflict, also for delete
    response = backend_client_user.post("/trigger/update", headers=HEADERS, json=body)
    assert response.status_code == 409, response.text
    stale_delete = TriggerDeleteRequest(experiment_id=experiment_id, version=version).model_dump(mode="json")
    assert backend_client_user.post("/trigger/delete", headers=HEADERS, json=stale_delete).status_code == 409

    # an invalid glyph_map is rejected on update as on create
    bad = TriggerUpdateRequest(experiment_id=experiment_id, version=version + 1, glyph_map={"date": "aviso_date"}).model_dump(
        mode="json", exclude_unset=True
    )
    assert backend_client_user.post("/trigger/update", headers=HEADERS, json=bad).status_code == 422

    current = TriggerDeleteRequest(experiment_id=experiment_id, version=version + 1).model_dump(mode="json")
    assert backend_client_user.post("/trigger/delete", headers=HEADERS, json=current).is_success
    assert backend_client_user.get("/trigger/get", params={"experiment_id": experiment_id}).status_code == 404
    assert backend_client_user.get("/trigger/runs/list", params={"experiment_id": experiment_id}).status_code == 404
    assert backend_client_user.post("/trigger/delete", headers=HEADERS, json=current).status_code == 404


def test_trigger_create_rejections(backend_client_user: httpx.Client) -> None:
    blueprint_id, blueprint_version = _save_glyph_blueprint(backend_client_user, "/dev/null")

    for bad_map in ({"date": "aviso_date"}, {"date": "not a glyph"}, {"date": "submitDatetime"}):
        request = TriggerCreateRequest(blueprint_id=blueprint_id, blueprint_version=blueprint_version, event_type="mars", glyph_map=bad_map)
        response = backend_client_user.put("/trigger/create", headers=HEADERS, json=request.model_dump(mode="json"))
        assert response.status_code == 422, (bad_map, response.text)

    unknown = TriggerCreateRequest(blueprint_id=BlueprintId("does-not-exist"), event_type="mars")
    response = backend_client_user.put("/trigger/create", headers=HEADERS, json=unknown.model_dump(mode="json"))
    assert response.status_code == 404


@contextlib.contextmanager
def _second_user_client(admin_client: httpx.Client) -> Generator[httpx.Client, None, None]:
    """Register a second non-admin user and yield a client logged in as it."""
    email, password = "user2@somewhere.org", "user2Password"
    response = admin_client.post("/auth/register", headers=HEADERS, json={"email": email, "password": password})
    assert response.is_success, response.text
    with httpx.Client(base_url=str(admin_client.base_url), follow_redirects=True) as client:
        login = client.post("/auth/jwt/login", data={"username": email, "password": password})
        token = extract_auth_token_from_response(login)
        assert token is not None, "login of the second user failed"
        client.cookies.set(**prepare_cookie_with_auth_token(token))  # ty:ignore[invalid-argument-type]
        me = client.get("/users/me")
        assert me.is_success, me.text
        assert me.json()["is_superuser"] is False
        yield client


def test_trigger_not_visible_to_other_user_and_separate_from_schedules(
    backend_client_user: httpx.Client, backend_client_admin: httpx.Client
) -> None:
    blueprint_id, blueprint_version = _save_glyph_blueprint(backend_client_user, "/dev/null")
    experiment_id, version = _create_trigger(backend_client_user, blueprint_id, blueprint_version)

    # a trigger is not a schedule: the experiment routes do not list or serve it
    schedules = backend_client_user.get("/experiment/list")
    assert schedules.is_success, schedules.text
    assert experiment_id not in [e["experiment_id"] for e in schedules.json()["experiments"]]
    assert backend_client_user.get("/experiment/get", params={"experiment_id": experiment_id}).status_code == 404

    # the admin sees it
    assert backend_client_admin.get("/trigger/get", params={"experiment_id": experiment_id}).is_success

    # a second non-admin user does not
    with _second_user_client(backend_client_admin) as other:
        params = {"experiment_id": experiment_id}
        assert other.get("/trigger/get", params=params).status_code == 404
        assert other.get("/trigger/runs/list", params=params).status_code == 404
        assert other.get("/trigger/events/list", params=params).status_code == 404
        listed = other.get("/trigger/list")
        assert listed.is_success, listed.text
        assert experiment_id not in [t["experiment_id"] for t in listed.json()["triggers"]]

        update = TriggerUpdateRequest(experiment_id=experiment_id, version=version, enabled=False).model_dump(
            mode="json", exclude_unset=True
        )
        assert other.post("/trigger/update", headers=HEADERS, json=update).status_code == 404
        delete = TriggerDeleteRequest(experiment_id=experiment_id, version=version).model_dump(mode="json")
        assert other.post("/trigger/delete", headers=HEADERS, json=delete).status_code == 404

    # the owner's trigger is unchanged
    data = backend_client_user.get("/trigger/get", params={"experiment_id": experiment_id}).json()
    assert data["enabled"] is True
    assert data["experiment_version"] == version


def test_listener_status(backend_client_user: httpx.Client) -> None:
    response = backend_client_user.get("/trigger/operational/listener/status")
    assert response.is_success, response.text
    data = response.json()
    assert data["state"] in {"disabled", "starting", "waiting_prerequisites", "listening", "backoff", "unavailable", "stopped"}
    assert data["stuck_claims"] == 0
