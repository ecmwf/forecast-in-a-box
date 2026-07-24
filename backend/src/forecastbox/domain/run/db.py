# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Synchronous persistence helpers for Run.

Each helper owns its session and transaction and must be submitted to the
``ConcurrentPools.JobsDb`` worker by a route, service, or background-thread
orchestrator.

Ownership model:
- Admins and anonymous (unauthenticated) actors see and may mutate all executions.
- Authenticated non-admin actors may only read and mutate executions they created.
"""

import datetime as dt
import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any, cast

from pydantic import Field
from sqlalchemy import func, select, update

import forecastbox.schemata.jobs as _jobs_module
from forecastbox.domain.blueprint.types import BlueprintId
from forecastbox.domain.experiment.types import ExperimentDefinitionId
from forecastbox.domain.run.exceptions import RunAccessDenied, RunNotFound
from forecastbox.domain.run.types import RunId
from forecastbox.schemata.jobs import Run, RunStatus
from forecastbox.utility.auth import AuthContext
from forecastbox.utility.db import dbRetry
from forecastbox.utility.pydantic import FiabBaseModel
from forecastbox.utility.time import current_time


@dataclass(frozen=True, eq=True, slots=True)
class RunRecord:
    run_id: str
    attempt_count: int
    created_by: str
    created_at: dt.datetime
    updated_at: dt.datetime
    blueprint_id: str
    blueprint_version: int
    experiment_id: str | None
    experiment_version: int | None
    compiler_runtime_context: dict[str, Any]
    experiment_context: str | None
    status: RunStatus
    outputs: dict[str, Any] | None
    error: str | None
    progress: str | None
    cascade_job_id: str | None
    cascade_proc: int | None
    is_deleted: bool


class CompilerRuntimeContext(FiabBaseModel):
    """Per-execution dynamic values that override compiled ExecutionSpecification fields.

    Merged via deep_union into the compiled spec before job submission; only the fields
    explicitly set here override the compiled values. Persisted as JSON on the Run row
    so that retries reproduce the same overrides.
    """

    glyphs: dict[str, str] = Field(default_factory=dict)


def _to_record(row: Run) -> RunRecord:
    return RunRecord(
        run_id=cast(str, row.run_id),
        attempt_count=cast(int, row.attempt_count),
        created_by=cast(str, row.created_by),
        created_at=cast(dt.datetime, row.created_at),
        updated_at=cast(dt.datetime, row.updated_at),
        blueprint_id=cast(str, row.blueprint_id),
        blueprint_version=cast(int, row.blueprint_version),
        experiment_id=cast(str | None, row.experiment_id),
        experiment_version=cast(int | None, row.experiment_version),
        compiler_runtime_context=cast(dict[str, Any], row.compiler_runtime_context),
        experiment_context=cast(str | None, row.experiment_context),
        status=cast(RunStatus, row.status),
        outputs=cast(dict[str, Any] | None, row.outputs),
        error=cast(str | None, row.error),
        progress=cast(str | None, row.progress),
        cascade_job_id=cast(str | None, row.cascade_job_id),
        cascade_proc=cast(int | None, row.cascade_proc),
        is_deleted=cast(bool, row.is_deleted),
    )


def upsert_run(
    *,
    run_id: RunId | None = None,
    blueprint_id: BlueprintId,
    blueprint_version: int,
    created_by: str,
    status: RunStatus,
    experiment_id: ExperimentDefinitionId | None = None,
    experiment_version: int | None = None,
    compiler_runtime_context: CompilerRuntimeContext = CompilerRuntimeContext(),
    experiment_context: str | None = None,
) -> tuple[RunId, int, dt.datetime]:
    """Insert a new attempt of a Run and return ``(id, attempt_count, created_at)``.

    If ``run_id`` is omitted a fresh UUID is generated and attempt 1 is
    inserted. If ``run_id`` is supplied the next attempt number is derived from
    the database and a missing run raises ``KeyError``.

    No actor-level authorization is enforced on creation; any caller may
    create an execution.
    """
    supplied_run_id = run_id
    effective_run_id = run_id if run_id is not None else RunId(str(uuid.uuid4()))
    ref_time = current_time("dbref")

    def function(i: int) -> int:
        with _jobs_module.session_maker() as session:
            result = session.execute(select(func.max(Run.attempt_count)).where(Run.run_id == effective_run_id))
            max_attempt = cast(int | None, result.scalar())
            if supplied_run_id is not None and max_attempt is None:
                raise KeyError(f"Run {supplied_run_id!r} does not exist")
            new_attempt = (max_attempt or 0) + 1
            session.add(
                Run(
                    run_id=effective_run_id,
                    attempt_count=new_attempt,
                    created_by=created_by,
                    created_at=ref_time,
                    updated_at=ref_time,
                    blueprint_id=blueprint_id,
                    blueprint_version=blueprint_version,
                    experiment_id=experiment_id,
                    experiment_version=experiment_version,
                    compiler_runtime_context=compiler_runtime_context.model_dump(exclude_unset=True),
                    experiment_context=experiment_context,
                    status=status,
                    is_deleted=False,
                )
            )
            session.commit()
            return new_attempt

    new_attempt = dbRetry(function)
    return effective_run_id, new_attempt, ref_time


def get_run(
    run_id: RunId,
    attempt_count: int | None = None,
    *,
    auth_context: AuthContext,
) -> RunRecord:
    """Return a specific or the latest non-deleted attempt of a Run.

    Raises ``RunNotFound`` if the execution does not exist and
    ``RunAccessDenied`` if the actor is an authenticated non-admin who does
    not own it.
    """

    def function(i: int) -> RunRecord:
        with _jobs_module.session_maker() as session:
            if attempt_count is not None:
                query = select(Run).where(
                    Run.run_id == run_id,
                    Run.attempt_count == attempt_count,
                    Run.is_deleted.is_(False),
                )
            else:
                query = select(Run).where(Run.run_id == run_id, Run.is_deleted.is_(False)).order_by(Run.attempt_count.desc()).limit(1)
            row = session.execute(query).scalar_one_or_none()
            if row is None:
                raise RunNotFound(f"Run {run_id!r} not found.")
            if not auth_context.has_admin() and auth_context.user_id != row.created_by:
                raise RunAccessDenied(f"User {auth_context.user_id!r} does not have access to Run {run_id!r}.")
            return _to_record(row)

    return dbRetry(function)


def update_run_runtime(run_id: RunId, attempt_count: int, **kwargs: object) -> None:
    """Update mutable runtime fields on a specific Run attempt.

    No actor-level authorization is applied; this is an internal system
    operation used while a run is executing.
    """
    ref_time = current_time("dbref")

    def function(i: int) -> None:
        with _jobs_module.session_maker() as session:
            session.execute(
                update(Run).where(Run.run_id == run_id, Run.attempt_count == attempt_count).values(updated_at=ref_time, **kwargs)
            )
            session.commit()

    dbRetry(function)


def list_runs(*, auth_context: AuthContext, offset: int = 0, limit: int | None = None) -> Iterable[RunRecord]:
    """Return the latest non-deleted attempt of every Run, with optional paging.

    Admins and anonymous actors see all executions. Authenticated non-admins
    see only executions they created. Results are ordered by creation time
    descending.
    """

    def function(i: int) -> list[RunRecord]:
        with _jobs_module.session_maker() as session:
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
            result = session.execute(query)
            return [_to_record(row[0]) for row in result.all()]

    return dbRetry(function)


def count_runs(*, auth_context: AuthContext) -> int:
    """Return the total number of distinct non-deleted Run ids visible to the actor."""

    def function(i: int) -> int:
        with _jobs_module.session_maker() as session:
            query = select(func.count(func.distinct(Run.run_id))).where(Run.is_deleted.is_(False))
            if not auth_context.has_admin():
                query = query.where(Run.created_by == auth_context.user_id)
            result = session.execute(query)
            return cast(int, result.scalar() or 0)

    return dbRetry(function)


def soft_delete_run(run_id: RunId, *, auth_context: AuthContext) -> None:
    """Mark all attempts of a Run as deleted.

    Raises ``RunNotFound`` if the execution does not exist and
    ``RunAccessDenied`` if the actor is an authenticated non-admin who does
    not own it.
    """

    def function(i: int) -> None:
        with _jobs_module.session_maker() as session:
            existing = session.execute(
                select(Run).where(Run.run_id == run_id, Run.is_deleted.is_(False)).order_by(Run.attempt_count.desc()).limit(1)
            ).scalar_one_or_none()
            if existing is None:
                raise RunNotFound(f"Run {run_id!r} not found.")
            if not auth_context.has_admin() and auth_context.user_id != existing.created_by:
                raise RunAccessDenied(f"User {auth_context.user_id!r} does not have access to Run {run_id!r}.")
            session.execute(update(Run).where(Run.run_id == run_id).values(is_deleted=True))
            session.commit()

    dbRetry(function)


def list_runs_by_experiment(
    experiment_id: ExperimentDefinitionId,
    *,
    auth_context: AuthContext,
    offset: int = 0,
    limit: int | None = None,
) -> Iterable[RunRecord]:
    """Return the latest non-deleted attempt of each execution linked to an experiment.

    Admins and anonymous actors see all linked executions. Authenticated
    non-admins see only their own. Results are ordered by creation time
    descending.
    """

    def function(i: int) -> list[RunRecord]:
        with _jobs_module.session_maker() as session:
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
            result = session.execute(query)
            return [_to_record(row[0]) for row in result.all()]

    return dbRetry(function)


def count_runs_by_experiment(experiment_id: ExperimentDefinitionId, *, auth_context: AuthContext) -> int:
    """Return the total number of visible non-deleted Run ids linked to an experiment."""

    def function(i: int) -> int:
        with _jobs_module.session_maker() as session:
            query = select(func.count(func.distinct(Run.run_id))).where(
                Run.experiment_id == experiment_id,
                Run.is_deleted.is_(False),
            )
            if not auth_context.has_admin():
                query = query.where(Run.created_by == auth_context.user_id)
            result = session.execute(query)
            return cast(int, result.scalar() or 0)

    return dbRetry(function)
