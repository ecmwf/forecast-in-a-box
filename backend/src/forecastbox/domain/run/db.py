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
``sync_session_maker`` to inject an in-memory database.

Ownership model:
- Admins and anonymous (unauthenticated) actors see and may mutate all executions.
- Authenticated non-admin actors may only read and mutate executions they created.
"""

import datetime as dt
import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any, cast

from fiab_core.fable import BlockInstanceId, ConfigurationOptionId
from pydantic import Field
from sqlalchemy import func, select, update

import forecastbox.schemata.jobs as _jobs_module
from forecastbox.domain.blueprint.types import BlueprintId
from forecastbox.domain.experiment.types import ExperimentDefinitionId
from forecastbox.domain.run.exceptions import RunAccessDenied, RunNotDeletable, RunNotFound, RunNotStoppable
from forecastbox.domain.run.types import RunId
from forecastbox.schemata.run import Run, RunStatus
from forecastbox.utility.auth import AuthContext
from forecastbox.utility.db import dbRetry, executeAndCommit, querySingle
from forecastbox.utility.pydantic import FiabBaseModel
from forecastbox.utility.time import current_time


class CompilerRuntimeContext(FiabBaseModel):
    """Per-execution dynamic values that override compiled ExecutionSpecification fields.

    Merged via deep_union into the compiled spec before job submission; only the fields
    explicitly set here override the compiled values. Persisted as JSON on the Run row
    so that retries reproduce the same overrides.
    """

    glyphs: dict[str, str] = Field(default_factory=dict)
    resolution: dict[BlockInstanceId, dict[ConfigurationOptionId, str | None]] = Field(default_factory=dict)
    """Maps each block instance id to the configuration options that were resolved via
    glyph substitution, together with their final (post-resolution) values. A value is
    ``None`` only for an option whose configured value is an explicit null."""


@dataclass(frozen=True, eq=True, slots=True)
class RunRecord:
    run_id: RunId
    attempt_count: int
    created_by: str
    created_at: dt.datetime
    updated_at: dt.datetime
    blueprint_id: BlueprintId
    blueprint_version: int
    experiment_id: ExperimentDefinitionId | None
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


def _to_run_record(row: Run) -> RunRecord:
    return RunRecord(
        run_id=RunId(str(cast(Any, row.run_id))),
        attempt_count=cast(int, row.attempt_count),
        created_by=cast(str, row.created_by),
        created_at=cast(dt.datetime, row.created_at),
        updated_at=cast(dt.datetime, row.updated_at),
        blueprint_id=BlueprintId(str(cast(Any, row.blueprint_id))),
        blueprint_version=cast(int, row.blueprint_version),
        experiment_id=ExperimentDefinitionId(str(cast(Any, row.experiment_id))) if row.experiment_id is not None else None,
        experiment_version=cast(int | None, row.experiment_version),
        compiler_runtime_context=cast(dict[str, Any], dict(cast(Any, row.compiler_runtime_context) or {})),
        experiment_context=cast(str | None, row.experiment_context),
        status=cast(RunStatus, row.status),
        outputs=cast(dict[str, Any] | None, dict(cast(Any, row.outputs)) if row.outputs is not None else None),
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
    """Insert a new attempt of a Run and return (id, attempt_count, created_at).

    If ``run_id`` is omitted a fresh UUID is generated (attempt 1).
    If ``run_id`` is supplied the next attempt number is derived from the database;
    raises ``KeyError`` if that id does not exist yet.
    No actor-level auth is enforced on creation; any caller may create an execution.
    """
    supplied_run_id = run_id
    effective_run_id = run_id if run_id is not None else RunId(str(uuid.uuid4()))
    ref_time = current_time("dbref")

    def function(i: int) -> int:
        with _jobs_module.sync_session_maker() as session:
            result = session.execute(select(func.max(Run.attempt_count)).where(Run.run_id == effective_run_id))
            max_attempt: int | None = result.scalar()
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
    row = querySingle(query, _jobs_module.sync_session_maker)
    if row is None:
        raise RunNotFound(f"Run {run_id!r} not found.")
    dto = _to_run_record(row)
    if not auth_context.has_admin() and auth_context.user_id != dto.created_by:
        raise RunAccessDenied(f"User {auth_context.user_id!r} does not have access to Run {run_id!r}.")
    return dto


def get_run_unchecked(run_id: RunId, attempt_count: int) -> RunRecord | None:
    """Return a specific non-deleted attempt of a Run, or None if it does not exist. No actor-level auth."""
    query = select(Run).where(Run.run_id == run_id, Run.attempt_count == attempt_count, Run.is_deleted.is_(False))
    row = querySingle(query, _jobs_module.sync_session_maker)
    return None if row is None else _to_run_record(row)


def update_run_runtime(run_id: RunId, attempt_count: int, *, expected_status: RunStatus | None = None, **kwargs: object) -> bool:
    """Update mutable runtime fields on a specific Run attempt.

    No actor-level auth; this is an internal system operation called during execution.
    Any update of the ``status`` field must supply ``expected_status``, which is then part of the
    where clause (compare-and-swap). Returns whether a row was updated; always True when
    ``expected_status`` is not supplied and the row exists. On False the caller is expected to
    re-read the Run and decide anew.
    """
    if "status" in kwargs and expected_status is None:
        raise ValueError("updating status requires expected_status")
    ref_time = current_time("dbref")
    conditions = [Run.run_id == run_id, Run.attempt_count == attempt_count]
    if expected_status is not None:
        conditions.append(Run.status == expected_status)
    stmt = update(Run).where(*conditions).values(updated_at=ref_time, **kwargs)

    def function(i: int) -> bool:
        with _jobs_module.sync_session_maker() as session:
            result = session.execute(stmt)
            session.commit()
            return cast(Any, result).rowcount == 1

    return dbRetry(function)


STOPPABLE_STATUSES: frozenset[RunStatus] = frozenset(cast(tuple[RunStatus, ...], ("submitted", "preparing", "running")))
"""Statuses from which a stop may be requested."""

STOPPED_STATUSES: frozenset[RunStatus] = frozenset(cast(tuple[RunStatus, ...], ("stopping", "stopped")))
"""Statuses in which a stop has already been requested."""

TERMINAL_STATUSES: frozenset[RunStatus] = frozenset(cast(tuple[RunStatus, ...], ("completed", "failed", "stopped")))
"""Statuses in which no computation is going on anymore, so that the Run may be deleted."""

_CAS_ATTEMPTS = 5


def stop_run(run_id: RunId, attempt_count: int, *, auth_context: AuthContext) -> RunRecord:
    """Mark a specific attempt of a Run as ``stopping`` and return the resulting record.

    Does not contact cascade. Idempotent: a Run already ``stopping`` or ``stopped`` is returned as is.
    The status transition is a compare-and-swap against the status read just before; if it
    loses, the Run is read again and the decision is made anew.

    Raises ``RunNotFound`` and ``RunAccessDenied`` as ``get_run`` does.
    Raises ``RunNotStoppable`` if the status is not one of ``submitted``, ``preparing``, ``running``
    (or already stopping/stopped), or if the status keeps changing concurrently.
    """
    for _ in range(_CAS_ATTEMPTS):
        record = get_run(run_id, attempt_count, auth_context=auth_context)
        if record.status in STOPPED_STATUSES:
            return record
        if record.status not in STOPPABLE_STATUSES:
            raise RunNotStoppable(f"Run {run_id!r} has status {record.status!r} and cannot be stopped.")
        if update_run_runtime(run_id, attempt_count, expected_status=record.status, status="stopping"):
            # NOTE we read again to see a cascade_job_id possibly written in the meantime
            fresh = get_run_unchecked(run_id, attempt_count)
            if fresh is None:
                raise RunNotFound(f"Run {run_id!r} not found.")
            return fresh
    raise RunNotStoppable(f"Run {run_id!r} is being modified concurrently, retry later.")


def list_runs(*, auth_context: AuthContext, offset: int = 0, limit: int | None = None) -> Iterable[RunRecord]:
    """Return the latest non-deleted attempt of every Run, with optional paging.

    Admins and anonymous actors see all executions.  Authenticated non-admins see only
    executions they created.  Orders by creation time, descending.
    """

    def function(i: int) -> list[RunRecord]:
        with _jobs_module.sync_session_maker() as session:
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
            return [_to_run_record(r[0]) for r in result.all()]

    return dbRetry(function)


def count_runs(*, auth_context: AuthContext) -> int:
    """Return the total number of distinct non-deleted Run ids visible to the actor."""

    def function(i: int) -> int:
        with _jobs_module.sync_session_maker() as session:
            query = select(func.count(func.distinct(Run.run_id))).where(Run.is_deleted.is_(False))
            if not auth_context.has_admin():
                query = query.where(Run.created_by == auth_context.user_id)
            result = session.execute(query)
            return result.scalar() or 0

    return dbRetry(function)


def soft_delete_run(run_id: RunId, attempt_count: int, *, auth_context: AuthContext) -> None:
    """Mark a specific attempt of a Run as deleted, along with all other attempts that are terminal.

    Attempts that are not terminal stay visible. The deletion of the specific attempt is a compare-and-swap
    against the status read just before; if it loses, the Run is read again and the decision is made anew.

    Raises ``RunNotFound`` if the attempt does not exist.
    Raises ``RunAccessDenied`` if the actor is an authenticated non-admin who does not own the execution.
    Raises ``RunNotDeletable`` if the attempt has not reached a terminal status (completed, failed, stopped),
    or if the status keeps changing concurrently.
    """
    for _ in range(_CAS_ATTEMPTS):
        record = get_run(run_id, attempt_count, auth_context=auth_context)
        if record.status not in TERMINAL_STATUSES:
            raise RunNotDeletable(f"Run {run_id!r} has status {record.status!r}, only completed, failed or stopped runs can be deleted.")
        stmt = (
            update(Run)
            .where(Run.run_id == run_id, Run.attempt_count == attempt_count, Run.status == record.status, Run.is_deleted.is_(False))
            .values(is_deleted=True)
        )

        def function(i: int) -> bool:
            with _jobs_module.sync_session_maker() as session:
                result = session.execute(stmt)
                if cast(Any, result).rowcount != 1:
                    session.rollback()
                    return False
                session.execute(update(Run).where(Run.run_id == run_id, Run.status.in_(TERMINAL_STATUSES)).values(is_deleted=True))
                session.commit()
                return True

        if dbRetry(function):
            return
    raise RunNotDeletable(f"Run {run_id!r} is being modified concurrently, retry later.")


def list_runs_by_experiment(
    experiment_id: ExperimentDefinitionId,
    *,
    auth_context: AuthContext,
    offset: int = 0,
    limit: int | None = None,
) -> Iterable[RunRecord]:
    """Return the latest non-deleted attempt of each execution linked to an experiment.

    Admins and anonymous actors see all.  Authenticated non-admins see only their own.
    Orders by creation time, descending.
    """

    def function(i: int) -> list[RunRecord]:
        with _jobs_module.sync_session_maker() as session:
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
            return [_to_run_record(r[0]) for r in result.all()]

    return dbRetry(function)


def count_runs_by_experiment(experiment_id: ExperimentDefinitionId, *, auth_context: AuthContext) -> int:
    """Return the total number of distinct non-deleted Run ids linked to an experiment and visible to the actor."""

    def function(i: int) -> int:
        with _jobs_module.sync_session_maker() as session:
            query = select(func.count(func.distinct(Run.run_id))).where(
                Run.experiment_id == experiment_id,
                Run.is_deleted.is_(False),
            )
            if not auth_context.has_admin():
                query = query.where(Run.created_by == auth_context.user_id)
            result = session.execute(query)
            return result.scalar() or 0

    return dbRetry(function)
