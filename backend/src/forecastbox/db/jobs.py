# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""DB helpers for the jobs database.

Provides insert / get / list / update-runtime / soft-delete operations for
each table.  "Latest version" and "latest attempt" semantics are resolved
deterministically by ordering on the version / attempt_count column and
taking the maximum.

Soft-deleted rows are excluded from all normal read operations.
We maintain that setting a delete sets it on all versions of a given entity,
leading to simpler query semantics, ie, no need to select "last non-deleted".
"""

import datetime as dt
import uuid
from collections.abc import Iterable

from sqlalchemy import delete as sa_delete
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from forecastbox.db.core import addAndCommit, dbRetry, executeAndCommit, querySingle
from forecastbox.schemas.jobs import (
    Base,
    ExperimentDefinition,
    ExperimentNext,
    ExperimentType,
    JobDefinition,
    JobDefinitionSource,
    JobExecution,
    JobExecutionStatus,
)
from forecastbox.utility.config import config

async_url = f"sqlite+aiosqlite:///{config.db.sqlite_jobdb_path}"
async_engine = create_async_engine(async_url, pool_pre_ping=True)
async_session_maker = async_sessionmaker(async_engine, expire_on_commit=False)


async def create_db_and_tables() -> None:
    """Create the jobs database and all its tables on startup."""
    async with async_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


# ---------------------------------------------------------------------------
# JobDefinition
# ---------------------------------------------------------------------------


async def upsert_job_definition(
    *,
    definition_id: str | None = None,
    source: JobDefinitionSource,
    created_by: str | None,
    blocks: dict | None = None,
    environment_spec: dict | None = None,
    display_name: str | None = None,
    display_description: str | None = None,
    tags: list[str] | None = None,
    parent_id: str | None = None,
) -> tuple[str, int]:
    """Insert a new version of a JobDefinition and return (id, version).

    If `id` is omitted a fresh UUID is generated (version 1).
    If `id` is supplied the next version number is derived from the database;
    a KeyError is raised if that id does not exist yet.
    """
    id_provided = definition_id is not None
    definition_id = definition_id or str(uuid.uuid4())
    ref_time = dt.datetime.now()

    async def function(i: int) -> int:
        async with async_session_maker() as session:
            result = await session.execute(select(func.max(JobDefinition.version)).where(JobDefinition.job_definition_id == definition_id))
            max_version: int | None = result.scalar()
            if id_provided and max_version is None:
                raise KeyError(f"No JobDefinition with id={definition_id!r} exists; cannot add a new version.")
            new_version = (max_version or 0) + 1
            session.add(
                JobDefinition(
                    job_definition_id=definition_id,
                    version=new_version,
                    created_by=created_by,
                    created_at=ref_time,
                    source=source,
                    parent_id=parent_id,
                    display_name=display_name,
                    display_description=display_description,
                    tags=tags,
                    blocks=blocks,
                    environment_spec=environment_spec,
                    is_deleted=False,
                )
            )
            await session.commit()
            return new_version

    new_version = await dbRetry(function)
    return definition_id, new_version


async def get_job_definition(definition_id: str, version: int | None = None) -> JobDefinition | None:
    """Return a specific or the latest non-deleted version of a JobDefinition."""
    if version is not None:
        query = select(JobDefinition).where(
            JobDefinition.job_definition_id == definition_id,
            JobDefinition.version == version,
            JobDefinition.is_deleted.is_(False),
        )
    else:
        query = (
            select(JobDefinition)
            .where(JobDefinition.job_definition_id == definition_id, JobDefinition.is_deleted.is_(False))
            .order_by(JobDefinition.version.desc())
            .limit(1)
        )
    return await querySingle(query, async_session_maker)


async def list_job_definitions() -> Iterable[JobDefinition]:
    """Return the latest non-deleted version of every JobDefinition."""

    async def function(i: int) -> list[JobDefinition]:
        async with async_session_maker() as session:
            subq = (
                select(JobDefinition.job_definition_id, func.max(JobDefinition.version).label("max_version"))
                .where(JobDefinition.is_deleted.is_(False))
                .group_by(JobDefinition.job_definition_id)
                .subquery()
            )
            query = select(JobDefinition).join(
                subq,
                (JobDefinition.job_definition_id == subq.c.job_definition_id) & (JobDefinition.version == subq.c.max_version),
            )
            result = await session.execute(query)
            return [r[0] for r in result.all()]

    return await dbRetry(function)


async def soft_delete_job_definition(definition_id: str) -> None:
    """Mark all versions of a JobDefinition as deleted."""
    stmt = update(JobDefinition).where(JobDefinition.job_definition_id == definition_id).values(is_deleted=True)
    await executeAndCommit(stmt, async_session_maker)


# ---------------------------------------------------------------------------
# ExperimentDefinition
# ---------------------------------------------------------------------------


async def upsert_experiment_definition(
    *,
    experiment_definition_id: str | None = None,
    job_definition_id: str,
    job_definition_version: int,
    experiment_type: ExperimentType,
    created_by: str | None,
    experiment_definition: dict | None = None,
    display_name: str | None = None,
    display_description: str | None = None,
    tags: list[str] | None = None,
) -> tuple[str, int]:
    """Insert a new version of an ExperimentDefinition and return (id, version).

    If `id` is omitted a fresh UUID is generated (version 1).
    If `id` is supplied the next version number is derived from the database;
    a KeyError is raised if that id does not exist yet.
    """
    id_provided = experiment_definition_id is not None
    experiment_id = experiment_definition_id or str(uuid.uuid4())
    ref_time = dt.datetime.now()

    async def function(i: int) -> int:
        async with async_session_maker() as session:
            result = await session.execute(
                select(func.max(ExperimentDefinition.version)).where(ExperimentDefinition.experiment_definition_id == experiment_id)
            )
            max_version: int | None = result.scalar()
            if id_provided and max_version is None:
                raise KeyError(f"No ExperimentDefinition with id={experiment_id!r} exists; cannot add a new version.")
            new_version = (max_version or 0) + 1
            session.add(
                ExperimentDefinition(
                    experiment_definition_id=experiment_id,
                    version=new_version,
                    created_by=created_by,
                    created_at=ref_time,
                    display_name=display_name,
                    display_description=display_description,
                    tags=tags,
                    job_definition_id=job_definition_id,
                    job_definition_version=job_definition_version,
                    experiment_type=experiment_type,
                    experiment_definition=experiment_definition,
                    is_deleted=False,
                )
            )
            await session.commit()
            return new_version

    new_version = await dbRetry(function)
    return experiment_id, new_version


async def get_experiment_definition(experiment_definition_id: str, version: int | None = None) -> ExperimentDefinition | None:
    """Return a specific or the latest non-deleted version of an ExperimentDefinition."""
    if version is not None:
        query = select(ExperimentDefinition).where(
            ExperimentDefinition.experiment_definition_id == experiment_definition_id,
            ExperimentDefinition.version == version,
            ExperimentDefinition.is_deleted.is_(False),
        )
    else:
        query = (
            select(ExperimentDefinition)
            .where(ExperimentDefinition.experiment_definition_id == experiment_definition_id, ExperimentDefinition.is_deleted.is_(False))
            .order_by(ExperimentDefinition.version.desc())
            .limit(1)
        )
    return await querySingle(query, async_session_maker)


async def list_experiment_definitions(
    experiment_type: str | None = None, offset: int = 0, limit: int | None = None
) -> Iterable[ExperimentDefinition]:
    """Return the latest non-deleted version of every ExperimentDefinition, with optional type filter and paging."""

    async def function(i: int) -> list[ExperimentDefinition]:
        async with async_session_maker() as session:
            subq = (
                select(
                    ExperimentDefinition.experiment_definition_id,
                    func.max(ExperimentDefinition.version).label("max_version"),
                )
                .where(ExperimentDefinition.is_deleted.is_(False))
                .group_by(ExperimentDefinition.experiment_definition_id)
                .subquery()
            )
            query = select(ExperimentDefinition).join(
                subq,
                (ExperimentDefinition.experiment_definition_id == subq.c.experiment_definition_id)
                & (ExperimentDefinition.version == subq.c.max_version),
            )
            if experiment_type is not None:
                query = query.where(ExperimentDefinition.experiment_type == experiment_type)
            query = query.offset(offset)
            if limit is not None:
                query = query.limit(limit)
            result = await session.execute(query)
            return [r[0] for r in result.all()]

    return await dbRetry(function)


async def count_experiment_definitions(experiment_type: str | None = None) -> int:
    """Return the number of distinct non-deleted ExperimentDefinition ids, with optional type filter."""

    async def function(i: int) -> int:
        async with async_session_maker() as session:
            subq = (
                select(ExperimentDefinition.experiment_definition_id)
                .where(ExperimentDefinition.is_deleted.is_(False))
                .group_by(ExperimentDefinition.experiment_definition_id)
                .subquery()
            )
            query = select(func.count()).select_from(subq)
            if experiment_type is not None:
                # Re-filter on latest version rows
                subq2 = (
                    select(ExperimentDefinition.experiment_definition_id, func.max(ExperimentDefinition.version).label("max_version"))
                    .where(ExperimentDefinition.is_deleted.is_(False))
                    .group_by(ExperimentDefinition.experiment_definition_id)
                    .subquery()
                )
                inner = (
                    select(ExperimentDefinition.experiment_definition_id)
                    .join(
                        subq2,
                        (ExperimentDefinition.experiment_definition_id == subq2.c.experiment_definition_id)
                        & (ExperimentDefinition.version == subq2.c.max_version),
                    )
                    .where(ExperimentDefinition.experiment_type == experiment_type)
                    .subquery()
                )
                query = select(func.count()).select_from(inner)
            result = await session.execute(query)
            return result.scalar() or 0

    return await dbRetry(function)


async def soft_delete_experiment_definition(experiment_id: str) -> bool:
    """Mark all versions of an ExperimentDefinition as deleted. Return true if any was marked"""

    async def function(i: int) -> bool:
        async with async_session_maker() as session:
            subquery = (
                select(ExperimentDefinition.experiment_definition_id)
                .where(ExperimentDefinition.is_deleted.is_(False), ExperimentDefinition.experiment_definition_id == experiment_id)
                .subquery()
            )
            query = select(func.count()).select_from(subquery)
            result = await session.execute(query)
            if not result.scalar():
                return False
            stmt = (
                update(ExperimentDefinition).where(ExperimentDefinition.experiment_definition_id == experiment_id).values(is_deleted=True)
            )
            await session.execute(stmt)
            await session.commit()
            return True

    return await dbRetry(function)


# ---------------------------------------------------------------------------
# JobExecution
# ---------------------------------------------------------------------------


async def upsert_job_execution(
    *,
    job_execution_id: str | None = None,
    job_definition_id: str,
    job_definition_version: int,
    created_by: str | None,
    status: JobExecutionStatus,
    experiment_id: str | None = None,
    experiment_version: int | None = None,
    compiler_runtime_context: dict | None = None,
    experiment_context: str | None = None,
) -> tuple[str, int]:
    """Insert a new attempt of a JobExecution and return (id, attempt_count).

    If `id` is omitted a fresh UUID is generated (attempt 1).
    If `id` is supplied the next attempt number is derived from the database,
    enabling re-run tracking under the same execution identity;
    a KeyError is raised if that id does not exist yet.
    """
    id_provided = job_execution_id is not None
    execution_id = job_execution_id or str(uuid.uuid4())
    ref_time = dt.datetime.now()

    async def function(i: int) -> int:
        async with async_session_maker() as session:
            result = await session.execute(
                select(func.max(JobExecution.attempt_count)).where(JobExecution.job_execution_id == execution_id)
            )
            max_attempt: int | None = result.scalar()
            if id_provided and max_attempt is None:
                raise KeyError(f"No JobExecution with id={execution_id!r} exists; cannot add a new attempt.")
            new_attempt = (max_attempt or 0) + 1
            session.add(
                JobExecution(
                    job_execution_id=execution_id,
                    attempt_count=new_attempt,
                    created_by=created_by,
                    created_at=ref_time,
                    updated_at=ref_time,
                    job_definition_id=job_definition_id,
                    job_definition_version=job_definition_version,
                    experiment_id=experiment_id,
                    experiment_version=experiment_version,
                    compiler_runtime_context=compiler_runtime_context,
                    experiment_context=experiment_context,
                    status=status,
                    is_deleted=False,
                )
            )
            await session.commit()
            return new_attempt

    new_attempt = await dbRetry(function)
    return execution_id, new_attempt


async def get_job_execution(execution_id: str, attempt_count: int | None = None) -> JobExecution | None:
    """Return a specific or the latest non-deleted attempt of a JobExecution."""
    if attempt_count is not None:
        query = select(JobExecution).where(
            JobExecution.job_execution_id == execution_id,
            JobExecution.attempt_count == attempt_count,
            JobExecution.is_deleted.is_(False),
        )
    else:
        query = (
            select(JobExecution)
            .where(JobExecution.job_execution_id == execution_id, JobExecution.is_deleted.is_(False))
            .order_by(JobExecution.attempt_count.desc())
            .limit(1)
        )
    return await querySingle(query, async_session_maker)


async def update_job_execution_runtime(execution_id: str, attempt_count: int, **kwargs: object) -> None:
    """Update mutable runtime fields on a specific JobExecution attempt."""
    ref_time = dt.datetime.now()
    stmt = (
        update(JobExecution)
        .where(JobExecution.job_execution_id == execution_id, JobExecution.attempt_count == attempt_count)
        .values(updated_at=ref_time, **kwargs)
    )
    await executeAndCommit(stmt, async_session_maker)


async def list_job_executions(offset: int = 0, limit: int | None = None) -> Iterable[JobExecution]:
    """Return the latest non-deleted attempt of every JobExecution, with optional paging. Orders by creation time, descending."""

    async def function(i: int) -> list[JobExecution]:
        async with async_session_maker() as session:
            subq = (
                select(JobExecution.job_execution_id, func.max(JobExecution.attempt_count).label("max_attempt"))
                .where(JobExecution.is_deleted.is_(False))
                .group_by(JobExecution.job_execution_id)
                .subquery()
            )
            query = (
                select(JobExecution)
                .join(
                    subq,
                    (JobExecution.job_execution_id == subq.c.job_execution_id) & (JobExecution.attempt_count == subq.c.max_attempt),
                )
                .order_by(JobExecution.created_at.desc())
                .offset(offset)
            )
            if limit is not None:
                query = query.limit(limit)
            result = await session.execute(query)
            return [r[0] for r in result.all()]

    return await dbRetry(function)


async def count_job_executions() -> int:
    """Return the total number of distinct (non-deleted) JobExecution ids."""

    async def function(i: int) -> int:
        async with async_session_maker() as session:
            result = await session.execute(
                select(func.count(func.distinct(JobExecution.job_execution_id))).where(JobExecution.is_deleted.is_(False))
            )
            return result.scalar() or 0

    return await dbRetry(function)


async def soft_delete_job_execution(execution_id: str) -> None:
    """Mark all attempts of a JobExecution as deleted."""
    stmt = update(JobExecution).where(JobExecution.job_execution_id == execution_id).values(is_deleted=True)
    await executeAndCommit(stmt, async_session_maker)


# ---------------------------------------------------------------------------
# ExperimentNext
# ---------------------------------------------------------------------------


async def upsert_experiment_next(*, experiment_id: str, scheduled_at: dt.datetime) -> None:
    """Insert or update the next scheduled run time for an experiment."""
    ref_time = dt.datetime.now()
    existing = await querySingle(
        select(ExperimentNext).where(ExperimentNext.experiment_id == experiment_id),
        async_session_maker,
    )
    if existing:
        stmt = (
            update(ExperimentNext)
            .where(ExperimentNext.experiment_id == experiment_id)
            .values(scheduled_at=scheduled_at, updated_at=ref_time)
        )
        await executeAndCommit(stmt, async_session_maker)
    else:
        entity = ExperimentNext(
            experiment_next_id=str(uuid.uuid4()),
            experiment_id=experiment_id,
            scheduled_at=scheduled_at,
            updated_at=ref_time,
        )
        await addAndCommit(entity, async_session_maker)


async def get_experiment_next(experiment_id: str) -> ExperimentNext | None:
    """Return the next scheduled run entry for an experiment."""
    query = select(ExperimentNext).where(ExperimentNext.experiment_id == experiment_id)
    return await querySingle(query, async_session_maker)


async def delete_experiment_next(experiment_id: str) -> None:
    """Remove the next scheduled run entry for an experiment, clearing the pending tick."""
    stmt = sa_delete(ExperimentNext).where(ExperimentNext.experiment_id == experiment_id)
    await executeAndCommit(stmt, async_session_maker)


async def get_schedulable_experiments(now: dt.datetime) -> list[tuple[ExperimentNext, ExperimentDefinition]]:
    """Return (ExperimentNext, ExperimentDefinition) pairs due for execution.

    Joins ExperimentNext with the latest non-deleted ExperimentDefinition of type
    'cron_schedule'. Disabled schedules have their ExperimentNext row deleted at
    update time, so should not appear here -- but if they would, we handle at the
    scheduler thread by logging error and deleting their ExperimentNext
    """

    async def function(i: int) -> list[tuple[ExperimentNext, ExperimentDefinition]]:
        async with async_session_maker() as session:
            subq = (
                select(ExperimentDefinition.experiment_definition_id, func.max(ExperimentDefinition.version).label("max_version"))
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
        async with async_session_maker() as session:
            query = select(func.min(ExperimentNext.scheduled_at))
            result = await session.execute(query)
            return result.scalar_one_or_none()

    return await dbRetry(function)


async def list_job_executions_by_experiment(experiment_id: str, offset: int = 0, limit: int | None = None) -> Iterable[JobExecution]:
    """Return the latest attempt of each JobExecution linked to an experiment, ordered by created_at descending."""

    async def function(i: int) -> list[JobExecution]:
        async with async_session_maker() as session:
            subq = (
                select(JobExecution.job_execution_id, func.max(JobExecution.attempt_count).label("max_attempt"))
                .where(JobExecution.experiment_id == experiment_id, JobExecution.is_deleted.is_(False))
                .group_by(JobExecution.job_execution_id)
                .subquery()
            )
            query = (
                select(JobExecution)
                .join(
                    subq,
                    (JobExecution.job_execution_id == subq.c.job_execution_id) & (JobExecution.attempt_count == subq.c.max_attempt),
                )
                .order_by(JobExecution.created_at.desc())
                .offset(offset)
            )
            if limit is not None:
                query = query.limit(limit)
            result = await session.execute(query)
            return [r[0] for r in result.all()]

    return await dbRetry(function)


async def count_job_executions_by_experiment(experiment_id: str) -> int:
    """Return the total number of distinct non-deleted JobExecution ids linked to an experiment."""

    async def function(i: int) -> int:
        async with async_session_maker() as session:
            result = await session.execute(
                select(func.count(func.distinct(JobExecution.job_execution_id))).where(
                    JobExecution.experiment_id == experiment_id,
                    JobExecution.is_deleted.is_(False),
                )
            )
            return result.scalar() or 0

    return await dbRetry(function)
