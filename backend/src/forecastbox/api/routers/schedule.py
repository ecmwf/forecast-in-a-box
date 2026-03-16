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
import uuid
from dataclasses import dataclass
from typing import cast

from fastapi import APIRouter, Depends, HTTPException
from typing_extensions import Self

import forecastbox.db.jobs2 as db_jobs2
from forecastbox.api.execution import execute
from forecastbox.api.routers.job import STATUS
from forecastbox.api.scheduling.dt_utils import calculate_next_run, parse_crontab
from forecastbox.api.scheduling.job_utils import run2runnable
from forecastbox.api.scheduling.scheduler_thread import (
    prod_scheduler,
    regenerate_schedule_next,
    scheduler_lock,
    start_scheduler,
    stop_scheduler,
)
from forecastbox.api.types.scheduling import ScheduleSpecification, ScheduleSpecificationV2, ScheduleUpdate, ScheduleUpdateV2, schedule2db
from forecastbox.auth.users import current_active_user
from forecastbox.db.schedule import (
    ScheduleId,
    get_next_run,
    get_schedules,
    get_schedules_count,
    insert_next_run,
    insert_one,
    insert_schedule_run,
    select_runs,
    select_runs_count,
    update_one,
)
from forecastbox.schemas.job import JobRecord
from forecastbox.schemas.jobs2 import ExperimentDefinition
from forecastbox.schemas.schedule import ScheduleDefinition, ScheduleRun
from forecastbox.schemas.user import UserRead

logger = logging.getLogger(__name__)

router = APIRouter(
    tags=["schedule"],
    responses={404: {"description": "Not found"}},
)


@dataclass(frozen=True, eq=True, slots=True)
class GetScheduleRunResponse:
    schedule_run_id: str
    schedule_id: ScheduleId
    job_id: str | None
    attempt_cnt: int
    scheduled_at: str
    trigger: str
    status: STATUS | None = None

    @classmethod
    def from_db(cls, row: tuple[ScheduleRun, JobRecord]) -> Self:
        return cls(
            schedule_run_id=row[0].schedule_run_id,  # ty: ignore[invalid-argument-type]
            schedule_id=row[0].schedule_id,  # ty: ignore[invalid-argument-type]
            job_id=row[0].job_id,  # ty: ignore[invalid-argument-type]
            attempt_cnt=row[0].attempt_cnt,  # ty: ignore[invalid-argument-type]
            scheduled_at=str(row[0].scheduled_at),
            trigger=row[0].trigger,  # ty: ignore[invalid-argument-type]
            status=row[1].status if row[1] is not None else None,  # ty: ignore[invalid-argument-type]
        )


@dataclass(frozen=True, eq=True, slots=True)
class GetScheduleRunsResponse:
    runs: dict[str, GetScheduleRunResponse]
    total: int
    page: int
    page_size: int
    total_pages: int
    error: str | None = None


@dataclass(frozen=True, eq=True, slots=True)
class GetScheduleResponse:
    """Get Schedule Response."""

    schedule_id: ScheduleId
    cron_expr: str | None
    """Cron expression for the schedule. None if not time-triggered"""
    created_at: str
    """Creation timestamp of the schedule."""
    updated_at: str
    """Last update timestamp of the schedule."""
    exec_spec: str
    """Specification of the product computed by the schedule, without the dynamic fields."""
    dynamic_expr: str
    """Dynamic expressions used by the schedule."""
    enabled: bool
    """Whether the schedule is currently enabled to run."""
    created_by: str | None
    """Email of the user who created this schedule"""
    # TODO add next run?

    @classmethod
    def from_db(cls, entity: ScheduleDefinition) -> Self:
        return cls(
            schedule_id=entity.schedule_id,  # ty: ignore[invalid-argument-type]
            cron_expr=entity.cron_expr,  # ty: ignore[invalid-argument-type]
            created_at=str(entity.created_at),
            updated_at=str(entity.updated_at),
            exec_spec=entity.exec_spec,  # ty: ignore[invalid-argument-type]
            dynamic_expr=entity.dynamic_expr,  # ty: ignore[invalid-argument-type]
            enabled=entity.enabled,  # ty: ignore[invalid-argument-type]
            created_by=entity.created_by,  # ty: ignore[invalid-argument-type]
        )


