# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""
Event trigger routes -- /trigger/*. Corresponds to the `domain.experiment.triggers` submodule.

An event trigger is an Experiment which submits a run of its Blueprint for each matching
external (Aviso) event, passing the event fields to the run as glyphs. Contains:
 - complete CRUD+list for the trigger,
 - routes related to the domain entities of a trigger -- the Runs it submitted, and the events
   it handled together with the outcome of each,
 - operational routes -- the status of the event listener, and firing a synthetic event for
   testing. Those are not related to any domain entity, but to backend itself
"""

import datetime as dt
import logging
from typing import Annotated, Any, Literal, cast

from fastapi import APIRouter, Depends
from fastapi.exceptions import HTTPException
from pydantic import PositiveInt

from forecastbox.domain.auth.users import get_auth_context
from forecastbox.domain.blueprint.types import BlueprintId
from forecastbox.domain.experiment import db as experiment_db
from forecastbox.domain.experiment.exceptions import ExperimentAccessDenied, ExperimentNotFound, ExperimentVersionConflict
from forecastbox.domain.experiment.triggers import control, service
from forecastbox.domain.experiment.triggers import db as trigger_db
from forecastbox.domain.experiment.triggers.exceptions import TriggerSpecInvalid
from forecastbox.domain.experiment.types import ExperimentDefinitionId
from forecastbox.domain.run.types import RunId
from forecastbox.utility.auth import AuthContext
from forecastbox.utility.config import ROUTE_PREFIX
from forecastbox.utility.pagination import PaginationSpec
from forecastbox.utility.pydantic import FiabBaseModel
from forecastbox.utility.time import value_dt2str

PREFIX = f"{ROUTE_PREFIX}/trigger"

logger = logging.getLogger(__name__)

router = APIRouter(
    tags=["trigger"],
    responses={404: {"description": "Not found"}},
)


# ---------------------------------------------------------------------------
# Route-local contracts
# ---------------------------------------------------------------------------


class TriggerLookup(FiabBaseModel):
    """Identifies a trigger, optionally pinning a specific version.

    Used as a Depends()-based query-param group on GET endpoints.
    """

    experiment_id: ExperimentDefinitionId
    version: int | None = None


class TriggerCreateRequest(FiabBaseModel):
    """Create a trigger. The `glyph_map` maps a field of the event identifier to the name of an
    additional glyph filled with its value."""

    blueprint_id: BlueprintId
    blueprint_version: int | None = None
    event_type: str
    filter: dict[str, Any] = {}
    glyph_map: dict[str, str] = {}
    max_acceptable_delay_hours: PositiveInt = 24
    enabled: bool = True
    display_name: str | None = None
    display_description: str | None = None
    tags: list[str] | None = None


class TriggerCreateResponse(FiabBaseModel):
    experiment_id: ExperimentDefinitionId


class TriggerDetail(FiabBaseModel):
    experiment_id: ExperimentDefinitionId
    experiment_version: int
    blueprint_id: BlueprintId
    blueprint_version: int
    source: Literal["aviso"]
    event_type: str
    filter: dict[str, Any]
    glyph_map: dict[str, str]
    max_acceptable_delay_hours: int
    enabled: bool
    created_at: str
    updated_at: str
    user: str
    display_name: str | None
    display_description: str | None
    tags: list[str] | None = None


class TriggerListResponse(FiabBaseModel):
    triggers: list[TriggerDetail]
    total: int
    page: int
    page_size: int
    total_pages: int


class TriggerUpdateRequest(FiabBaseModel):
    """Update a trigger; fields left out keep their value. ``version`` must match the current version."""

    experiment_id: ExperimentDefinitionId
    version: int
    event_type: str | None = None
    filter: dict[str, Any] | None = None
    glyph_map: dict[str, str] | None = None
    max_acceptable_delay_hours: PositiveInt | None = None
    enabled: bool | None = None


class TriggerDeleteRequest(FiabBaseModel):
    """Soft-delete a trigger. ``version`` must match the current version."""

    experiment_id: ExperimentDefinitionId
    version: int


class TriggerRunDetail(FiabBaseModel):
    run_id: RunId
    attempt_count: int
    status: str
    created_at: str
    updated_at: str
    experiment_context: str | None


class TriggerRunsResponse(FiabBaseModel):
    runs: list[TriggerRunDetail]
    total: int
    page: int
    page_size: int
    total_pages: int


class TriggerEventDetail(FiabBaseModel):
    source: Literal["aviso", "synthetic"]
    event_type: str
    sequence: int
    status: Literal["claimed", "submitted", "failed", "skipped_stale"]
    run_id: RunId | None
    message: str | None
    published_at: str
    created_at: str
    updated_at: str


class TriggerEventsResponse(FiabBaseModel):
    """A page of handled events, most recent first. There is no total, only whether more pages follow."""

    events: list[TriggerEventDetail]
    page: int
    page_size: int
    has_more: bool


class ListenerStatusResponse(FiabBaseModel):
    state: Literal["disabled", "starting", "waiting_prerequisites", "listening", "backoff", "unavailable", "stopped"]
    message: str | None
    active_triggers: int
    last_event_at: str | None
    last_error: str | None
    stuck_claims: int
    """Number of events across all triggers that have been `claimed` for over 10 minutes."""


class TriggerFireRequest(FiabBaseModel):
    """Fire a synthetic event at a trigger. The `identifier` plays the role of the identifier of an Aviso event."""

    experiment_id: ExperimentDefinitionId
    identifier: dict[str, str | int | float | list[str]]


class TriggerFireResponse(FiabBaseModel):
    experiment_id: ExperimentDefinitionId
    sequence: int
    status: Literal["ignored_disabled", "ignored_deleted", "skipped_stale", "duplicate", "submitted", "failed"]
    run_id: RunId | None
    message: str | None


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _trigger_to_detail(exp: experiment_db.ExperimentDefinitionRecord, entity_created_at: dt.datetime) -> TriggerDetail:
    exp_def = exp.experiment_definition or {}
    return TriggerDetail(
        experiment_id=ExperimentDefinitionId(str(exp.experiment_definition_id)),
        experiment_version=exp.version,
        blueprint_id=BlueprintId(str(exp.blueprint_id)),
        blueprint_version=exp.blueprint_version,
        source="aviso",
        event_type=str(exp_def.get("event_type", "")),
        filter=dict(exp_def.get("filter", {})),
        glyph_map=dict(exp_def.get("glyph_map", {})),
        max_acceptable_delay_hours=int(exp_def.get("max_acceptable_delay_hours", 24)),
        enabled=bool(exp_def.get("enabled", True)),
        created_at=value_dt2str(entity_created_at),
        updated_at=value_dt2str(exp.created_at),
        user=exp.created_by,
        display_name=exp.display_name,
        display_description=exp.display_description,
        tags=exp.tags,
    )


def _event_to_detail(event: trigger_db.TriggerEventRecord) -> TriggerEventDetail:
    return TriggerEventDetail(
        source=event.source,
        event_type=event.event_type,
        sequence=event.sequence,
        status=event.status,
        run_id=RunId(event.run_id) if event.run_id is not None else None,
        message=event.message,
        published_at=value_dt2str(event.published_at),
        created_at=value_dt2str(event.created_at),
        updated_at=value_dt2str(event.updated_at),
    )


# ---------------------------------------------------------------------------
# Trigger CRUD endpoints
# ---------------------------------------------------------------------------


@router.put("/create")
async def create_trigger(
    request: TriggerCreateRequest,
    auth_context: AuthContext = Depends(get_auth_context),
) -> TriggerCreateResponse:
    """Create a new event trigger on a blueprint."""
    try:
        experiment_id = await service.create_trigger(
            auth_context=auth_context,
            blueprint_id=request.blueprint_id,
            blueprint_version=request.blueprint_version,
            event_type=request.event_type,
            filter=request.filter,
            glyph_map=request.glyph_map,
            max_acceptable_delay_hours=request.max_acceptable_delay_hours,
            enabled=request.enabled,
            display_name=request.display_name,
            display_description=request.display_description,
            tags=request.tags,
        )
    except TriggerSpecInvalid as e:
        raise HTTPException(status_code=422, detail=str(e))
    except ExperimentNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ExperimentAccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))
    return TriggerCreateResponse(experiment_id=experiment_id)


@router.get("/get")
async def get_trigger(
    spec: Annotated[TriggerLookup, Depends()],
    auth_context: AuthContext = Depends(get_auth_context),
) -> TriggerDetail:
    """Retrieve a single trigger by id."""
    try:
        latest = await service.get_trigger(auth_context, spec.experiment_id, spec.version)
    except ExperimentNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    return _trigger_to_detail(latest.experiment, latest.created_at)


@router.get("/list")
async def list_triggers(
    pagination: Annotated[PaginationSpec, Depends()],
    auth_context: AuthContext = Depends(get_auth_context),
) -> TriggerListResponse:
    """List triggers visible to the caller, with pagination."""
    try:
        triggers, total, total_pages = await service.list_triggers(auth_context, pagination)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    items = [_trigger_to_detail(row.experiment, row.created_at) for row in triggers]
    return TriggerListResponse(triggers=items, total=total, page=pagination.page, page_size=pagination.page_size, total_pages=total_pages)


@router.post("/update")
async def update_trigger(
    update: TriggerUpdateRequest,
    auth_context: AuthContext = Depends(get_auth_context),
) -> TriggerDetail:
    """Update a trigger. All fields are optional.

    ``version`` must match the current trigger version; returns 409 if it does not.
    """
    try:
        updated = await service.update_trigger(
            auth_context=auth_context,
            experiment_id=update.experiment_id,
            version=update.version,
            event_type=update.event_type,
            filter=update.filter,
            glyph_map=update.glyph_map,
            max_acceptable_delay_hours=update.max_acceptable_delay_hours,
            enabled=update.enabled,
        )
    except TriggerSpecInvalid as e:
        raise HTTPException(status_code=422, detail=str(e))
    except ExperimentVersionConflict as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ExperimentNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ExperimentAccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))
    return _trigger_to_detail(updated.experiment, updated.created_at)


@router.post("/delete")
async def delete_trigger(
    request: TriggerDeleteRequest,
    auth_context: AuthContext = Depends(get_auth_context),
) -> None:
    """Soft-delete a trigger.

    ``version`` must match the current trigger version; returns 409 if it does not.
    """
    try:
        await service.delete_trigger(auth_context, request.experiment_id, request.version)
    except ExperimentVersionConflict as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ExperimentNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ExperimentAccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))


# ---------------------------------------------------------------------------
# Runs and events of a trigger
# ---------------------------------------------------------------------------


@router.get("/runs/list")
async def list_trigger_runs(
    spec: Annotated[TriggerLookup, Depends()],
    pagination: Annotated[PaginationSpec, Depends()],
    auth_context: AuthContext = Depends(get_auth_context),
) -> TriggerRunsResponse:
    """Return paginated runs submitted by a trigger."""
    try:
        runs, total, total_pages = await service.list_trigger_runs(auth_context, spec.experiment_id, pagination)
    except ExperimentNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    items = [
        TriggerRunDetail(
            run_id=RunId(str(run.run_id)),
            attempt_count=run.attempt_count,
            status=cast(str, run.status),
            created_at=str(run.created_at),
            updated_at=str(run.updated_at),
            experiment_context=run.experiment_context,
        )
        for run in runs
    ]
    return TriggerRunsResponse(runs=items, total=total, page=pagination.page, page_size=pagination.page_size, total_pages=total_pages)


@router.get("/events/list")
async def list_trigger_events(
    spec: Annotated[TriggerLookup, Depends()],
    pagination: Annotated[PaginationSpec, Depends()],
    auth_context: AuthContext = Depends(get_auth_context),
) -> TriggerEventsResponse:
    """Return paginated events handled by a trigger, most recent first, with the outcome of each."""
    try:
        events, has_more = await service.list_trigger_events(auth_context, spec.experiment_id, pagination)
    except ExperimentNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    return TriggerEventsResponse(
        events=[_event_to_detail(event) for event in events], page=pagination.page, page_size=pagination.page_size, has_more=has_more
    )


# ---------------------------------------------------------------------------
# Operational endpoints
# ---------------------------------------------------------------------------


@router.get("/operational/listener/status")
async def get_listener_status(auth_context: AuthContext = Depends(get_auth_context)) -> ListenerStatusResponse:
    """Return the state of the event listener and the number of stuck claimed events."""
    status = control.listener_status()
    stuck_claims = await service.count_stuck_claims()
    return ListenerStatusResponse(
        state=status.state,
        message=status.message,
        active_triggers=status.active_triggers,
        last_event_at=value_dt2str(status.last_event_at) if status.last_event_at is not None else None,
        last_error=status.last_error,
        stuck_claims=stuck_claims,
    )


@router.post("/operational/fire")
async def fire_trigger(
    request: TriggerFireRequest,
    auth_context: AuthContext = Depends(get_auth_context),
) -> TriggerFireResponse:
    """Handle a synthetic event as if the trigger had received it from Aviso. Requires admin access.

    The event has the event type of the trigger and the given identifier; it is recorded as
    handled with the source `synthetic`, thus never collides with real events.
    """
    if not auth_context.has_admin():
        raise HTTPException(status_code=403, detail="Only admins may fire trigger events.")
    try:
        fired = await service.fire_trigger(request.experiment_id, request.identifier)
    except ExperimentNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    except TriggerSpecInvalid as e:
        raise HTTPException(status_code=422, detail=str(e))
    return TriggerFireResponse(
        experiment_id=request.experiment_id,
        sequence=fired.sequence,
        status=fired.result.status,
        run_id=RunId(fired.result.run_id) if fired.result.run_id is not None else None,
        message=fired.result.message,
    )
