# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Canonical experiment entity routes — /experiment/*

Covers cron-schedule experiments and their operational controls.
"""

PREFIX = "/api/v1/experiment"
PREFIX = "/api/v1/experiment"
import datetime as dt
import logging
from typing import Annotated, cast

from fastapi import APIRouter, Depends
from fastapi.exceptions import HTTPException
from pydantic import BaseModel, PositiveInt

import forecastbox.domain.experiment.service as experiment_service
from forecastbox.api.scheduling.scheduler_thread import start_scheduler, stop_scheduler
from forecastbox.domain.experiment.exceptions import ExperimentAccessDenied, ExperimentNotFound, ExperimentVersionConflict, SchedulerBusy
from forecastbox.domain.experiment.scheduling.dt_utils import current_scheduling_time
from forecastbox.entrypoint.auth.users import get_auth_context
from forecastbox.schemas.jobs import ExperimentDefinition
from forecastbox.utility.auth import AuthContext
from forecastbox.utility.pagination import PaginationSpec

logger = logging.getLogger(__name__)

router = APIRouter(
    tags=["experiment"],
    responses={404: {"description": "Not found"}},
)


# ---------------------------------------------------------------------------
# Route-local contracts
# ---------------------------------------------------------------------------


class ExperimentId(BaseModel):
    """Identifies an experiment, optionally pinning a specific version.

    Used as a Depends()-based query-param group on GET endpoints, and as a
    request body field on endpoints that address a specific experiment version.
    """

    experiment_id: str
    version: int | None = None


class ExperimentCreateRequest(BaseModel):
    job_definition_id: str
    job_definition_version: int | None = None
    cron_expr: str
    dynamic_expr: dict[str, str] = {}
    max_acceptable_delay_hours: PositiveInt = 24
    first_run_override: dt.datetime | None = None
    display_name: str | None = None
    display_description: str | None = None
    tags: list[str] | None = None


class ExperimentCreateResponse(BaseModel):
    experiment_id: str


class ExperimentDetail(BaseModel):
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


class ExperimentListResponse(BaseModel):
    experiments: list[ExperimentDetail]
    total: int
    page: int
    page_size: int
    total_pages: int


class ExperimentUpdateRequest(BaseModel):
    """Update a cron-schedule experiment. ``version`` must match the current version."""

    experiment_id: str
    version: int
    cron_expr: str | None = None
    enabled: bool | None = None
    dynamic_expr: dict[str, str] | None = None
    max_acceptable_delay_hours: PositiveInt | None = None
    first_run_override: dt.datetime | None = None


class ExperimentDeleteRequest(BaseModel):
    """Soft-delete an experiment. ``version`` must match the current version."""

    experiment_id: str
    version: int


class ExperimentRunDetail(BaseModel):
    execution_id: str
    attempt_count: int
    status: str
    created_at: str
    updated_at: str
    experiment_context: str | None


class ExperimentRunsResponse(BaseModel):
    runs: list[ExperimentRunDetail]
    total: int
    page: int
    page_size: int
    total_pages: int


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _experiment_to_detail(exp: ExperimentDefinition) -> ExperimentDetail:
    exp_def = cast(dict, exp.experiment_definition) or {}
    return ExperimentDetail(
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
# Experiment CRUD endpoints
# ---------------------------------------------------------------------------


@router.put("/create")
async def create_experiment(
    request: ExperimentCreateRequest,
    auth_context: AuthContext = Depends(get_auth_context),
) -> ExperimentCreateResponse:
    """Create a new cron-schedule experiment."""
    try:
        experiment_id = await experiment_service.create_schedule(
            auth_context=auth_context,
            job_definition_id=request.job_definition_id,
            job_definition_version=request.job_definition_version,
            cron_expr=request.cron_expr,
            dynamic_expr=request.dynamic_expr,
            max_acceptable_delay_hours=request.max_acceptable_delay_hours,
            first_run_override=request.first_run_override,
            display_name=request.display_name,
            display_description=request.display_description,
            tags=request.tags,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ExperimentNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ExperimentAccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))
    return ExperimentCreateResponse(experiment_id=experiment_id)


@router.get("/get")
async def get_experiment(
    spec: Annotated[ExperimentId, Depends()],
    auth_context: AuthContext = Depends(get_auth_context),
) -> ExperimentDetail:
    """Retrieve a single experiment by id."""
    try:
        exp = await experiment_service.get_schedule(auth_context, spec.experiment_id)
    except ExperimentNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    return _experiment_to_detail(exp)


@router.get("/list")
async def list_experiments(
    pagination: Annotated[PaginationSpec, Depends()],
    auth_context: AuthContext = Depends(get_auth_context),
) -> ExperimentListResponse:
    """List experiments visible to the caller, with pagination."""
    try:
        experiments, total, total_pages = await experiment_service.list_schedules(auth_context, pagination)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    items = [_experiment_to_detail(exp) for exp in experiments]
    return ExperimentListResponse(
        experiments=items, total=total, page=pagination.page, page_size=pagination.page_size, total_pages=total_pages
    )


@router.post("/update")
async def update_experiment(
    update: ExperimentUpdateRequest,
    auth_context: AuthContext = Depends(get_auth_context),
) -> ExperimentDetail:
    """Update a cron-schedule experiment. All schedule fields are optional.

    ``version`` must match the current experiment version; returns 409 if it does not.
    """
    try:
        current = await experiment_service.get_schedule(auth_context, update.experiment_id)
    except ExperimentNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    if cast(int, current.version) != update.version:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Version conflict for experiment {update.experiment_id!r}: "
                f"expected version {update.version}, current is {current.version}."
            ),
        )
    try:
        updated = await experiment_service.update_schedule(
            auth_context=auth_context,
            experiment_id=update.experiment_id,
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
    except ExperimentVersionConflict as e:
        raise HTTPException(status_code=409, detail=str(e))
    return _experiment_to_detail(updated)


@router.post("/delete")
async def delete_experiment(
    request: ExperimentDeleteRequest,
    auth_context: AuthContext = Depends(get_auth_context),
) -> None:
    """Soft-delete an experiment and clear its next scheduled run.

    ``version`` must match the current experiment version; returns 409 if it does not.
    """
    try:
        current = await experiment_service.get_schedule(auth_context, request.experiment_id)
    except ExperimentNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    if cast(int, current.version) != request.version:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Version conflict for experiment {request.experiment_id!r}: "
                f"expected version {request.version}, current is {current.version}."
            ),
        )
    try:
        await experiment_service.delete_schedule(auth_context, request.experiment_id)
    except SchedulerBusy as e:
        raise HTTPException(status_code=503, detail=str(e))
    except ExperimentNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ExperimentAccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))


# ---------------------------------------------------------------------------
# Experiment runs endpoints
# ---------------------------------------------------------------------------


@router.get("/runs/list")
async def list_experiment_runs(
    spec: Annotated[ExperimentId, Depends()],
    pagination: Annotated[PaginationSpec, Depends()],
    auth_context: AuthContext = Depends(get_auth_context),
) -> ExperimentRunsResponse:
    """Return paginated execution rows linked to a cron-schedule experiment."""
    try:
        executions, total, total_pages = await experiment_service.get_schedule_runs(auth_context, spec.experiment_id, pagination)
    except ExperimentNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    runs = [
        ExperimentRunDetail(
            execution_id=str(ex.job_execution_id),  # ty:ignore[invalid-argument-type]
            attempt_count=cast(int, ex.attempt_count),
            status=cast(str, ex.status),
            created_at=str(ex.created_at),
            updated_at=str(ex.updated_at),
            experiment_context=cast(str | None, ex.experiment_context),
        )
        for ex in executions
    ]
    return ExperimentRunsResponse(runs=runs, total=total, page=pagination.page, page_size=pagination.page_size, total_pages=total_pages)


@router.get("/runs/next")
async def get_next_experiment_run(
    spec: Annotated[ExperimentId, Depends()],
    auth_context: AuthContext = Depends(get_auth_context),
) -> str:
    """Return the next scheduled run time, or 'not scheduled currently'."""
    try:
        return await experiment_service.get_next_run(auth_context, spec.experiment_id)
    except ExperimentNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))


# ---------------------------------------------------------------------------
# Operational / scheduler endpoints
# ---------------------------------------------------------------------------


@router.get("/operational/scheduler/current_time")
async def get_scheduler_current_time() -> str:
    """Return the current time used for scheduling decisions (ISO 8601)."""
    return current_scheduling_time().isoformat()


@router.post("/operational/scheduler/restart")
async def restart_scheduler(auth_context: AuthContext = Depends(get_auth_context)) -> None:
    """Restart the scheduler thread. Requires admin access."""
    if not auth_context.has_admin():
        raise HTTPException(status_code=403, detail="Only admins may restart the scheduler.")
    stop_scheduler()
    start_scheduler()