@dataclass(frozen=True, eq=True, slots=True)
class GetMultipleSchedulesResponse:
    """Get Multiple Schedules Response.

    Contains multiple schedules with pagination metadata.
    """

    schedules: dict[ScheduleId, GetScheduleResponse]
    """A dictionary mapping schedule IDs to their responses."""
    total: int
    """Total number of schedules in the database matching the filtering status."""
    page: int
    """Current page number."""
    page_size: int
    """Number of items per page."""
    total_pages: int
    """Total number of pages."""
    error: str | None = None
    """An error message if there was an issue retrieving schedules, otherwise None."""


@dataclass(frozen=True, eq=True, slots=True)
class CreateScheduleResponse:
    schedule_id: ScheduleId


# ---------------------------------------------------------------------------
# V2 response types (defined here so endpoint functions below can reference them)
# ---------------------------------------------------------------------------


@dataclass(frozen=True, eq=True, slots=True)
class CreateScheduleV2Response:
    experiment_id: str


@dataclass(frozen=True, eq=True, slots=True)
class ScheduleDefinitionV2Response:
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
class ListSchedulesV2Response:
    schedules: list[ScheduleDefinitionV2Response]
    total: int
    page: int
    page_size: int
    total_pages: int
    error: str | None = None


def _experiment_to_v2_response(exp: ExperimentDefinition) -> ScheduleDefinitionV2Response:
    exp_def = cast(dict, exp.experiment_definition) or {}
    return ScheduleDefinitionV2Response(
        experiment_id=str(exp.id),  # ty:ignore[invalid-argument-type]
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


@router.get("/list_v2")
async def list_schedules_v2(
    user: UserRead = Depends(current_active_user),
    page: int = 1,
    page_size: int = 10,
) -> ListSchedulesV2Response:
    if page < 1 or page_size < 1:
        raise HTTPException(status_code=400, detail="Page and page_size must be greater than 0.")

    total = await db_jobs2.count_experiment_definitions(experiment_type="cron_schedule")
    start = (page - 1) * page_size
    total_pages = (total + page_size - 1) // page_size if total > 0 else 0

    if start >= total and total > 0:
        raise HTTPException(status_code=404, detail="Page number out of range.")

    experiments = list(await db_jobs2.list_experiment_definitions(experiment_type="cron_schedule", offset=start, limit=page_size))
    schedules = [_experiment_to_v2_response(exp) for exp in experiments]
    return ListSchedulesV2Response(schedules=schedules, total=total, page=page, page_size=page_size, total_pages=total_pages)


@router.put("/create_v2")
async def create_schedule_v2(
    schedule_spec: ScheduleSpecificationV2, user: UserRead | None = Depends(current_active_user)
) -> CreateScheduleV2Response:
    try:
        parse_crontab(schedule_spec.cron_expr)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid crontab: {schedule_spec.cron_expr} => {e}")

    job_def = await db_jobs2.get_job_definition(schedule_spec.job_definition_id, schedule_spec.job_definition_version)
    if job_def is None:
        raise HTTPException(status_code=404, detail=f"JobDefinition {schedule_spec.job_definition_id!r} not found")

    job_def_id = str(job_def.id)  # ty:ignore[invalid-argument-type]
    job_def_version = cast(int, job_def.version)

    experiment_definition = {
        "cron_expr": schedule_spec.cron_expr,
        "dynamic_expr": schedule_spec.dynamic_expr,
        "max_acceptable_delay_hours": schedule_spec.max_acceptable_delay_hours,
        "enabled": True,
    }
    experiment_id, _ = await db_jobs2.upsert_experiment_definition(
        job_definition_id=job_def_id,
        job_definition_version=job_def_version,
        experiment_type="cron_schedule",
        created_by=user.email if user is not None else None,  # ty:ignore[unresolved-attribute]
        experiment_definition=experiment_definition,
        display_name=schedule_spec.display_name,
        display_description=schedule_spec.display_description,
        tags=schedule_spec.tags,
    )

    next_run_at = calculate_next_run(dt.datetime.now(), schedule_spec.cron_expr)
    await db_jobs2.upsert_experiment_next(experiment_id=experiment_id, scheduled_at=next_run_at)
    logger.debug(f"V2 schedule {experiment_id}: next run at {next_run_at}")

    return CreateScheduleV2Response(experiment_id=experiment_id)


@router.get("/get_v2")
async def get_schedule_v2(experiment_id: str, user: UserRead = Depends(current_active_user)) -> ScheduleDefinitionV2Response:
    exp_def = await db_jobs2.get_experiment_definition(experiment_id)
    if exp_def is None or exp_def.experiment_type != "cron_schedule":
        raise HTTPException(status_code=404, detail=f"Schedule {experiment_id} not found")
    return _experiment_to_v2_response(exp_def)


@router.post("/update_v2")
async def update_schedule_v2(
    experiment_id: str, update: ScheduleUpdateV2, user: UserRead = Depends(current_active_user)
) -> ScheduleDefinitionV2Response:
    with scheduler_lock:  # NOTE this may block the async pool a bit!
        current = await db_jobs2.get_experiment_definition(experiment_id)
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

        new_experiment_definition = {
            "cron_expr": new_cron_expr,
            "dynamic_expr": new_dynamic_expr,
            "max_acceptable_delay_hours": new_max_delay,
            "enabled": new_enabled,
        }

        await db_jobs2.upsert_experiment_definition(
            id=experiment_id,
            job_definition_id=str(current.job_definition_id),  # ty:ignore[invalid-argument-type]
            job_definition_version=cast(int, current.job_definition_version),
            experiment_type="cron_schedule",
            created_by=user.email,  # ty:ignore[unresolved-attribute]
            experiment_definition=new_experiment_definition,
            display_name=cast(str | None, current.display_name),
            display_description=cast(str | None, current.display_description),
            tags=cast(list[str] | None, current.tags),
        )

        if update.cron_expr is not None or update.enabled is not None:
            if new_enabled:
                next_run_at = calculate_next_run(dt.datetime.now(), new_cron_expr)
                await db_jobs2.upsert_experiment_next(experiment_id=experiment_id, scheduled_at=next_run_at)
                logger.debug(f"V2 schedule {experiment_id}: regenerated next run at {next_run_at}")
            else:
                await db_jobs2.delete_experiment_next(experiment_id)
                logger.debug(f"V2 schedule {experiment_id}: disabled, next run cleared")

    updated = await db_jobs2.get_experiment_definition(experiment_id)
    assert updated is not None
    return _experiment_to_v2_response(updated)


@router.get("/next_run_v2")
async def get_next_run_v2(experiment_id: str, user: UserRead = Depends(current_active_user)) -> str:
    exp_def = await db_jobs2.get_experiment_definition(experiment_id)
    if exp_def is None or exp_def.experiment_type != "cron_schedule":
        raise HTTPException(status_code=404, detail=f"Schedule {experiment_id} not found")
    next_entry = await db_jobs2.get_experiment_next(experiment_id)
    if next_entry is None:
        return "not scheduled currently"
    return str(next_entry.scheduled_at)


async def get_schedule(schedule_id: ScheduleId, user: UserRead = Depends(current_active_user)) -> GetScheduleResponse:
    maybe_schedule = list(await get_schedules(schedule_id=schedule_id))
    if not maybe_schedule:
        raise HTTPException(status_code=404, detail=f"Schedule {schedule_id} not found in the database.")

    return GetScheduleResponse.from_db(maybe_schedule[0])


@router.get("/{schedule_id}/runs")
async def get_schedule_runs(
    schedule_id: ScheduleId,
    user: UserRead = Depends(current_active_user),
    since_dt: dt.datetime | None = None,
    before_dt: dt.datetime | None = None,
    status: STATUS | None = None,
    page: int = 1,
    page_size: int = 10,
) -> GetScheduleRunsResponse:
    """Get all runs for a given schedule with pagination and filtering."""

    if page < 1 or page_size < 1:
        raise HTTPException(status_code=400, detail="Page and page_size must be greater than 0.")

    total_runs = await select_runs_count(schedule_id=schedule_id, since_dt=since_dt, before_dt=before_dt, status=status)
    start = (page - 1) * page_size
    total_pages = (total_runs + page_size - 1) // page_size if total_runs > 0 else 0

    if start >= total_runs and total_runs > 0:
        raise HTTPException(status_code=404, detail="Page number out of range.")

    runs = await select_runs(
        schedule_id=schedule_id,
        since_dt=since_dt,
        before_dt=before_dt,
        status=status,
        offset=start,
        limit=page_size,
    )
    runs_iter = (GetScheduleRunResponse.from_db(r) for r in runs)
    runs_dict = {r.schedule_run_id: r for r in runs_iter}

    return GetScheduleRunsResponse(
        runs=runs_dict,
        total=total_runs,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        error=None,
    )


@router.get("/{schedule_id}/next_run")
async def get_next_schedule_run(schedule_id: ScheduleId, user: UserRead = Depends(current_active_user)) -> str:
    next_run_at = await get_next_run(schedule_id)
    if next_run_at is None:
        return "not scheduled currently"
    return str(next_run_at)


@router.get("/")
async def get_multiple_schedules(
    enabled: bool | None = None,
    created_by: str | None = None,
    created_at_start: dt.datetime | None = None,
    created_at_end: dt.datetime | None = None,
    user: UserRead = Depends(current_active_user),
    page: int = 1,
    page_size: int = 10,
) -> GetMultipleSchedulesResponse:
    """Get multiple schedules with pagination and filtering."""

    if page < 1 or page_size < 1:
        raise HTTPException(status_code=400, detail="Page and page_size must be greater than 0.")

    total_schedules = await get_schedules_count(
        enabled=enabled,
        created_by=created_by,
        created_at_start=created_at_start,
        created_at_end=created_at_end,
    )
    start = (page - 1) * page_size
    total_pages = (total_schedules + page_size - 1) // page_size if total_schedules > 0 else 0

    if start >= total_schedules and total_schedules > 0:
        raise HTTPException(status_code=404, detail="Page number out of range.")

    schedules = await get_schedules(
        enabled=enabled,
        created_by=created_by,
        created_at_start=created_at_start,
        created_at_end=created_at_end,
        offset=start,
        limit=page_size,
    )
    schedules_list = [GetScheduleResponse.from_db(s) for s in schedules]
    schedules_dict = {s.schedule_id: s for s in schedules_list}
    return GetMultipleSchedulesResponse(
        schedules=schedules_dict,
        total=total_schedules,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        error=None,
    )


@router.put("/create")
async def create_schedule(
    schedule_spec: ScheduleSpecification, user: UserRead | None = Depends(current_active_user)
) -> CreateScheduleResponse:
    try:
        parse_crontab(schedule_spec.cron_expr)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid crontab: {schedule_spec.cron_expr} => {e}")
    schedule_id = str(uuid.uuid4())  # TODO gen from db instead

    schedule_data = schedule2db(schedule_spec)
    await insert_one(
        schedule_id,
        user.email if user is not None else None,
        schedule_data["exec_spec"],
        schedule_data["dynamic_expr"],
        schedule_data["cron_expr"],
        schedule_data["max_acceptable_delay_hours"],
    )
    next_run_at = calculate_next_run(dt.datetime.now(), schedule_spec.cron_expr)
    await insert_next_run(schedule_id, next_run_at)
    logger.debug(f"Next run of {schedule_id} is at {next_run_at}")
    prod_scheduler()
    return CreateScheduleResponse(schedule_id)


@router.post("/{schedule_id}")
async def update_schedule(
    schedule_id: ScheduleId, schedule_update: ScheduleUpdate, user: UserRead = Depends(current_active_user)
) -> GetScheduleResponse:
    kwargs = schedule2db(schedule_update)

    with scheduler_lock:  # NOTE this may block the async pool a bit!
        updated_schedule = await update_one(schedule_id=schedule_id, **kwargs)
        if not updated_schedule:
            raise HTTPException(status_code=404, detail=f"Schedule {schedule_id} not found in the database.")

        if "cron_expr" in kwargs or "enabled" in kwargs:
            await regenerate_schedule_next(
                cast(str, updated_schedule.schedule_id),
                cast(str, updated_schedule.cron_expr),
                cast(bool, updated_schedule.enabled),
            )

    prod_scheduler()

    return GetScheduleResponse.from_db(updated_schedule)


@router.post("/run/{schedule_run_id}")
async def rerun_schedule(schedule_run_id: str, user: UserRead = Depends(current_active_user)) -> str:
    """Returns the schedule_run_id of the re-run"""
    runnable_schedule_either = await run2runnable(schedule_run_id)
    if runnable_schedule_either.t is None:
        raise HTTPException(status_code=404, detail=f"Failed to re-run {schedule_run_id} because of {runnable_schedule_either.e}")
    runnable_schedule = runnable_schedule_either.t

    exec_result = await execute(runnable_schedule.exec_spec, user.user_id)  # type: ignore[unresolved-attribute] # user_id
    if exec_result.t is not None:
        logger.debug(f"Job {exec_result.t.id} submitted for schedule run {schedule_run_id}")
        return await insert_schedule_run(
            runnable_schedule.schedule_id,
            runnable_schedule.schedule_at,
            exec_result.t.id,
            attempt_cnt=runnable_schedule.attempt_cnt,
            trigger="rerun",
        )
    else:
        logger.error(f"Failed to submit job for schedule run {schedule_run_id} because of {exec_result.e}")
        raise HTTPException(status_code=500, detail=f"Failed to rerun schedule: {exec_result.e}")


@router.post("/restart")
async def restart_scheduler() -> None:
    stop_scheduler()
    start_scheduler()
