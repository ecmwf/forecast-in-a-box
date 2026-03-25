# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import datetime as dt
import logging
from dataclasses import dataclass
from typing import cast

from fastapi import APIRouter, Depends, HTTPException

import forecastbox.db.jobs as db_jobs
from forecastbox.api.scheduling.dt_utils import calculate_next_run, current_scheduling_time, parse_crontab
from forecastbox.api.scheduling.scheduler_thread import (
    prod_scheduler,
    scheduler_lock,
    start_scheduler,
    stop_scheduler,
    timeout_acquire_request,
)
from forecastbox.api.types.scheduling import ScheduleSpecification, ScheduleUpdate
from forecastbox.auth.users import current_active_user
from forecastbox.ecpyutil import timed_acquire
from forecastbox.schemas.jobs import ExperimentDefinition
from forecastbox.schemas.user import UserRead

logger = logging.getLogger(__name__)

router = APIRouter(
    tags=["schedule"],
    responses={404: {"description": "Not found"}},
)


# ---------------------------------------------------------------------------
# V2 response types (defined here so endpoint functions below can reference them)
# ---------------------------------------------------------------------------


@dataclass(frozen=True, eq=True, slots=True)
class CreateScheduleResponse:
    experiment_id: str


@dataclass(frozen=True, eq=True, slots=True)
class ScheduleDefinitionResponse:
    experiment_id: str
    experiment_version: int
    job_definition_id: str
    job_definition_version: int
    cron_expr: str
    dynamic_expr: dict[str, str]
    max_acceptable_delay_hours: int
    enabled: bool
    created_at: str
    created_by: str | None
    display_name: str | None
    display_description: str | None
    tags: list[str] | None = None


@dataclass(frozen=True, eq=True, slots=True)
class ListSchedulesResponse:
    schedules: list[ScheduleDefinitionResponse]
    total: int
    page: int
    page_size: int
    total_pages: int
    error: str | None = None


@dataclass(frozen=True, eq=True, slots=True)
class ScheduleRunResponse:
    execution_id: str
    attempt_count: int
    status: str
    created_at: str
    updated_at: str
    experiment_context: str | None


@dataclass(frozen=True, eq=True, slots=True)
class ScheduleRunsResponse:
    runs: list[ScheduleRunResponse]
    total: int
    page: int
    page_size: int
    total_pages: int
    error: str | None = None


def _resolve_next_run(first_run_override: dt.datetime | None, max_delay_hours: int, cron_expr: str) -> dt.datetime:
    """Return first_run_override if provided and within max_delay_hours of now, else calculate next cron tick.

    Raises HTTPException 400 if first_run_override is provided but older than max_delay_hours.
    """
    now = current_scheduling_time()
    if first_run_override is not None:
        age_hours = (now - first_run_override).total_seconds() / 3600
        if age_hours > max_delay_hours:
            raise HTTPException(
                status_code=400,
                detail=f"first_run_override is {age_hours:.2f}h old, which exceeds max_acceptable_delay_hours={max_delay_hours}.",
            )
        return first_run_override
    return calculate_next_run(now, cron_expr)


def _experiment_to_response(exp: ExperimentDefinition) -> ScheduleDefinitionResponse:
    exp_def = cast(dict, exp.experiment_definition) or {}
    return ScheduleDefinitionResponse(
        experiment_id=str(exp.experiment_definition_id),  # ty:ignore[invalid-argument-type]
        experiment_version=cast(int, exp.version),
        job_definition_id=str(exp.job_definition_id),  # ty:ignore[invalid-argument-type]
        job_definition_version=cast(int, exp.job_definition_version),
        cron_expr=str(exp_def.get("cron_expr", "")),
        dynamic_expr=cast(dict, exp_def.get("dynamic_expr", {})),
        max_acceptable_delay_hours=int(exp_def.get("max_acceptable_delay_hours", 24)),
        enabled=bool(exp_def.get("enabled", True)),
        created_at=str(exp.created_at),
        created_by=cast(str | None, exp.created_by),
        display_name=cast(str | None, exp.display_name),
        display_description=cast(str | None, exp.display_description),
        tags=cast(list[str] | None, exp.tags),
    )


