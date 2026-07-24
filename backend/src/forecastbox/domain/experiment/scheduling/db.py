# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Synchronous persistence helpers for ExperimentNext and scheduler support.

Each helper owns its session and transaction and must be submitted to the
``ConcurrentPools.JobsDb`` worker by a route, service, or background-thread
orchestrator.
"""

import datetime as dt
import uuid
from dataclasses import dataclass
from typing import Any, cast

from sqlalchemy import delete, func, select, update

import forecastbox.schemata.jobs as _jobs_module
from forecastbox.domain.experiment.db import ExperimentDefinitionRecord
from forecastbox.domain.experiment.db import _to_record as _experiment_to_record
from forecastbox.domain.experiment.types import ExperimentDefinitionId
from forecastbox.schemata.jobs import ExperimentDefinition, ExperimentNext
from forecastbox.utility.db import dbRetry
from forecastbox.utility.time import current_time


@dataclass(frozen=True, eq=True, slots=True)
class ExperimentNextRecord:
    experiment_next_id: str
    experiment_id: str
    scheduled_at: dt.datetime
    updated_at: dt.datetime


def _to_record(row: ExperimentNext) -> ExperimentNextRecord:
    return ExperimentNextRecord(
        experiment_next_id=cast(str, row.experiment_next_id),
        experiment_id=cast(str, row.experiment_id),
        scheduled_at=cast(dt.datetime, row.scheduled_at),
        updated_at=cast(dt.datetime, row.updated_at),
    )


def upsert_experiment_next(*, experiment_id: ExperimentDefinitionId, scheduled_at: dt.datetime) -> None:
    """Insert or update the next scheduled run time for an experiment."""
    ref_time = current_time("dbref")

    def function(i: int) -> None:
        with _jobs_module.session_maker() as session:
            existing = session.execute(select(ExperimentNext).where(ExperimentNext.experiment_id == experiment_id)).scalar_one_or_none()
            if existing is not None:
                existing.scheduled_at = scheduled_at
                existing.updated_at = ref_time
            else:
                session.add(
                    ExperimentNext(
                        experiment_next_id=str(uuid.uuid4()),
                        experiment_id=experiment_id,
                        scheduled_at=scheduled_at,
                        updated_at=ref_time,
                    )
                )
            session.commit()

    dbRetry(function)


def get_experiment_next(experiment_id: ExperimentDefinitionId) -> ExperimentNextRecord | None:
    """Return the next scheduled run entry for an experiment."""

    def function(i: int) -> ExperimentNextRecord | None:
        with _jobs_module.session_maker() as session:
            row = session.execute(select(ExperimentNext).where(ExperimentNext.experiment_id == experiment_id)).scalar_one_or_none()
            return None if row is None else _to_record(row)

    return dbRetry(function)


def delete_experiment_next(experiment_id: ExperimentDefinitionId) -> None:
    """Remove the next scheduled run entry for an experiment, clearing the pending tick."""

    def function(i: int) -> None:
        with _jobs_module.session_maker() as session:
            session.execute(delete(ExperimentNext).where(ExperimentNext.experiment_id == experiment_id))
            session.commit()

    dbRetry(function)


def get_schedulable_experiments(now: dt.datetime) -> list[tuple[ExperimentNextRecord, ExperimentDefinitionRecord]]:
    """Return due ExperimentNext rows joined with the latest cron schedule version.

    Joins ``ExperimentNext`` with the latest non-deleted
    ``ExperimentDefinition`` of type ``cron_schedule``. Disabled schedules have
    their ``ExperimentNext`` row deleted at update time, so they should not
    appear here, but the scheduler thread still treats their presence as an
    error and deletes the stale row.
    """

    def function(i: int) -> list[tuple[ExperimentNextRecord, ExperimentDefinitionRecord]]:
        with _jobs_module.session_maker() as session:
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
                select(ExperimentNext, ExperimentDefinition)
                .where(ExperimentNext.scheduled_at <= now)
                .join(subq, ExperimentNext.experiment_id == subq.c.experiment_definition_id)
                .join(
                    ExperimentDefinition,
                    (ExperimentDefinition.experiment_definition_id == subq.c.experiment_definition_id)
                    & (ExperimentDefinition.version == subq.c.max_version),
                )
                .where(ExperimentDefinition.experiment_type == "cron_schedule")
            )
            result = session.execute(query)
            return [(_to_record(row[0]), _experiment_to_record(row[1])) for row in result.all()]

    return dbRetry(function)


def next_schedulable_experiment() -> dt.datetime | None:
    """Return the earliest scheduled_at across all ExperimentNext rows."""

    def function(i: int) -> dt.datetime | None:
        with _jobs_module.session_maker() as session:
            result = session.execute(select(func.min(ExperimentNext.scheduled_at)))
            return cast(dt.datetime | None, result.scalar_one_or_none())

    return dbRetry(function)
