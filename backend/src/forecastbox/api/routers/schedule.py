# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import logging
from dataclasses import dataclass
from typing import cast

from fastapi import APIRouter, Depends, HTTPException

import forecastbox.domain.experiment.service as experiment_service
from forecastbox.api.scheduling.scheduler_thread import start_scheduler, stop_scheduler
from forecastbox.api.types.scheduling import ScheduleSpecification, ScheduleUpdate
from forecastbox.domain.experiment.exceptions import (
    ExperimentAccessDenied,
    ExperimentNotFound,
    SchedulerBusy,
)
from forecastbox.domain.experiment.scheduling.dt_utils import current_scheduling_time
from forecastbox.entrypoint.auth.users import current_active_user
from forecastbox.schemas.jobs import ExperimentDefinition
from forecastbox.schemas.user import UserRead
from forecastbox.utility.auth import user2auth

logger = logging.getLogger(__name__)

router = APIRouter(
    tags=["schedule"],
    responses={404: {"description": "Not found"}},
)


# ---------------------------------------------------------------------------
# Response types
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


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/list")
async def list_schedules(
    user: UserRead | None = Depends(current_active_user),
    page: int = 1,
    page_size: int = 10,
) -> ListSchedulesResponse:
    actor = user2auth(user)
    try:
        experiments, total, total_pages = await experiment_service.list_schedules(actor, page, page_size)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    schedules = [_experiment_to_response(exp) for exp in experiments]
    return ListSchedulesResponse(schedules=schedules, total=total, page=page, page_size=page_size, total_pages=total_pages)


@router.put("/create")
async def create_schedule(
    schedule_spec: ScheduleSpecification, user: UserRead | None = Depends(current_active_user)
) -> CreateScheduleResponse:
    actor = user2auth(user)
    try:
        experiment_id = await experiment_service.create_schedule(
            actor=actor,
            job_definition_id=schedule_spec.job_definition_id,
            job_definition_version=schedule_spec.job_definition_version,
            cron_expr=schedule_spec.cron_expr,
            dynamic_expr=schedule_spec.dynamic_expr,
            max_acceptable_delay_hours=schedule_spec.max_acceptable_delay_hours,
            first_run_override=schedule_spec.first_run_override,
            display_name=schedule_spec.display_name,
            display_description=schedule_spec.display_description,
            tags=schedule_spec.tags,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ExperimentNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ExperimentAccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))
    return CreateScheduleResponse(experiment_id=experiment_id)


@router.get("/get")
async def get_schedule(experiment_id: str, user: UserRead | None = Depends(current_active_user)) -> ScheduleDefinitionResponse:
    actor = user2auth(user)
    try:
        exp_def = await experiment_service.get_schedule(actor, experiment_id)
    except ExperimentNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    return _experiment_to_response(exp_def)


@router.post("/update")
async def update_schedule(
    experiment_id: str, update: ScheduleUpdate, user: UserRead | None = Depends(current_active_user)
) -> ScheduleDefinitionResponse:
    actor = user2auth(user)
    try:
        updated = await experiment_service.update_schedule(
            actor=actor,
            experiment_id=experiment_id,
            cron_expr=update.cron_expr,
            enabled=update.enabled,
            dynamic_expr=update.dynamic_expr,
            max_acceptable_delay_hours=update.max_acceptable_delay_hours,
            first_run_override=update.first_run_override,
        )
    except SchedulerBusy as e:
        raise HTTPException(status_code=503, detail=str(e))
    except ExperimentNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ExperimentAccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _experiment_to_response(updated)


@router.post("/delete")
async def delete_schedule(experiment_id: str, user: UserRead | None = Depends(current_active_user)) -> None:
    actor = user2auth(user)
    try:
        await experiment_service.delete_schedule(actor, experiment_id)
    except SchedulerBusy as e:
        raise HTTPException(status_code=503, detail=str(e))
    except ExperimentNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ExperimentAccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))


@router.get("/next_run")
async def get_next_run(experiment_id: str, user: UserRead | None = Depends(current_active_user)) -> str:
    actor = user2auth(user)
    try:
        return await experiment_service.get_next_run(actor, experiment_id)
    except ExperimentNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/runs")
async def get_schedule_runs(
    experiment_id: str,
    user: UserRead | None = Depends(current_active_user),
    page: int = 1,
    page_size: int = 10,
) -> ScheduleRunsResponse:
    """Return paginated JobExecution rows linked to a cron schedule experiment."""
    actor = user2auth(user)
    try:
        executions, total, total_pages = await experiment_service.get_schedule_runs(actor, experiment_id, page, page_size)
    except ExperimentNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

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
async def get_current_scheduling_time(user: UserRead | None = Depends(current_active_user)) -> str:
    """Return the current time used for scheduling decisions."""
    return current_scheduling_time().isoformat()


@router.post("/restart")
async def restart_scheduler(user: UserRead | None = Depends(current_active_user)) -> None:
    """Restart the scheduler thread. Requires authentication."""
    actor = user2auth(user)
    if not actor.has_admin():
        raise HTTPException(status_code=403, detail="Only admins may restart the scheduler.")
    stop_scheduler()
    start_scheduler()
