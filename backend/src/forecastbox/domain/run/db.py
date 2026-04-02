# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Persistence layer for Run, with auth-scoped authorization.

Uses the same session maker as ``forecastbox.schemata.jobs`` so that all tables
share a single SQLite connection pool and in-process tests can monkeypatch
a single ``async_session_maker`` attribute to inject an in-memory database.

Ownership model:
- Admins and anonymous (unauthenticated) actors see and may mutate all executions.
- Authenticated non-admin actors may only read and mutate executions they created.
"""

import datetime as dt
import uuid
from collections.abc import Iterable

from sqlalchemy import func, select, update

import forecastbox.schemata.jobs as _jobs_module
from forecastbox.domain.run.exceptions import RunAccessDenied, RunNotFound
from forecastbox.schemata.jobs import Run, RunStatus
from forecastbox.utility.auth import AuthContext
from forecastbox.utility.db import dbRetry, executeAndCommit, querySingle


async def upsert_run(
    *,
    run_id: str | None = None,
    blueprint_id: str,
    blueprint_version: int,
    created_by: str | None,
    status: RunStatus,
    experiment_id: str | None = None,
    experiment_version: int | None = None,
    compiler_runtime_context: dict | None = None,
    experiment_context: str | None = None,
) -> tuple[str, int]:
    """Insert a new attempt of a Run and return (id, attempt_count).

    If ``run_id`` is omitted a fresh UUID is generated (attempt 1).
    If ``run_id`` is supplied and a Run with that id already exists, a new attempt is
    appended. If the id does not exist yet, attempt 1 is created with that id (used
    when the caller pre-generates the id for variable resolution purposes).
    No actor-level auth is enforced on creation; any caller may create an execution.
    """
    run_id = run_id or str(uuid.uuid4())
    ref_time = dt.datetime.now()

    async def function(i: int) -> int:
        async with _jobs_module.async_session_maker() as session:
            result = await session.execute(select(func.max(Run.attempt_count)).where(Run.run_id == run_id))
            max_attempt: int | None = result.scalar()
            new_attempt = (max_attempt or 0) + 1
            session.add(
                Run(
                    run_id=run_id,
                    attempt_count=new_attempt,
                    created_by=created_by,
                    created_at=ref_time,
                    updated_at=ref_time,
                    blueprint_id=blueprint_id,
                    blueprint_version=blueprint_version,
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
    return run_id, new_attempt


async def get_run(
    run_id: str,
    attempt_count: int | None = None,
    *,
    auth_context: AuthContext,
) -> Run:
    """Return a specific or the latest non-deleted attempt of a Run.

    Raises ``RunNotFound`` if the execution does not exist.
    Raises ``RunAccessDenied`` if the actor is an authenticated non-admin
    who does not own the execution.
    """
    if attempt_count is not None:
        query = select(Run).where(
            Run.run_id == run_id,
            Run.attempt_count == attempt_count,
            Run.is_deleted.is_(False),
        )
    else:
        query = select(Run).where(Run.run_id == run_id, Run.is_deleted.is_(False)).order_by(Run.attempt_count.desc()).limit(1)
    row = await querySingle(query, _jobs_module.async_session_maker)
    if row is None:
        raise RunNotFound(f"Run {run_id!r} not found.")
    if not auth_context.has_admin() and auth_context.user_id != row.created_by:
        raise RunAccessDenied(f"User {auth_context.user_id!r} does not have access to Run {run_id!r}.")
    return row


async def update_run_runtime(run_id: str, attempt_count: int, **kwargs: object) -> None:
    """Update mutable runtime fields on a specific Run attempt.

    No actor-level auth; this is an internal system operation called during execution.
    """
    ref_time = dt.datetime.now()
    stmt = update(Run).where(Run.run_id == run_id, Run.attempt_count == attempt_count).values(updated_at=ref_time, **kwargs)
    await executeAndCommit(stmt, _jobs_module.async_session_maker)


async def list_runs(*, auth_context: AuthContext, offset: int = 0, limit: int | None = None) -> Iterable[Run]:
    """Return the latest non-deleted attempt of every Run, with optional paging.

    Admins and anonymous actors see all executions.  Authenticated non-admins see only
    executions they created.  Orders by creation time, descending.
    """

    async def function(i: int) -> list[Run]:
        async with _jobs_module.async_session_maker() as session:
            subq = (
                select(Run.run_id, func.max(Run.attempt_count).label("max_attempt"))
                .where(Run.is_deleted.is_(False))
                .group_by(Run.run_id)
                .subquery()
            )
            query = (
                select(Run)
                .join(
                    subq,
                    (Run.run_id == subq.c.run_id) & (Run.attempt_count == subq.c.max_attempt),
                )
                .order_by(Run.created_at.desc())
                .offset(offset)
            )
            if not auth_context.has_admin():
                query = query.where(Run.created_by == auth_context.user_id)
            if limit is not None:
                query = query.limit(limit)
            result = await session.execute(query)
            return [r[0] for r in result.all()]

    return await dbRetry(function)


async def count_runs(*, auth_context: AuthContext) -> int:
    """Return the total number of distinct non-deleted Run ids visible to the actor."""

    async def function(i: int) -> int:
        async with _jobs_module.async_session_maker() as session:
            query = select(func.count(func.distinct(Run.run_id))).where(Run.is_deleted.is_(False))
            if not auth_context.has_admin():
                query = query.where(Run.created_by == auth_context.user_id)
            result = await session.execute(query)
            return result.scalar() or 0

    return await dbRetry(function)


async def soft_delete_run(run_id: str, *, auth_context: AuthContext) -> None:
    """Mark all attempts of a Run as deleted.

    Raises ``RunNotFound`` if the execution does not exist.
    Raises ``RunAccessDenied`` if the actor is an authenticated non-admin
    who does not own the execution.
    """
    existing = await get_run(run_id, auth_context=auth_context)
    # get_run raises if not found or access denied; ownership is already checked.
    del existing  # only needed for the auth check above
    stmt = update(Run).where(Run.run_id == run_id).values(is_deleted=True)
    await executeAndCommit(stmt, _jobs_module.async_session_maker)


async def list_runs_by_experiment(
    experiment_id: str,
    *,
    auth_context: AuthContext,
    offset: int = 0,
    limit: int | None = None,
) -> Iterable[Run]:
    """Return the latest non-deleted attempt of each execution linked to an experiment.

    Admins and anonymous actors see all.  Authenticated non-admins see only their own.
    Orders by creation time, descending.
    """

    async def function(i: int) -> list[Run]:
        async with _jobs_module.async_session_maker() as session:
            subq = (
                select(Run.run_id, func.max(Run.attempt_count).label("max_attempt"))
                .where(Run.experiment_id == experiment_id, Run.is_deleted.is_(False))
                .group_by(Run.run_id)
                .subquery()
            )
            query = (
                select(Run)
                .join(
                    subq,
                    (Run.run_id == subq.c.run_id) & (Run.attempt_count == subq.c.max_attempt),
                )
                .order_by(Run.created_at.desc())
                .offset(offset)
            )
            if not auth_context.has_admin():
                query = query.where(Run.created_by == auth_context.user_id)
            if limit is not None:
                query = query.limit(limit)
            result = await session.execute(query)
            return [r[0] for r in result.all()]

    return await dbRetry(function)


async def count_runs_by_experiment(experiment_id: str, *, auth_context: AuthContext) -> int:
    """Return the total number of distinct non-deleted Run ids linked to an experiment and visible to the actor."""

    async def function(i: int) -> int:
        async with _jobs_module.async_session_maker() as session:
            query = select(func.count(func.distinct(Run.run_id))).where(
                Run.experiment_id == experiment_id,
                Run.is_deleted.is_(False),
            )
            if not auth_context.has_admin():
                query = query.where(Run.created_by == auth_context.user_id)
            result = await session.execute(query)
            return result.scalar() or 0

    return await dbRetry(function)
