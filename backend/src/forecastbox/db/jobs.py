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

Note: ``JobDefinition`` persistence has moved to
``forecastbox.domain.job_definition.db``.  ``get_job_definition`` is kept here as
a thin proxy so existing call-sites (execution, scheduling) continue to work
without changes.

Note: ``ExperimentDefinition`` and ``ExperimentNext`` persistence has moved to
``forecastbox.domain.experiment.db`` and
``forecastbox.domain.experiment.scheduling.db`` respectively.  The functions
below are thin proxies using a system-level (admin) actor so that callers not
yet updated continue to work.

Note: ``JobExecution`` persistence has moved to
``forecastbox.domain.job_execution.db``.  The functions below are thin proxies
using a system-level (admin) actor so that callers not yet updated continue to
work.
"""

import datetime as dt
from collections.abc import Iterable

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

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
# JobDefinition — thin proxy; canonical implementation in domain.job_definition.db
# ---------------------------------------------------------------------------


async def get_job_definition(definition_id: str, version: int | None = None) -> JobDefinition | None:
    """Return a specific or the latest non-deleted version of a JobDefinition.

    Delegates to ``forecastbox.domain.job_definition.db.get_job_definition``; kept
    here so execution and scheduling code need not be updated in this step.
    """
    from forecastbox.domain.job_definition import db as job_definition_db

    return await job_definition_db.get_job_definition(definition_id, version)


# ---------------------------------------------------------------------------
# ExperimentDefinition — thin proxies; canonical implementation in domain.experiment.db
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
    """Thin proxy; canonical implementation in ``forecastbox.domain.experiment.db``."""
    from forecastbox.domain.experiment import db as _exp_db
    from forecastbox.utility.auth import AuthContext

    return await _exp_db.upsert_experiment_definition(
        actor=AuthContext(user_id=None, is_admin=True),
        experiment_definition_id=experiment_definition_id,
        job_definition_id=job_definition_id,
        job_definition_version=job_definition_version,
        experiment_type=experiment_type,
        created_by=created_by,
        experiment_definition=experiment_definition,
        display_name=display_name,
        display_description=display_description,
        tags=tags,
    )


async def get_experiment_definition(experiment_definition_id: str, version: int | None = None) -> ExperimentDefinition | None:
    """Thin proxy; canonical implementation in ``forecastbox.domain.experiment.db``."""
    from forecastbox.domain.experiment import db as _exp_db

    return await _exp_db.get_experiment_definition(experiment_definition_id, version)


async def list_experiment_definitions(
    experiment_type: str | None = None, offset: int = 0, limit: int | None = None
) -> Iterable[ExperimentDefinition]:
    """Thin proxy; canonical implementation in ``forecastbox.domain.experiment.db``."""
    from forecastbox.domain.experiment import db as _exp_db
    from forecastbox.utility.auth import AuthContext

    return await _exp_db.list_experiment_definitions(
        actor=AuthContext(user_id=None, is_admin=True),
        experiment_type=experiment_type,
        offset=offset,
        limit=limit,
    )


async def count_experiment_definitions(experiment_type: str | None = None) -> int:
    """Thin proxy; canonical implementation in ``forecastbox.domain.experiment.db``."""
    from forecastbox.domain.experiment import db as _exp_db
    from forecastbox.utility.auth import AuthContext

    return await _exp_db.count_experiment_definitions(
        actor=AuthContext(user_id=None, is_admin=True),
        experiment_type=experiment_type,
    )


async def soft_delete_experiment_definition(experiment_id: str) -> bool:
    """Thin proxy; canonical implementation in ``forecastbox.domain.experiment.db``.

    Returns True if deleted, False if not found (preserving the original boolean interface).
    """
    from forecastbox.domain.experiment import db as _exp_db
    from forecastbox.domain.experiment.exceptions import ExperimentNotFound
    from forecastbox.utility.auth import AuthContext

    try:
        await _exp_db.soft_delete_experiment_definition(experiment_id, actor=AuthContext(user_id=None, is_admin=True))
        return True
    except ExperimentNotFound:
        return False


# ---------------------------------------------------------------------------
# JobExecution — thin proxies; canonical implementation in domain.job_execution.db
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
    """Thin proxy; canonical implementation in ``forecastbox.domain.job_execution.db``."""
    from forecastbox.domain.job_execution import db as _exec_db

    return await _exec_db.upsert_job_execution(
        job_execution_id=job_execution_id,
        job_definition_id=job_definition_id,
        job_definition_version=job_definition_version,
        created_by=created_by,
        status=status,
        experiment_id=experiment_id,
        experiment_version=experiment_version,
        compiler_runtime_context=compiler_runtime_context,
        experiment_context=experiment_context,
    )


async def get_job_execution(execution_id: str, attempt_count: int | None = None) -> JobExecution | None:
    """Thin proxy; canonical implementation in ``forecastbox.domain.job_execution.db``.

    Returns None if not found (preserving the original interface). Uses a system-level actor.
    """
    from forecastbox.domain.job_execution import db as _exec_db
    from forecastbox.domain.job_execution.exceptions import JobExecutionNotFound
    from forecastbox.utility.auth import AuthContext

    try:
        return await _exec_db.get_job_execution(execution_id, attempt_count, actor=AuthContext(user_id=None, is_admin=True))
    except JobExecutionNotFound:
        return None


async def update_job_execution_runtime(execution_id: str, attempt_count: int, **kwargs: object) -> None:
    """Thin proxy; canonical implementation in ``forecastbox.domain.job_execution.db``."""
    from forecastbox.domain.job_execution import db as _exec_db

    await _exec_db.update_job_execution_runtime(execution_id, attempt_count, **kwargs)


async def list_job_executions(offset: int = 0, limit: int | None = None) -> Iterable[JobExecution]:
    """Thin proxy; canonical implementation in ``forecastbox.domain.job_execution.db``.

    Uses a system-level (admin) actor so that all executions are returned.
    """
    from forecastbox.domain.job_execution import db as _exec_db
    from forecastbox.utility.auth import AuthContext

    return await _exec_db.list_job_executions(actor=AuthContext(user_id=None, is_admin=True), offset=offset, limit=limit)


async def count_job_executions() -> int:
    """Thin proxy; canonical implementation in ``forecastbox.domain.job_execution.db``.

    Uses a system-level (admin) actor so that all executions are counted.
    """
    from forecastbox.domain.job_execution import db as _exec_db
    from forecastbox.utility.auth import AuthContext

    return await _exec_db.count_job_executions(actor=AuthContext(user_id=None, is_admin=True))


async def soft_delete_job_execution(execution_id: str) -> None:
    """Thin proxy; canonical implementation in ``forecastbox.domain.job_execution.db``.

    Uses a system-level (admin) actor so that any execution can be deleted.
    """
    from forecastbox.domain.job_execution import db as _exec_db
    from forecastbox.domain.job_execution.exceptions import JobExecutionNotFound
    from forecastbox.utility.auth import AuthContext

    try:
        await _exec_db.soft_delete_job_execution(execution_id, actor=AuthContext(user_id=None, is_admin=True))
    except JobExecutionNotFound:
        pass  # preserve original silent-no-op behaviour


# ---------------------------------------------------------------------------
# ExperimentNext — thin proxies; canonical implementation in domain.experiment.scheduling.db
# ---------------------------------------------------------------------------


async def upsert_experiment_next(*, experiment_id: str, scheduled_at: dt.datetime) -> None:
    """Thin proxy; canonical implementation in ``forecastbox.domain.experiment.scheduling.db``."""
    from forecastbox.domain.experiment.scheduling import db as _sched_db

    await _sched_db.upsert_experiment_next(experiment_id=experiment_id, scheduled_at=scheduled_at)


async def get_experiment_next(experiment_id: str) -> ExperimentNext | None:
    """Thin proxy; canonical implementation in ``forecastbox.domain.experiment.scheduling.db``."""
    from forecastbox.domain.experiment.scheduling import db as _sched_db

    return await _sched_db.get_experiment_next(experiment_id)


async def delete_experiment_next(experiment_id: str) -> None:
    """Thin proxy; canonical implementation in ``forecastbox.domain.experiment.scheduling.db``."""
    from forecastbox.domain.experiment.scheduling import db as _sched_db

    await _sched_db.delete_experiment_next(experiment_id)


async def get_schedulable_experiments(now: dt.datetime) -> list[tuple[ExperimentNext, ExperimentDefinition]]:
    """Thin proxy; canonical implementation in ``forecastbox.domain.experiment.scheduling.db``."""
    from forecastbox.domain.experiment.scheduling import db as _sched_db

    return await _sched_db.get_schedulable_experiments(now)


async def next_schedulable_experiment() -> dt.datetime | None:
    """Thin proxy; canonical implementation in ``forecastbox.domain.experiment.scheduling.db``."""
    from forecastbox.domain.experiment.scheduling import db as _sched_db

    return await _sched_db.next_schedulable_experiment()


async def list_job_executions_by_experiment(experiment_id: str, offset: int = 0, limit: int | None = None) -> Iterable[JobExecution]:
    """Thin proxy; canonical implementation in ``forecastbox.domain.job_execution.db``.

    Uses a system-level (admin) actor so that all executions are returned.
    """
    from forecastbox.domain.job_execution import db as _exec_db
    from forecastbox.utility.auth import AuthContext

    return await _exec_db.list_job_executions_by_experiment(
        experiment_id, actor=AuthContext(user_id=None, is_admin=True), offset=offset, limit=limit
    )


async def count_job_executions_by_experiment(experiment_id: str) -> int:
    """Thin proxy; canonical implementation in ``forecastbox.domain.job_execution.db``.

    Uses a system-level (admin) actor so that all executions are counted.
    """
    from forecastbox.domain.job_execution import db as _exec_db
    from forecastbox.utility.auth import AuthContext

    return await _exec_db.count_job_executions_by_experiment(experiment_id, actor=AuthContext(user_id=None, is_admin=True))