@router.get("/list")
async def list_schedules(
    user: UserRead = Depends(current_active_user),
    page: int = 1,
    page_size: int = 10,
) -> ListSchedulesResponse:
    if page < 1 or page_size < 1:
        raise HTTPException(status_code=400, detail="Page and page_size must be greater than 0.")

    total = await db_jobs.count_experiment_definitions(experiment_type="cron_schedule")
    start = (page - 1) * page_size
    total_pages = (total + page_size - 1) // page_size if total > 0 else 0

    if start >= total and total > 0:
        raise HTTPException(status_code=404, detail="Page number out of range.")

    experiments = list(await db_jobs.list_experiment_definitions(experiment_type="cron_schedule", offset=start, limit=page_size))
    schedules = [_experiment_to_response(exp) for exp in experiments]
    return ListSchedulesResponse(schedules=schedules, total=total, page=page, page_size=page_size, total_pages=total_pages)


@router.put("/create")
async def create_schedule(
    schedule_spec: ScheduleSpecification, user: UserRead | None = Depends(current_active_user)
) -> CreateScheduleResponse:
    try:
        parse_crontab(schedule_spec.cron_expr)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid crontab: {schedule_spec.cron_expr} => {e}")

    job_def = await db_jobs.get_job_definition(schedule_spec.job_definition_id, schedule_spec.job_definition_version)
    if job_def is None:
        raise HTTPException(status_code=404, detail=f"JobDefinition {schedule_spec.job_definition_id!r} not found")

    job_def_id = str(job_def.job_definition_id)  # ty:ignore[invalid-argument-type]
    job_def_version = cast(int, job_def.version)

    experiment_definition = {
        "cron_expr": schedule_spec.cron_expr,
        "dynamic_expr": schedule_spec.dynamic_expr,
        "max_acceptable_delay_hours": schedule_spec.max_acceptable_delay_hours,
        "enabled": True,
    }
    experiment_id, _ = await db_jobs.upsert_experiment_definition(
        job_definition_id=job_def_id,
        job_definition_version=job_def_version,
        experiment_type="cron_schedule",
        created_by=user.email if user is not None else None,
        experiment_definition=experiment_definition,
        display_name=schedule_spec.display_name,
        display_description=schedule_spec.display_description,
        tags=schedule_spec.tags,
    )

    next_run_at = _resolve_next_run(schedule_spec.first_run_override, schedule_spec.max_acceptable_delay_hours, schedule_spec.cron_expr)
    await db_jobs.upsert_experiment_next(experiment_id=experiment_id, scheduled_at=next_run_at)
    logger.debug(f"V2 schedule {experiment_id}: next run at {next_run_at}")
    prod_scheduler()

    return CreateScheduleResponse(experiment_id=experiment_id)


@router.get("/get")
async def get_schedule(experiment_id: str, user: UserRead = Depends(current_active_user)) -> ScheduleDefinitionResponse:
    exp_def = await db_jobs.get_experiment_definition(experiment_id)
    if exp_def is None or exp_def.experiment_type != "cron_schedule":
        raise HTTPException(status_code=404, detail=f"Schedule {experiment_id} not found")
    return _experiment_to_response(exp_def)


@router.post("/update")
async def update_schedule(
    experiment_id: str, update: ScheduleUpdate, user: UserRead | None = Depends(current_active_user)
) -> ScheduleDefinitionResponse:
    with timed_acquire(scheduler_lock, timeout_acquire_request) as acquired:
        if not acquired:
            raise HTTPException(status_code=503, detail="Scheduler is busy, please retry.")
        current = await db_jobs.get_experiment_definition(experiment_id)
        if current is None or current.experiment_type != "cron_schedule":
            raise HTTPException(status_code=404, detail=f"Schedule {experiment_id} not found")

        current_def = cast(dict, current.experiment_definition) or {}

        new_cron_expr = update.cron_expr if update.cron_expr is not None else str(current_def.get("cron_expr", ""))
        if update.cron_expr is not None:
            try:
                parse_crontab(update.cron_expr)
            except ValueError as e:
                raise HTTPException(status_code=400, detail=f"Invalid crontab: {update.cron_expr} => {e}")

        new_enabled = update.enabled if update.enabled is not None else bool(current_def.get("enabled", True))
        new_dynamic_expr = update.dynamic_expr if update.dynamic_expr is not None else cast(dict, current_def.get("dynamic_expr", {}))
        new_max_delay = (
            update.max_acceptable_delay_hours
            if update.max_acceptable_delay_hours is not None
            else int(current_def.get("max_acceptable_delay_hours", 24))
        )

        # TODO this should be typed, not arbitrary dict
        new_experiment_definition = {
            "cron_expr": new_cron_expr,
            "dynamic_expr": new_dynamic_expr,
            "max_acceptable_delay_hours": new_max_delay,
            "enabled": new_enabled,
        }

        await db_jobs.upsert_experiment_definition(
            experiment_definition_id=experiment_id,
            job_definition_id=str(current.job_definition_id),  # ty:ignore[invalid-argument-type]
            job_definition_version=cast(int, current.job_definition_version),
            experiment_type="cron_schedule",
            created_by=user.email if user else None,  # ty:ignore[unresolved-attribute]
            experiment_definition=new_experiment_definition,
            display_name=cast(str | None, current.display_name),
            display_description=cast(str | None, current.display_description),
            tags=cast(list[str] | None, current.tags),
        )

        if update.cron_expr is not None or update.enabled is not None or update.first_run_override is not None:
            if new_enabled:
                next_run_at = _resolve_next_run(update.first_run_override, new_max_delay, new_cron_expr)
                await db_jobs.upsert_experiment_next(experiment_id=experiment_id, scheduled_at=next_run_at)
                logger.debug(f"V2 schedule {experiment_id}: regenerated next run at {next_run_at}")
            else:
                await db_jobs.delete_experiment_next(experiment_id)
                logger.debug(f"V2 schedule {experiment_id}: disabled, next run cleared")
        prod_scheduler()

    updated = await db_jobs.get_experiment_definition(experiment_id)
    assert updated is not None
    return _experiment_to_response(updated)


