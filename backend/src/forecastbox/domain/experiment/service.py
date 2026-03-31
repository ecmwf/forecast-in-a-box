# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Service layer for the experiment / cron-schedule domain.

Owns create/update/delete/get/list schedule operations previously embedded in
route code.  No HTTP exceptions are raised here; callers are responsible for
mapping domain exceptions to HTTP responses.

Authorization is enforced here:
- ``ExperimentAccessDenied`` when the actor lacks permission.
- ``ExperimentNotFound`` when the target does not exist.
- ``SchedulerBusy`` when the scheduler lock cannot be acquired.
- ``ValueError`` for invalid inputs (e.g. bad cron expression).
"""

import datetime as dt
import logging
from collections.abc import Iterable
from typing import cast

import forecastbox.db.jobs as db_jobs
import forecastbox.domain.experiment.db as experiment_db
import forecastbox.domain.experiment.scheduling.db as scheduling_db
from forecastbox.domain.experiment.exceptions import ExperimentNotFound, SchedulerBusy
from forecastbox.domain.experiment.scheduling.dt_utils import calculate_next_run, current_scheduling_time, parse_crontab
from forecastbox.domain.experiment.scheduling.scheduler_thread import (
    prod_scheduler,
    scheduler_lock,
    timeout_acquire_request,
)
from forecastbox.ecpyutil import timed_acquire
from forecastbox.schemas.jobs import ExperimentDefinition, JobExecution
from forecastbox.utility.auth import AuthContext

logger = logging.getLogger(__name__)


def resolve_next_run(
    first_run_override: dt.datetime | None,
    max_delay_hours: int,
    cron_expr: str,
) -> dt.datetime:
    """Return first_run_override if provided and within max_delay_hours of now, else calculate next cron tick.

    Raises ValueError if first_run_override is provided but older than max_delay_hours.
    """
    now = current_scheduling_time()
    if first_run_override is not None:
        age_hours = (now - first_run_override).total_seconds() / 3600
        if age_hours > max_delay_hours:
            raise ValueError(f"first_run_override is {age_hours:.2f}h old, which exceeds max_acceptable_delay_hours={max_delay_hours}.")
        return first_run_override
    return calculate_next_run(now, cron_expr)


async def create_schedule(
    actor: AuthContext,
    job_definition_id: str,
    job_definition_version: int | None,
    cron_expr: str,
    dynamic_expr: dict[str, str],
    max_acceptable_delay_hours: int,
    first_run_override: dt.datetime | None,
    display_name: str | None,
    display_description: str | None,
    tags: list[str] | None,
) -> str:
    """Create a new cron schedule experiment and schedule its first run. Returns the experiment_id.

    Raises ValueError for invalid cron expression or missing job definition.
    Raises ExperimentAccessDenied if the actor is unauthenticated.
    """
    try:
        parse_crontab(cron_expr)
    except ValueError as e:
        raise ValueError(f"Invalid crontab: {cron_expr} => {e}") from e

    job_def = await db_jobs.get_job_definition(job_definition_id, job_definition_version)
    if job_def is None:
        raise ExperimentNotFound(f"JobDefinition {job_definition_id!r} not found")

    job_def_id = str(job_def.job_definition_id)  # ty:ignore[invalid-argument-type]
    job_def_version = cast(int, job_def.version)

    experiment_definition_payload = {
        "cron_expr": cron_expr,
        "dynamic_expr": dynamic_expr,
        "max_acceptable_delay_hours": max_acceptable_delay_hours,
        "enabled": True,
    }
    experiment_id, _ = await experiment_db.upsert_experiment_definition(
        actor=actor,
        job_definition_id=job_def_id,
        job_definition_version=job_def_version,
        experiment_type="cron_schedule",
        created_by=actor.user_id,
        experiment_definition=experiment_definition_payload,
        display_name=display_name,
        display_description=display_description,
        tags=tags,
    )

    next_run_at = resolve_next_run(first_run_override, max_acceptable_delay_hours, cron_expr)
    await scheduling_db.upsert_experiment_next(experiment_id=experiment_id, scheduled_at=next_run_at)
    logger.debug(f"Schedule {experiment_id}: next run at {next_run_at}")
    prod_scheduler()

    return experiment_id


async def get_schedule(actor: AuthContext, experiment_id: str) -> ExperimentDefinition:
    """Return the experiment definition for a cron schedule.

    Raises ExperimentNotFound if not found or not a cron schedule.
    Possession of the ID is treated as sufficient read access.
    """
    exp_def = await experiment_db.get_experiment_definition(experiment_id)
    if exp_def is None or exp_def.experiment_type != "cron_schedule":
        raise ExperimentNotFound(f"Schedule {experiment_id} not found")
    return exp_def


async def list_schedules(
    actor: AuthContext,
    page: int,
    page_size: int,
) -> tuple[list[ExperimentDefinition], int, int]:
    """Return (schedules, total, total_pages) for cron-schedule experiments visible to the actor.

    Raises ValueError if page or page_size are less than 1, or if page is out of range.
    """
    if page < 1 or page_size < 1:
        raise ValueError("Page and page_size must be greater than 0.")

    total = await experiment_db.count_experiment_definitions(actor=actor, experiment_type="cron_schedule")
    start = (page - 1) * page_size
    total_pages = (total + page_size - 1) // page_size if total > 0 else 0

    if start >= total and total > 0:
        raise ValueError("Page number out of range.")

    experiments = list(
        await experiment_db.list_experiment_definitions(actor=actor, experiment_type="cron_schedule", offset=start, limit=page_size)
    )
    return experiments, total, total_pages


async def update_schedule(
    actor: AuthContext,
    experiment_id: str,
    cron_expr: str | None,
    enabled: bool | None,
    dynamic_expr: dict[str, str] | None,
    max_acceptable_delay_hours: int | None,
    first_run_override: dt.datetime | None,
) -> ExperimentDefinition:
    """Update a cron schedule experiment. Returns the updated ExperimentDefinition.

    Acquires scheduler_lock for the duration.  Raises SchedulerBusy if lock
    cannot be acquired.  Raises ExperimentNotFound or ExperimentAccessDenied as
    appropriate.  Raises ValueError for an invalid cron expression or stale
    first_run_override.
    """
    with timed_acquire(scheduler_lock, timeout_acquire_request) as acquired:
        if not acquired:
            raise SchedulerBusy("Scheduler is busy, please retry.")

        current = await experiment_db.get_experiment_definition(experiment_id)
        if current is None or current.experiment_type != "cron_schedule":
            raise ExperimentNotFound(f"Schedule {experiment_id} not found")

        current_def = cast(dict, current.experiment_definition) or {}

        new_cron_expr = cron_expr if cron_expr is not None else str(current_def.get("cron_expr", ""))
        if cron_expr is not None:
            try:
                parse_crontab(cron_expr)
            except ValueError as e:
                raise ValueError(f"Invalid crontab: {cron_expr} => {e}") from e

        new_enabled = enabled if enabled is not None else bool(current_def.get("enabled", True))
        new_dynamic_expr = dynamic_expr if dynamic_expr is not None else cast(dict, current_def.get("dynamic_expr", {}))
        new_max_delay = (
            max_acceptable_delay_hours if max_acceptable_delay_hours is not None else int(current_def.get("max_acceptable_delay_hours", 24))
        )

        new_experiment_definition = {
            "cron_expr": new_cron_expr,
            "dynamic_expr": new_dynamic_expr,
            "max_acceptable_delay_hours": new_max_delay,
            "enabled": new_enabled,
        }

        await experiment_db.upsert_experiment_definition(
            actor=actor,
            experiment_definition_id=experiment_id,
            job_definition_id=str(current.job_definition_id),  # ty:ignore[invalid-argument-type]
            job_definition_version=cast(int, current.job_definition_version),
            experiment_type="cron_schedule",
            created_by=cast(str | None, current.created_by),
            experiment_definition=new_experiment_definition,
            display_name=cast(str | None, current.display_name),
            display_description=cast(str | None, current.display_description),
            tags=cast(list[str] | None, current.tags),
        )

        if cron_expr is not None or enabled is not None or first_run_override is not None:
            if new_enabled:
                next_run_at = resolve_next_run(first_run_override, new_max_delay, new_cron_expr)
                await scheduling_db.upsert_experiment_next(experiment_id=experiment_id, scheduled_at=next_run_at)
                logger.debug(f"Schedule {experiment_id}: regenerated next run at {next_run_at}")
            else:
                await scheduling_db.delete_experiment_next(experiment_id)
                logger.debug(f"Schedule {experiment_id}: disabled, next run cleared")
        prod_scheduler()

    updated = await experiment_db.get_experiment_definition(experiment_id)
    assert updated is not None
    return updated


async def delete_schedule(actor: AuthContext, experiment_id: str) -> None:
    """Soft-delete a cron schedule experiment and clear its next run.

    Acquires scheduler_lock for the duration.  Raises SchedulerBusy if lock
    cannot be acquired.  Raises ExperimentNotFound or ExperimentAccessDenied.
    """
    with timed_acquire(scheduler_lock, timeout_acquire_request) as acquired:
        if not acquired:
            raise SchedulerBusy("Scheduler is busy, please retry.")
        await experiment_db.soft_delete_experiment_definition(experiment_id, actor=actor)
        await scheduling_db.delete_experiment_next(experiment_id)
    prod_scheduler()


async def get_next_run(actor: AuthContext, experiment_id: str) -> str:
    """Return the next scheduled run time for a cron schedule, or a 'not scheduled' message.

    Raises ExperimentNotFound if the schedule does not exist.
    """
    exp_def = await experiment_db.get_experiment_definition(experiment_id)
    if exp_def is None or exp_def.experiment_type != "cron_schedule":
        raise ExperimentNotFound(f"Schedule {experiment_id} not found")
    next_entry = await scheduling_db.get_experiment_next(experiment_id)
    if next_entry is None:
        return "not scheduled currently"
    return str(next_entry.scheduled_at)


async def get_schedule_runs(
    actor: AuthContext,
    experiment_id: str,
    page: int,
    page_size: int,
) -> tuple[Iterable[JobExecution], int, int]:
    """Return (executions, total, total_pages) for runs linked to a cron schedule experiment.

    Raises ExperimentNotFound if the schedule does not exist.
    Raises ValueError if page or page_size are invalid.
    """
    if page < 1 or page_size < 1:
        raise ValueError("Page and page_size must be greater than 0.")

    exp_def = await experiment_db.get_experiment_definition(experiment_id)
    if exp_def is None or exp_def.experiment_type != "cron_schedule":
        raise ExperimentNotFound(f"Schedule {experiment_id} not found")

    total = await db_jobs.count_job_executions_by_experiment(experiment_id)
    start = (page - 1) * page_size
    total_pages = (total + page_size - 1) // page_size if total > 0 else 0

    if start >= total and total > 0:
        raise ValueError("Page number out of range.")

    executions = await db_jobs.list_job_executions_by_experiment(experiment_id, offset=start, limit=page_size)
    return executions, total, total_pages
