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

from sqlalchemy import delete, func, select, update

import forecastbox.schemata.jobs as _jobs_module
from forecastbox.domain.experiment.types import ExperimentDefinitionId
from forecastbox.schemata.jobs import ExperimentDefinition, ExperimentNext
from forecastbox.utility.db import addAndCommit, dbRetry, executeAndCommit, querySingle


async def upsert_experiment_next(*, experiment_id: ExperimentDefinitionId, scheduled_at: dt.datetime) -> None:
    """Insert or update the next scheduled run time for an experiment."""
    ref_time = dt.datetime.now()
    existing = await querySingle(
        select(ExperimentNext).where(ExperimentNext.experiment_id == experiment_id),
        _jobs_module.async_session_maker,
    )
    if existing:
        stmt = (
            update(ExperimentNext)
            .where(ExperimentNext.experiment_id == experiment_id)
            .values(scheduled_at=scheduled_at, updated_at=ref_time)
        )
        await executeAndCommit(stmt, _jobs_module.async_session_maker)
    else:
        entity = ExperimentNext(
            experiment_next_id=str(uuid.uuid4()),
            experiment_id=experiment_id,
            scheduled_at=scheduled_at,
            updated_at=ref_time,
        )
        await addAndCommit(entity, _jobs_module.async_session_maker)


async def get_experiment_next(experiment_id: ExperimentDefinitionId) -> ExperimentNext | None:
    """Return the next scheduled run entry for an experiment."""
    query = select(ExperimentNext).where(ExperimentNext.experiment_id == experiment_id)
    return await querySingle(query, _jobs_module.async_session_maker)


async def delete_experiment_next(experiment_id: ExperimentDefinitionId) -> None:
    """Remove the next scheduled run entry for an experiment, clearing the pending tick."""
    stmt = delete(ExperimentNext).where(ExperimentNext.experiment_id == experiment_id)
    await executeAndCommit(stmt, _jobs_module.async_session_maker)


async def get_schedulable_experiments(now: dt.datetime) -> list[tuple[ExperimentNext, ExperimentDefinition]]:
    """Return (ExperimentNext, ExperimentDefinition) pairs due for execution.

    Joins ExperimentNext with the latest non-deleted ExperimentDefinition of type
    'cron_schedule'. Disabled schedules have their ExperimentNext row deleted at
    update time, so should not appear here -- but if they would, we handle at the
    scheduler thread by logging error and deleting their ExperimentNext.
    """

    async def function(i: int) -> list[tuple[ExperimentNext, ExperimentDefinition]]:
        async with _jobs_module.async_session_maker() as session:
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
            result = await session.execute(query)
            return [(row[0], row[1]) for row in result.all()]

    return await dbRetry(function)


async def next_schedulable_experiment() -> dt.datetime | None:
    """Return the earliest scheduled_at across all ExperimentNext rows."""

    async def function(i: int) -> dt.datetime | None:
        async with _jobs_module.async_session_maker() as session:
            query = select(func.min(ExperimentNext.scheduled_at))
            result = await session.execute(query)
            return result.scalar_one_or_none()

    return await dbRetry(function)
