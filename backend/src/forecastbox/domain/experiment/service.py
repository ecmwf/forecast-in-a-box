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
route code. No HTTP exceptions are raised here; callers are responsible for
mapping domain exceptions to HTTP responses.
"""

import datetime as dt
import logging
from collections.abc import Callable, Iterable
from functools import partial
from typing import cast

import forecastbox.domain.blueprint.db as blueprint_db
import forecastbox.domain.experiment.db as experiment_db
import forecastbox.domain.experiment.scheduling.db as scheduling_db
import forecastbox.domain.run.db as run_db
from forecastbox.domain.blueprint.types import BlueprintId
from forecastbox.domain.experiment.exceptions import ExperimentNotFound, SchedulerBusy
from forecastbox.domain.experiment.scheduling.background import prod_scheduler, scheduler_lock, timeout_acquire_request
from forecastbox.domain.experiment.scheduling.dt_utils import calculate_next_run, parse_crontab
from forecastbox.domain.experiment.types import ExperimentDefinitionId
from forecastbox.domain.run.db import RunRecord
from forecastbox.utility.auth import AuthContext
from forecastbox.utility.concurrency.manager import TaskName, execution_manager
from forecastbox.utility.concurrency.synchronization import timed_acquire
from forecastbox.utility.config import ConcurrentPools
from forecastbox.utility.pagination import PaginationSpec
from forecastbox.utility.time import current_time

logger = logging.getLogger(__name__)


async def _await_jobs_db(task_name: str, task: Callable[[], object]) -> object:
    return await execution_manager.awaitable_submit(ConcurrentPools.JobsDb, TaskName(task_name), task)


def resolve_next_run(
    first_run_override: dt.datetime | None,
    max_delay_hours: int,
    cron_expr: str,
) -> dt.datetime:
    """Return first_run_override if provided and within max_delay_hours of now, else calculate next cron tick."""
    now = current_time("scheduling")
    if first_run_override is not None:
        age_hours = (now - first_run_override).total_seconds() / 3600
        if age_hours > max_delay_hours:
            raise ValueError(f"first_run_override is {age_hours:.2f}h old, which exceeds max_acceptable_delay_hours={max_delay_hours}.")
        return first_run_override
    return calculate_next_run(now, cron_expr)


async def create_schedule(
    auth_context: AuthContext,
    blueprint_id: BlueprintId,
    blueprint_version: int | None,
    cron_expr: str,
    max_acceptable_delay_hours: int,
    first_run_override: dt.datetime | None,
    display_name: str | None,
    display_description: str | None,
    tags: list[str] | None,
) -> ExperimentDefinitionId:
    """Create a new cron schedule experiment and schedule its first run."""
    try:
        parse_crontab(cron_expr)
    except ValueError as e:
        raise ValueError(f"Invalid crontab: {cron_expr} => {e}") from e

    job_def = cast(
        blueprint_db.BlueprintRecord | None,
        await _await_jobs_db(
            "blueprint.get",
            partial(blueprint_db.get_blueprint, blueprint_id, blueprint_version),
        ),
    )
    if job_def is None:
        raise ExperimentNotFound(f"Blueprint {blueprint_id!r} not found")

    experiment_definition_payload = {
        "cron_expr": cron_expr,
        "max_acceptable_delay_hours": max_acceptable_delay_hours,
        "enabled": True,
    }
    experiment_id, _ = cast(
        tuple[ExperimentDefinitionId, int],
        await _await_jobs_db(
            "experiment.definition.upsert",
            partial(
                experiment_db.upsert_experiment_definition,
                auth_context=auth_context,
                blueprint_id=job_def.blueprint_id,
                blueprint_version=job_def.version,
                experiment_type="cron_schedule",
                created_by=auth_context.user_id,
                experiment_definition=experiment_definition_payload,
                display_name=display_name,
                display_description=display_description,
                tags=tags,
            ),
        ),
    )

    next_run_at = resolve_next_run(first_run_override, max_acceptable_delay_hours, cron_expr)
    await _await_jobs_db(
        "experiment.next.upsert",
        partial(scheduling_db.upsert_experiment_next, experiment_id=experiment_id, scheduled_at=next_run_at),
    )
    logger.debug(f"Schedule {experiment_id}: next run at {next_run_at}")
    prod_scheduler()

    return experiment_id


async def get_schedule(
    auth_context: AuthContext, experiment_id: ExperimentDefinitionId, version: int | None = None
) -> experiment_db.ExperimentLatest:
    """Return the experiment schedule for a cron schedule."""
    results = list(
        cast(
            Iterable[experiment_db.ExperimentLatest],
            await _await_jobs_db(
                "experiment.definition.list",
                partial(
                    experiment_db.list_experiment_definitions,
                    auth_context=auth_context,
                    experiment_definition_id=experiment_id,
                    version=version,
                    limit=1,
                ),
            ),
        )
    )
    if not results or results[0].experiment.experiment_type != "cron_schedule":
        raise ExperimentNotFound(f"Schedule {experiment_id} not found")
    return results[0]


async def list_schedules(
    auth_context: AuthContext,
    pagination: PaginationSpec,
) -> tuple[list[experiment_db.ExperimentLatest], int, int]:
    """Return (schedules, total, total_pages) for cron-schedule experiments visible to the actor."""
    total = cast(
        int,
        await _await_jobs_db(
            "experiment.definition.count",
            partial(experiment_db.count_experiment_definitions, auth_context=auth_context, experiment_type="cron_schedule"),
        ),
    )
    start = pagination.start()

    if start >= total and total > 0:
        raise ValueError("Page number out of range.")

    experiments = list(
        cast(
            Iterable[experiment_db.ExperimentLatest],
            await _await_jobs_db(
                "experiment.definition.list",
                partial(
                    experiment_db.list_experiment_definitions,
                    auth_context=auth_context,
                    experiment_type="cron_schedule",
                    offset=start,
                    limit=pagination.page_size,
                ),
            ),
        )
    )
    return experiments, total, pagination.total_pages(total)


async def update_schedule(
    auth_context: AuthContext,
    experiment_id: ExperimentDefinitionId,
    cron_expr: str | None,
    enabled: bool | None,
    max_acceptable_delay_hours: int | None,
    first_run_override: dt.datetime | None,
) -> experiment_db.ExperimentLatest:
    """Update a cron schedule experiment."""
    with timed_acquire(scheduler_lock, timeout_acquire_request) as acquired:
        if not acquired:
            raise SchedulerBusy("Scheduler is busy, please retry.")

        current = cast(
            experiment_db.ExperimentDefinitionRecord | None,
            await _await_jobs_db(
                "experiment.definition.get",
                partial(experiment_db.get_experiment_definition, experiment_id),
            ),
        )
        if current is None or current.experiment_type != "cron_schedule":
            raise ExperimentNotFound(f"Schedule {experiment_id} not found")

        current_def = current.experiment_definition or {}

        new_cron_expr = cron_expr if cron_expr is not None else str(current_def.get("cron_expr", ""))
        if cron_expr is not None:
            try:
                parse_crontab(cron_expr)
            except ValueError as e:
                raise ValueError(f"Invalid crontab: {cron_expr} => {e}") from e

        new_enabled = enabled if enabled is not None else bool(current_def.get("enabled", True))
        new_max_delay = (
            max_acceptable_delay_hours if max_acceptable_delay_hours is not None else int(current_def.get("max_acceptable_delay_hours", 24))
        )

        new_experiment_definition = {
            "cron_expr": new_cron_expr,
            "max_acceptable_delay_hours": new_max_delay,
            "enabled": new_enabled,
        }

        await _await_jobs_db(
            "experiment.definition.upsert",
            partial(
                experiment_db.upsert_experiment_definition,
                auth_context=auth_context,
                experiment_definition_id=experiment_id,
                blueprint_id=current.blueprint_id,
                blueprint_version=current.blueprint_version,
                experiment_type="cron_schedule",
                created_by=current.created_by,
                experiment_definition=new_experiment_definition,
                display_name=current.display_name,
                display_description=current.display_description,
                tags=current.tags,
            ),
        )

        if cron_expr is not None or enabled is not None or first_run_override is not None:
            if new_enabled:
                next_run_at = resolve_next_run(first_run_override, new_max_delay, new_cron_expr)
                await _await_jobs_db(
                    "experiment.next.upsert",
                    partial(scheduling_db.upsert_experiment_next, experiment_id=experiment_id, scheduled_at=next_run_at),
                )
                logger.debug(f"Schedule {experiment_id}: regenerated next run at {next_run_at}")
            else:
                await _await_jobs_db(
                    "experiment.next.delete",
                    partial(scheduling_db.delete_experiment_next, experiment_id),
                )
                logger.debug(f"Schedule {experiment_id}: disabled, next run cleared")
        prod_scheduler()

    updated = list(
        cast(
            Iterable[experiment_db.ExperimentLatest],
            await _await_jobs_db(
                "experiment.definition.list",
                partial(
                    experiment_db.list_experiment_definitions, auth_context=auth_context, experiment_definition_id=experiment_id, limit=1
                ),
            ),
        )
    )
    assert updated
    return updated[0]


async def delete_schedule(auth_context: AuthContext, experiment_id: ExperimentDefinitionId) -> None:
    """Soft-delete a cron schedule experiment and clear its next run."""
    with timed_acquire(scheduler_lock, timeout_acquire_request) as acquired:
        if not acquired:
            raise SchedulerBusy("Scheduler is busy, please retry.")
        await _await_jobs_db(
            "experiment.definition.delete",
            partial(experiment_db.soft_delete_experiment_definition, experiment_id, auth_context=auth_context),
        )
        await _await_jobs_db(
            "experiment.next.delete",
            partial(scheduling_db.delete_experiment_next, experiment_id),
        )
    prod_scheduler()


async def get_next_run(auth_context: AuthContext, experiment_id: ExperimentDefinitionId) -> str:
    """Return the next scheduled run time for a cron schedule, or a 'not scheduled' message."""
    exp_def = cast(
        experiment_db.ExperimentDefinitionRecord | None,
        await _await_jobs_db(
            "experiment.definition.get",
            partial(experiment_db.get_experiment_definition, experiment_id),
        ),
    )
    if exp_def is None or exp_def.experiment_type != "cron_schedule":
        raise ExperimentNotFound(f"Schedule {experiment_id} not found")
    next_entry = cast(
        scheduling_db.ExperimentNextRecord | None,
        await _await_jobs_db(
            "experiment.next.get",
            partial(scheduling_db.get_experiment_next, experiment_id),
        ),
    )
    if next_entry is None:
        return "not scheduled currently"
    return str(next_entry.scheduled_at)


async def get_schedule_runs(
    auth_context: AuthContext,
    experiment_id: ExperimentDefinitionId,
    pagination: PaginationSpec,
) -> tuple[Iterable[RunRecord], int, int]:
    """Return (executions, total, total_pages) for runs linked to a cron schedule experiment."""
    exp_def = cast(
        experiment_db.ExperimentDefinitionRecord | None,
        await _await_jobs_db(
            "experiment.definition.get",
            partial(experiment_db.get_experiment_definition, experiment_id),
        ),
    )
    if exp_def is None or exp_def.experiment_type != "cron_schedule":
        raise ExperimentNotFound(f"Schedule {experiment_id} not found")

    total = cast(
        int,
        await _await_jobs_db(
            "run.count-by-experiment",
            partial(run_db.count_runs_by_experiment, experiment_id, auth_context=auth_context),
        ),
    )
    start = pagination.start()

    if start >= total and total > 0:
        raise ValueError("Page number out of range.")

    executions = cast(
        Iterable[RunRecord],
        await _await_jobs_db(
            "run.list-by-experiment",
            partial(run_db.list_runs_by_experiment, experiment_id, auth_context=auth_context, offset=start, limit=pagination.page_size),
        ),
    )
    return executions, total, pagination.total_pages(total)
