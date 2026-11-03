# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Service layer for event triggers -- experiments of type `external_trigger`.

Two parts:
 - CRUD of trigger experiments and listing of their runs and handled events.  Each operation
   is a synchronous function touching the jobs database, executed by an async wrapper through
   `execution_manager.await_jobs_db` as a single job -- the jobs-db pool being serial, a
   check-then-write sequence like the version check of an update is atomic with respect to
   other callers.  The listener is prodded after every change.
 - `handle_event`, the processing of one event for one trigger, called synchronously by the
   event listener thread and by `fire_trigger`.

No HTTP exceptions are raised here; callers map the domain exceptions:
 - `TriggerNotFound` when the trigger does not exist or is not visible to the caller,
 - `TriggerVersionConflict` when an update or delete carries a stale version,
 - `TriggerSpecInvalid` for an invalid specification,
 - `ExperimentNotFound` when the blueprint does not exist,
 - `ExperimentAccessDenied` when the actor may not modify the trigger,
 - `ValueError` for an out of range page.
"""

import datetime as dt
import logging
import threading
from collections.abc import Iterable
from dataclasses import dataclass
from functools import partial
from typing import Any, Literal, cast

from pydantic import ValidationError

import forecastbox.domain.blueprint.db as blueprint_db
import forecastbox.domain.experiment.db as experiment_db
import forecastbox.domain.experiment.triggers.db as trigger_db
import forecastbox.domain.run.db as run_db
from forecastbox.domain.blueprint.types import BlueprintId
from forecastbox.domain.experiment.exceptions import ExperimentNotFound
from forecastbox.domain.experiment.triggers import control
from forecastbox.domain.experiment.triggers.exceptions import TriggerNotFound, TriggerSpecInvalid, TriggerVersionConflict
from forecastbox.domain.experiment.triggers.spec import (
    AvisoEvent,
    IdentifierValue,
    TriggerEventError,
    TriggerSpec,
    event2context,
    event2glyphs,
    is_stale,
)
from forecastbox.domain.experiment.types import ExperimentDefinitionId
from forecastbox.domain.run.db import CompilerRuntimeContext, RunRecord
from forecastbox.domain.run.service import submit_run_sync
from forecastbox.utility.auth import AuthContext
from forecastbox.utility.concurrency.manager import TaskName, execution_manager
from forecastbox.utility.config import ConcurrentPools
from forecastbox.utility.pagination import PaginationSpec
from forecastbox.utility.time import current_time

logger = logging.getLogger(__name__)

EXPERIMENT_TYPE = trigger_db.EXTERNAL_TRIGGER_TYPE

HandleStatus = Literal["ignored_disabled", "ignored_deleted", "skipped_stale", "duplicate", "submitted", "failed"]


@dataclass(frozen=True, eq=True, slots=True)
class HandleResult:
    """Outcome of handling one event.  The `run_id` is set only for `submitted`; the
    `message` carries the error text of `failed`."""

    status: HandleStatus
    run_id: str | None = None
    message: str | None = None


# ---------------------------------------------------------------------------
# Specification helpers
# ---------------------------------------------------------------------------


def _validate_spec(candidate: dict[str, Any]) -> TriggerSpec:
    try:
        return TriggerSpec.model_validate(candidate)
    except ValidationError as e:
        raise TriggerSpecInvalid(_describe_validation_error(e)) from e


def _describe_validation_error(e: ValidationError) -> str:
    return "; ".join(f"{'.'.join(str(p) for p in err['loc']) or 'spec'}: {err['msg']}" for err in e.errors())


def _fetch_trigger(
    auth_context: AuthContext, experiment_id: ExperimentDefinitionId, version: int | None = None
) -> experiment_db.ExperimentLatest:
    """Return the latest or the pinned version of a trigger visible to the caller, with the
    same ownership scoping as the list.  Raises `TriggerNotFound` otherwise."""
    results = list(
        experiment_db.list_experiment_definitions(
            auth_context=auth_context, experiment_definition_id=experiment_id, version=version, limit=1
        )
    )
    if not results or results[0].experiment.experiment_type != EXPERIMENT_TYPE:
        raise TriggerNotFound(f"Trigger {experiment_id} not found")
    return results[0]


# ---------------------------------------------------------------------------
# Synchronous jobs-db operations
# ---------------------------------------------------------------------------


def _create_trigger_sync(
    auth_context: AuthContext,
    blueprint_id: BlueprintId,
    blueprint_version: int | None,
    spec_fields: dict[str, Any],
    display_name: str | None,
    display_description: str | None,
    tags: list[str] | None,
) -> ExperimentDefinitionId:
    spec = _validate_spec(spec_fields)
    blueprint = blueprint_db.get_blueprint(blueprint_id, blueprint_version)
    if blueprint is None:
        raise ExperimentNotFound(f"Blueprint {blueprint_id!r} not found")
    experiment_id, _ = experiment_db.upsert_experiment_definition(
        auth_context=auth_context,
        blueprint_id=blueprint.blueprint_id,
        blueprint_version=blueprint.version,
        experiment_type=EXPERIMENT_TYPE,
        created_by=auth_context.user_id,
        experiment_definition=spec.model_dump(mode="json"),
        display_name=display_name,
        display_description=display_description,
        tags=tags,
    )
    return experiment_id


def _update_trigger_sync(
    auth_context: AuthContext,
    experiment_id: ExperimentDefinitionId,
    version: int,
    changes: dict[str, Any],
) -> experiment_db.ExperimentLatest:
    current = _fetch_trigger(auth_context, experiment_id).experiment
    if current.version != version:
        raise TriggerVersionConflict(
            f"Version conflict for trigger {experiment_id!r}: expected version {version}, current is {current.version}."
        )
    merged = {**(current.experiment_definition or {}), **{k: v for k, v in changes.items() if v is not None}}
    spec = _validate_spec(merged)
    experiment_db.upsert_experiment_definition(
        auth_context=auth_context,
        experiment_definition_id=experiment_id,
        blueprint_id=current.blueprint_id,
        blueprint_version=current.blueprint_version,
        experiment_type=EXPERIMENT_TYPE,
        created_by=current.created_by,
        experiment_definition=spec.model_dump(mode="json"),
        display_name=current.display_name,
        display_description=current.display_description,
        tags=current.tags,
    )
    return _fetch_trigger(auth_context, experiment_id)


def _delete_trigger_sync(auth_context: AuthContext, experiment_id: ExperimentDefinitionId, version: int) -> None:
    current = _fetch_trigger(auth_context, experiment_id).experiment
    if current.version != version:
        raise TriggerVersionConflict(
            f"Version conflict for trigger {experiment_id!r}: expected version {version}, current is {current.version}."
        )
    experiment_db.soft_delete_experiment_definition(experiment_id, auth_context=auth_context)


def _list_triggers_sync(auth_context: AuthContext, pagination: PaginationSpec) -> tuple[list[experiment_db.ExperimentLatest], int, int]:
    total = experiment_db.count_experiment_definitions(auth_context=auth_context, experiment_type=EXPERIMENT_TYPE)
    start = pagination.start()
    if start >= total and total > 0:
        raise ValueError("Page number out of range.")
    triggers = list(
        experiment_db.list_experiment_definitions(
            auth_context=auth_context, experiment_type=EXPERIMENT_TYPE, offset=start, limit=pagination.page_size
        )
    )
    return triggers, total, pagination.total_pages(total)


def _list_trigger_runs_sync(
    auth_context: AuthContext, experiment_id: ExperimentDefinitionId, pagination: PaginationSpec
) -> tuple[list[RunRecord], int, int]:
    _fetch_trigger(auth_context, experiment_id)
    total = run_db.count_runs_by_experiment(experiment_id, auth_context=auth_context)
    start = pagination.start()
    if start >= total and total > 0:
        raise ValueError("Page number out of range.")
    runs = list(run_db.list_runs_by_experiment(experiment_id, auth_context=auth_context, offset=start, limit=pagination.page_size))
    return runs, total, pagination.total_pages(total)


def _list_trigger_events_sync(
    auth_context: AuthContext, experiment_id: ExperimentDefinitionId, pagination: PaginationSpec
) -> tuple[list[trigger_db.TriggerEventRecord], bool]:
    """Return the events of the page, most recent first, and whether further pages exist."""
    _fetch_trigger(auth_context, experiment_id)
    fetched = trigger_db.list_events(experiment_id, limit=pagination.page_size + 1, offset=pagination.start())
    return fetched[: pagination.page_size], len(fetched) > pagination.page_size


def _load_trigger_spec_sync(experiment_id: ExperimentDefinitionId) -> TriggerSpec:
    """Used by the fire operation, which is admin only and thus not scoped to an owner."""
    current = experiment_db.get_experiment_definition(experiment_id)
    if current is None or current.experiment_type != EXPERIMENT_TYPE:
        raise TriggerNotFound(f"Trigger {experiment_id} not found")
    return _validate_spec(current.experiment_definition or {})


# ---------------------------------------------------------------------------
# Async API for routes
# ---------------------------------------------------------------------------


async def create_trigger(
    auth_context: AuthContext,
    blueprint_id: BlueprintId,
    blueprint_version: int | None,
    event_type: str,
    filter: dict[str, object],
    glyph_map: dict[str, str],
    max_acceptable_delay_hours: int,
    enabled: bool,
    display_name: str | None,
    display_description: str | None,
    tags: list[str] | None,
) -> ExperimentDefinitionId:
    """Create a new trigger experiment on the given blueprint.  Raises `TriggerSpecInvalid`
    for an invalid specification, `ExperimentNotFound` for an unknown blueprint."""
    spec_fields: dict[str, Any] = {
        "source": "aviso",
        "event_type": event_type,
        "filter": filter,
        "glyph_map": glyph_map,
        "max_acceptable_delay_hours": max_acceptable_delay_hours,
        "enabled": enabled,
    }
    experiment_id = cast(
        ExperimentDefinitionId,
        await execution_manager.await_jobs_db(
            "trigger.create",
            partial(
                _create_trigger_sync, auth_context, blueprint_id, blueprint_version, spec_fields, display_name, display_description, tags
            ),
        ),
    )
    control.prod_listener()
    return experiment_id


async def get_trigger(
    auth_context: AuthContext, experiment_id: ExperimentDefinitionId, version: int | None = None
) -> experiment_db.ExperimentLatest:
    """Return a trigger visible to the caller.  Raises `TriggerNotFound`."""
    return cast(
        experiment_db.ExperimentLatest,
        await execution_manager.await_jobs_db("trigger.get", partial(_fetch_trigger, auth_context, experiment_id, version)),
    )


async def list_triggers(auth_context: AuthContext, pagination: PaginationSpec) -> tuple[list[experiment_db.ExperimentLatest], int, int]:
    """Return (triggers, total, total_pages) visible to the caller.  Raises `ValueError`
    if the page is out of range."""
    return cast(
        tuple[list[experiment_db.ExperimentLatest], int, int],
        await execution_manager.await_jobs_db("trigger.list", partial(_list_triggers_sync, auth_context, pagination)),
    )


async def update_trigger(
    auth_context: AuthContext,
    experiment_id: ExperimentDefinitionId,
    version: int,
    event_type: str | None,
    filter: dict[str, object] | None,
    glyph_map: dict[str, str] | None,
    max_acceptable_delay_hours: int | None,
    enabled: bool | None,
) -> experiment_db.ExperimentLatest:
    """Create a new version of the trigger, changing the given fields only.  Raises
    `TriggerVersionConflict` if `version` is not the current one."""
    changes: dict[str, Any] = {
        "event_type": event_type,
        "filter": filter,
        "glyph_map": glyph_map,
        "max_acceptable_delay_hours": max_acceptable_delay_hours,
        "enabled": enabled,
    }
    updated = cast(
        experiment_db.ExperimentLatest,
        await execution_manager.await_jobs_db(
            "trigger.update", partial(_update_trigger_sync, auth_context, experiment_id, version, changes)
        ),
    )
    control.prod_listener()
    return updated


async def delete_trigger(auth_context: AuthContext, experiment_id: ExperimentDefinitionId, version: int) -> None:
    """Soft-delete the trigger.  Raises `TriggerVersionConflict` if `version` is not the current one."""
    await execution_manager.await_jobs_db("trigger.delete", partial(_delete_trigger_sync, auth_context, experiment_id, version))
    control.prod_listener()


async def list_trigger_runs(
    auth_context: AuthContext, experiment_id: ExperimentDefinitionId, pagination: PaginationSpec
) -> tuple[Iterable[RunRecord], int, int]:
    """Return (runs, total, total_pages) of the runs submitted by the trigger."""
    return cast(
        tuple[list[RunRecord], int, int],
        await execution_manager.await_jobs_db(
            "trigger.runs.list", partial(_list_trigger_runs_sync, auth_context, experiment_id, pagination)
        ),
    )


async def list_trigger_events(
    auth_context: AuthContext, experiment_id: ExperimentDefinitionId, pagination: PaginationSpec
) -> tuple[list[trigger_db.TriggerEventRecord], bool]:
    """Return the handled events of the page, most recent first, and whether more pages exist."""
    return cast(
        tuple[list[trigger_db.TriggerEventRecord], bool],
        await execution_manager.await_jobs_db(
            "trigger.events.list", partial(_list_trigger_events_sync, auth_context, experiment_id, pagination)
        ),
    )


# ---------------------------------------------------------------------------
# Event handling
# ---------------------------------------------------------------------------


def _error_text(e: BaseException) -> str:
    return f"{type(e).__name__}: {e}"


def _submit(definition: experiment_db.ExperimentDefinitionRecord, spec: TriggerSpec, event: AvisoEvent) -> HandleResult:
    """Step 4: build the glyphs and submit a run.  Never raises, failures become `failed`."""
    try:
        glyphs = event2glyphs(spec, event)
        blueprint = blueprint_db.get_blueprint(definition.blueprint_id, definition.blueprint_version)
        if blueprint is None:
            return HandleResult("failed", message=f"Blueprint {definition.blueprint_id!r} v{definition.blueprint_version} not found")
        submitted = submit_run_sync(
            blueprint,
            # NOTE the is_admin may be True, but we dont know and its not important for this call
            AuthContext(user_id=definition.created_by, is_admin=False),
            experiment_id=definition.experiment_definition_id,
            experiment_version=definition.version,
            compiler_runtime_context=CompilerRuntimeContext(glyphs=glyphs),
            experiment_context=event2context(event),
        )
        if submitted.t is None:
            return HandleResult("failed", message=str(submitted.e))
        return HandleResult("submitted", run_id=str(submitted.t.run_id))
    except TriggerEventError as e:
        return HandleResult("failed", message=str(e))
    except Exception as e:
        logger.exception(f"submitting a run for trigger {definition.experiment_definition_id} failed")
        return HandleResult("failed", message=_error_text(e))


def _handle_event(experiment_id: ExperimentDefinitionId, event: AvisoEvent) -> HandleResult:
    # 1. the latest definition decides whether to handle at all
    definition = experiment_db.get_experiment_definition(experiment_id)
    if definition is None or definition.experiment_type != EXPERIMENT_TYPE:
        return HandleResult("ignored_deleted")
    try:
        spec = TriggerSpec.model_validate(definition.experiment_definition or {})
    except ValidationError as e:
        logger.error(f"trigger {experiment_id} has an invalid specification, event not handled: {e}")
        return HandleResult("failed", message=f"invalid trigger specification: {_describe_validation_error(e)}")
    if not spec.enabled:
        return HandleResult("ignored_disabled")

    # 2. an event older than the acceptable delay is recorded, not run
    if is_stale(spec, event, current_time("scheduling")):
        claimed_stale = trigger_db.claim_event(experiment_id, event, status="skipped_stale")
        return HandleResult("skipped_stale" if claimed_stale else "duplicate")

    # 3. the atomic claim makes at most one handler win per event
    if not trigger_db.claim_event(experiment_id, event):
        return HandleResult("duplicate")

    # 4. submit
    result = _submit(definition, spec, event)

    # 5. record the outcome.  Should this fail, the row stays `claimed` and is reported as stuck
    try:
        if result.status == "submitted":
            trigger_db.finish_event(experiment_id, event, "submitted", run_id=result.run_id)
        else:
            trigger_db.finish_event(experiment_id, event, "failed", message=result.message)
    except Exception:
        logger.exception(f"recording the outcome of event {event2context(event)} of trigger {experiment_id} failed")
    return result


def handle_event(experiment_id: ExperimentDefinitionId, event: AvisoEvent) -> HandleResult:
    """Handle one event of one trigger.  Synchronous, to be called from a thread, never from
    the event loop.  Steps:

    1. load the latest definition; if deleted or disabled return without recording anything,
    2. if the event is stale, record it as `skipped_stale` and return,
    3. claim the event -- an existing row for the same (experiment, source, event type,
       sequence) means it is `duplicate`,
    4. build the glyphs and submit a run as the creator of the trigger,
    5. record `submitted` with the run id, or `failed` with the error text.

    At most one run is submitted per event.  Does not raise: any failure is logged and
    returned as `failed`.  A failed event is not retried, and does not influence others.
    """
    try:
        return _handle_event(experiment_id, event)
    except Exception as e:
        logger.exception(f"handling event {event2context(event)} of trigger {experiment_id} failed unexpectedly")
        return HandleResult("failed", message=_error_text(e))


# ---------------------------------------------------------------------------
# Synthetic events
# ---------------------------------------------------------------------------

_sequence_lock = threading.Lock()
_last_sequence = 0


def next_synthetic_sequence() -> int:
    """Return a sequence for a synthetic event: unique and increasing within the process, and
    at least the current time in ms so that it also does not repeat across restarts."""
    global _last_sequence
    now_ms = int(current_time("scheduling").timestamp() * 1000)
    with _sequence_lock:
        _last_sequence = max(_last_sequence + 1, now_ms)
        return _last_sequence


@dataclass(frozen=True, eq=True, slots=True)
class FireResult:
    sequence: int
    result: HandleResult


async def fire_trigger(experiment_id: ExperimentDefinitionId, identifier: dict[str, IdentifierValue]) -> FireResult:
    """Handle a synthetic event with the given identifier as if the trigger had received it.
    The event has the trigger's event type, the source `synthetic` and no payload.  Does not
    check authorization -- the caller must.  Raises `TriggerNotFound`."""
    spec = cast(
        TriggerSpec,
        await execution_manager.await_jobs_db("trigger.fire.load", partial(_load_trigger_spec_sync, experiment_id)),
    )
    event = AvisoEvent(
        source="synthetic",
        event_type=spec.event_type,
        sequence=next_synthetic_sequence(),
        identifier=identifier,
        payload=None,
        published_at=current_time("scheduling"),
    )
    result = cast(
        HandleResult,
        await execution_manager.awaitable_submit(
            ConcurrentPools.General, TaskName("trigger.fire"), partial(handle_event, experiment_id, event)
        ),
    )
    return FireResult(sequence=event.sequence, result=result)


STUCK_CLAIM_AGE = dt.timedelta(minutes=10)


async def count_stuck_claims() -> int:
    """Count events across all triggers that are `claimed` for longer than `STUCK_CLAIM_AGE`,
    ie, whose handling probably crashed between claim and outcome."""
    cutoff = current_time("scheduling") - STUCK_CLAIM_AGE
    return cast(int, await execution_manager.await_jobs_db("trigger.stuck-claims", partial(trigger_db.count_stuck_claims, cutoff)))
