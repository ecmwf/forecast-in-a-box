# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Persistence for handled trigger events and for the active trigger definitions.

Uses the same session maker as ``forecastbox.schemata.jobs`` so all tables share a
single connection pool and in-process tests can monkeypatch a single attribute.
All helpers are synchronous and take the jobs database lock.
"""

import datetime as dt
import logging
from dataclasses import dataclass
from typing import Any, Literal, cast

from pydantic import ValidationError
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError

import forecastbox.schemata.jobs as _jobs_module
from forecastbox.domain.blueprint.types import BlueprintId
from forecastbox.domain.experiment.triggers.spec import AvisoEvent, EventSource, TriggerSpec
from forecastbox.domain.experiment.types import ExperimentDefinitionId
from forecastbox.schemata.experiment import ExperimentDefinition, ExperimentTriggerEvent
from forecastbox.utility.db import dbRetry
from forecastbox.utility.time import current_time

logger = logging.getLogger(__name__)

TriggerEventStatus = Literal["claimed", "submitted", "failed", "skipped_stale"]
_INITIAL_STATUSES: frozenset[str] = frozenset({"claimed", "skipped_stale"})
_FINAL_STATUSES: frozenset[str] = frozenset({"submitted", "failed", "skipped_stale"})
EXTERNAL_TRIGGER_TYPE = "external_trigger"
MESSAGE_MAX_LENGTH = 1024


@dataclass(frozen=True, eq=True, slots=True)
class TriggerEventRecord:
    experiment_id: ExperimentDefinitionId
    source: EventSource
    event_type: str
    sequence: int
    status: TriggerEventStatus
    run_id: str | None
    message: str | None
    published_at: dt.datetime
    created_at: dt.datetime
    updated_at: dt.datetime


@dataclass(frozen=True, eq=True, slots=True)
class ActiveTrigger:
    """The latest non-deleted version of an external-trigger experiment."""

    experiment_id: ExperimentDefinitionId
    version: int
    created_by: str
    created_at: dt.datetime
    blueprint_id: BlueprintId
    blueprint_version: int
    spec: TriggerSpec


def _to_utc(value: dt.datetime) -> dt.datetime:
    # sqlite drops the offset of aware datetimes, so everything stored and compared is UTC
    if value.tzinfo is None:
        return value.replace(tzinfo=dt.UTC)
    return value.astimezone(dt.UTC)


def _truncate(message: str | None) -> str | None:
    return None if message is None else message[:MESSAGE_MAX_LENGTH]


def _to_event_record(row: ExperimentTriggerEvent) -> TriggerEventRecord:
    return TriggerEventRecord(
        experiment_id=ExperimentDefinitionId(str(cast(Any, row.experiment_id))),
        source=cast(EventSource, row.source),
        event_type=cast(str, row.event_type),
        sequence=cast(int, row.sequence),
        status=cast(TriggerEventStatus, row.status),
        run_id=cast(str | None, row.run_id),
        message=cast(str | None, row.message),
        published_at=cast(dt.datetime, row.published_at),
        created_at=cast(dt.datetime, row.created_at),
        updated_at=cast(dt.datetime, row.updated_at),
    )


def claim_event(
    experiment_id: ExperimentDefinitionId,
    event: AvisoEvent,
    status: Literal["claimed", "skipped_stale"] = "claimed",
) -> bool:
    """Record the event as handled for the experiment with the given initial status.  Returns
    False, and changes nothing, if a row for the same (experiment, source, event type,
    sequence) already exists.  The check and the insert are a single atomic statement,
    so exactly one of any number of concurrent claims succeeds."""
    if status not in _INITIAL_STATUSES:
        raise ValueError(f"invalid initial event status {status!r}")
    ref_time = current_time("dbref")

    def function(i: int) -> bool:
        with _jobs_module.sync_session_maker() as session:
            session.add(
                ExperimentTriggerEvent(
                    experiment_id=experiment_id,
                    source=event.source,
                    event_type=event.event_type,
                    sequence=event.sequence,
                    status=status,
                    run_id=None,
                    message=None,
                    published_at=_to_utc(event.published_at),
                    created_at=ref_time,
                    updated_at=ref_time,
                )
            )
            try:
                session.commit()
            except IntegrityError:
                session.rollback()
                return False
            return True

    return dbRetry(function)


def finish_event(
    experiment_id: ExperimentDefinitionId,
    event: AvisoEvent,
    status: Literal["submitted", "failed", "skipped_stale"],
    run_id: str | None = None,
    message: str | None = None,
) -> None:
    """Set the final status, run id and message of a previously claimed event.  The message
    is truncated to the column length.  Logs a warning if no such row exists."""
    if status not in _FINAL_STATUSES:
        raise ValueError(f"invalid final event status {status!r}")
    stmt = (
        update(ExperimentTriggerEvent)
        .where(
            ExperimentTriggerEvent.experiment_id == experiment_id,
            ExperimentTriggerEvent.source == event.source,
            ExperimentTriggerEvent.event_type == event.event_type,
            ExperimentTriggerEvent.sequence == event.sequence,
        )
        .values(status=status, run_id=run_id, message=_truncate(message), updated_at=current_time("dbref"))
    )

    def function(i: int) -> int:
        with _jobs_module.sync_session_maker() as session:
            result = session.execute(stmt)
            session.commit()
            return cast(int, result.rowcount)  # ty:ignore[unresolved-attribute]

    if dbRetry(function) == 0:
        logger.warning(
            f"no handled-event row to finish for experiment={experiment_id} event={event.source}:{event.event_type}#{event.sequence}"
        )


def list_events(experiment_id: ExperimentDefinitionId, limit: int, offset: int = 0) -> list[TriggerEventRecord]:
    """Return handled events of the experiment, most recently claimed first."""
    query = (
        select(ExperimentTriggerEvent)
        .where(ExperimentTriggerEvent.experiment_id == experiment_id)
        .order_by(ExperimentTriggerEvent.event_row_id.desc())
        .offset(offset)
        .limit(limit)
    )

    def function(i: int) -> list[TriggerEventRecord]:
        with _jobs_module.sync_session_maker() as session:
            return [_to_event_record(row[0]) for row in session.execute(query).all()]

    return dbRetry(function)


def count_stuck_claims(older_than: dt.datetime) -> int:
    """Count events across all experiments still in status `claimed` since before `older_than`."""
    query = (
        select(func.count())
        .select_from(ExperimentTriggerEvent)
        .where(ExperimentTriggerEvent.status == "claimed", ExperimentTriggerEvent.created_at < _to_utc(older_than))
    )

    def function(i: int) -> int:
        with _jobs_module.sync_session_maker() as session:
            return session.execute(query).scalar() or 0

    return dbRetry(function)


def list_active_triggers() -> list[ActiveTrigger]:
    """Return the latest version of every non-deleted `external_trigger` experiment, with its
    parsed spec.  Rows whose stored specification is invalid are logged and skipped.
    Disabled triggers are included; the caller decides what to do with `spec.enabled`."""

    def function(i: int) -> list[tuple[Any, ...]]:
        with _jobs_module.sync_session_maker() as session:
            subq = (
                select(
                    ExperimentDefinition.experiment_definition_id,
                    func.max(ExperimentDefinition.version).label("max_version"),
                )
                .where(ExperimentDefinition.is_deleted.is_(False))
                .group_by(ExperimentDefinition.experiment_definition_id)
                .subquery()
            )
            query = (
                select(
                    ExperimentDefinition.experiment_definition_id,
                    ExperimentDefinition.version,
                    ExperimentDefinition.created_by,
                    ExperimentDefinition.created_at,
                    ExperimentDefinition.blueprint_id,
                    ExperimentDefinition.blueprint_version,
                    ExperimentDefinition.experiment_definition,
                )
                .join(
                    subq,
                    (ExperimentDefinition.experiment_definition_id == subq.c.experiment_definition_id)
                    & (ExperimentDefinition.version == subq.c.max_version),
                )
                .where(ExperimentDefinition.experiment_type == EXTERNAL_TRIGGER_TYPE)
                .order_by(ExperimentDefinition.experiment_definition_id)
            )
            return [tuple(row) for row in session.execute(query).all()]

    result: list[ActiveTrigger] = []
    for id_, version, created_by, created_at, blueprint_id, blueprint_version, blob in dbRetry(function):
        experiment_id = ExperimentDefinitionId(str(id_))
        try:
            spec = TriggerSpec.model_validate(blob)
        except ValidationError as e:
            logger.error(f"skipping trigger experiment={experiment_id} version={version} with an invalid specification: {e}")
            continue
        result.append(
            ActiveTrigger(
                experiment_id=experiment_id,
                version=version,
                created_by=created_by,
                created_at=created_at,
                blueprint_id=BlueprintId(str(blueprint_id)),
                blueprint_version=blueprint_version,
                spec=spec,
            )
        )
    return result