@router.post("/delete")
async def delete_schedule(experiment_id: str, user: UserRead = Depends(current_active_user)) -> None:
    with timed_acquire(scheduler_lock, timeout_acquire_request) as acquired:
        if not acquired:
            raise HTTPException(status_code=503, detail="Scheduler is busy, please retry.")
        was_deleted = await db_jobs.soft_delete_experiment_definition(experiment_id)
        await db_jobs.delete_experiment_next(experiment_id)  # we delete regardless
    if not was_deleted:
        raise HTTPException(status_code=404, detail=f"Schedule {experiment_id} not found in the database.")
    prod_scheduler()


@router.get("/next_run")
async def get_next_run(experiment_id: str, user: UserRead = Depends(current_active_user)) -> str:
    exp_def = await db_jobs.get_experiment_definition(experiment_id)
    if exp_def is None or exp_def.experiment_type != "cron_schedule":
        raise HTTPException(status_code=404, detail=f"Schedule {experiment_id} not found")
    next_entry = await db_jobs.get_experiment_next(experiment_id)
    if next_entry is None:
        return "not scheduled currently"
    return str(next_entry.scheduled_at)


@router.get("/runs")
async def get_schedule_runs(
    experiment_id: str,
    user: UserRead = Depends(current_active_user),
    page: int = 1,
    page_size: int = 10,
) -> ScheduleRunsResponse:
    """Return paginated JobExecution rows linked to a cron schedule experiment."""
    if page < 1 or page_size < 1:
        raise HTTPException(status_code=400, detail="Page and page_size must be greater than 0.")

    exp_def = await db_jobs.get_experiment_definition(experiment_id)
    if exp_def is None or exp_def.experiment_type != "cron_schedule":
        raise HTTPException(status_code=404, detail=f"Schedule {experiment_id} not found")

    total = await db_jobs.count_job_executions_by_experiment(experiment_id)
    start = (page - 1) * page_size
    total_pages = (total + page_size - 1) // page_size if total > 0 else 0

    if start >= total and total > 0:
        raise HTTPException(status_code=404, detail="Page number out of range.")

    executions = list(await db_jobs.list_job_executions_by_experiment(experiment_id, offset=start, limit=page_size))

    runs = [
        ScheduleRunResponse(
            execution_id=str(ex.job_execution_id),  # ty:ignore[invalid-argument-type]
            attempt_count=cast(int, ex.attempt_count),
            status=cast(str, ex.status),
            created_at=str(ex.created_at),
            updated_at=str(ex.updated_at),
            experiment_context=cast(str | None, ex.experiment_context),
        )
        for ex in executions
    ]
    return ScheduleRunsResponse(runs=runs, total=total, page=page, page_size=page_size, total_pages=total_pages)


@router.get("/current_time")
async def get_current_scheduling_time(user: UserRead = Depends(current_active_user)) -> str:
    """Return the current time used for scheduling decisions."""
    return current_scheduling_time().isoformat()


@router.post("/restart")
async def restart_scheduler() -> None:
    stop_scheduler()
    start_scheduler()
