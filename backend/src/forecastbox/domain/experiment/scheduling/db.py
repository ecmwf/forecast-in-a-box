# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Persistence for ExperimentNext and scheduler-support helpers.

Uses the same session maker as ``forecastbox.schemata.jobs`` so all tables share a
single connection pool and in-process tests can monkeypatch a single attribute.
"""

import datetime as dt
import uuid
from dataclasses import dataclass
from typing import Any, cast

from sqlalchemy import delete, func, select, update

import forecastbox.schemata.jobs as _jobs_module
from forecastbox.domain.experiment import db as experiment_db
from forecastbox.domain.experiment.types import ExperimentDefinitionId
from forecastbox.schemata.jobs import ExperimentDefinition, ExperimentNext
from forecastbox.utility.db import addAndCommit, dbRetry, executeAndCommit, querySingle
from forecastbox.utility.time import current_time


@dataclass(frozen=True, eq=True, slots=True)
class ExperimentNextRecord:
    experiment_next_id: str
    experiment_id: ExperimentDefinitionId
    scheduled_at: dt.datetime
    updated_at: dt.datetime


def _to_experiment_next_record(row: ExperimentNext) -> ExperimentNextRecord:
    return ExperimentNextRecord(
        experiment_next_id=str(cast(Any, row.experiment_next_id)),
        experiment_id=ExperimentDefinitionId(str(cast(Any, row.experiment_id))),
        scheduled_at=cast(dt.datetime, row.scheduled_at),
        updated_at=cast(dt.datetime, row.updated_at),
    )


def upsert_experiment_next(*, experiment_id: ExperimentDefinitionId, scheduled_at: dt.datetime) -> None:
    """Insert or update the next scheduled run time for an experiment."""
    ref_time = current_time("dbref")
    existing = querySingle(
        select(ExperimentNext).where(ExperimentNext.experiment_id == experiment_id),
        _jobs_module.sync_session_maker,
    )
    if existing:
        stmt = (
            update(ExperimentNext)
            .where(ExperimentNext.experiment_id == experiment_id)
            .values(scheduled_at=scheduled_at, updated_at=ref_time)
        )
        executeAndCommit(stmt, _jobs_module.sync_session_maker)
    else:
        entity = ExperimentNext(
            experiment_next_id=str(uuid.uuid4()),
            experiment_id=experiment_id,
            scheduled_at=scheduled_at,
            updated_at=ref_time,
        )
        addAndCommit(entity, _jobs_module.sync_session_maker)


def get_experiment_next(experiment_id: ExperimentDefinitionId) -> ExperimentNextRecord | None:
    """Return the next scheduled run entry for an experiment."""
    query = select(ExperimentNext).where(ExperimentNext.experiment_id == experiment_id)
    row = querySingle(query, _jobs_module.sync_session_maker)
    return None if row is None else _to_experiment_next_record(row)


def delete_experiment_next(experiment_id: ExperimentDefinitionId) -> None:
    """Remove the next scheduled run entry for an experiment, clearing the pending tick."""
    stmt = delete(ExperimentNext).where(ExperimentNext.experiment_id == experiment_id)
    executeAndCommit(stmt, _jobs_module.sync_session_maker)


def get_schedulable_experiments(now: dt.datetime) -> list[tuple[ExperimentNextRecord, experiment_db.ExperimentDefinitionRecord]]:
    """Return due ``(ExperimentNext, ExperimentDefinition)`` pairs."""

    def function(i: int) -> list[tuple[ExperimentNextRecord, experiment_db.ExperimentDefinitionRecord]]:
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
            return [(_to_experiment_next_record(row[0]), experiment_db._to_experiment_record(row[1])) for row in result.all()]

    return dbRetry(function)


def next_schedulable_experiment() -> dt.datetime | None:
    """Return the earliest scheduled_at across all ExperimentNext rows."""

    def function(i: int) -> dt.datetime | None:
        with _jobs_module.sync_session_maker() as session:
            query = select(func.min(ExperimentNext.scheduled_at))
            result = session.execute(query)
            return result.scalar_one_or_none()

    return dbRetry(function)
