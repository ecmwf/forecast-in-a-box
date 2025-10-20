# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Scheduled jobs"""

import datetime as dt
import logging
import uuid
from dataclasses import dataclass

from fastapi import APIRouter, Depends, HTTPException
from forecastbox.api.scheduling.dt_utils import next_run, parse_crontab
from forecastbox.api.scheduling.scheduler_thread import prod_scheduler
from forecastbox.api.types import ScheduleSpecification, ScheduleUpdate, schedule2db
from forecastbox.auth.users import current_active_user
from forecastbox.db.schedule import (ScheduleId, get_schedules, get_schedules_count, insert_next_run, insert_one,
                                     update_one)
from forecastbox.schemas.schedule import ScheduleDefinition
from forecastbox.schemas.user import UserRead
from typing_extensions import Self

logger = logging.getLogger(__name__)

router = APIRouter(
    tags=["schedule"],
    responses={404: {"description": "Not found"}},
)

@dataclass
class GetScheduleResponse:
    """Get Schedule Response."""

    schedule_id: ScheduleId
    cron_expr: str|None
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
    created_by: str|None
    """Email of the user who created this schedule"""
    # TODO add next run?

    @classmethod
    def from_db(cls, entity: ScheduleDefinition) -> Self:
        return cls(
            schedule_id=entity.schedule_id,
            cron_expr=entity.cron_expr,
            created_at=str(entity.created_at),
            updated_at=str(entity.updated_at),
            exec_spec=entity.exec_spec,
            dynamic_expr=entity.dynamic_expr,
            enabled=entity.enabled,
            created_by=entity.created_by,
        )

@dataclass
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

@dataclass
class CreateScheduleResponse:
    schedule_id: ScheduleId


@router.get("/{schedule_id}")
async def get_schedule(schedule_id: ScheduleId, user: UserRead = Depends(current_active_user)) -> GetScheduleResponse:
    maybe_schedule = list(await get_schedules(schedule_id = schedule_id))
    if not maybe_schedule:
        raise HTTPException(status_code=404, detail=f"Schedule {schedule_id} not found in the database.")

    return GetScheduleResponse.from_db(maybe_schedule[0])

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
async def create_schedule(schedule_spec: ScheduleSpecification, user: UserRead | None = Depends(current_active_user)) -> CreateScheduleResponse:
    try:
        parse_crontab(schedule_spec.cron_expr)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid crontab: {schedule_spec.cron_expr} => {e}")
    schedule_id = str(uuid.uuid4()) # TODO gen from db instead

    schedule_data = schedule2db(schedule_spec)
    await insert_one(
        schedule_id,
        user.email if user is not None else None,
        schedule_data["exec_spec"],
        schedule_data["dynamic_expr"],
        schedule_data["cron_expr"],
    )
    next_run_at = next_run(dt.datetime.now(), schedule_spec.cron_expr)
    await insert_next_run(schedule_id, next_run_at)
    logger.debug(f"Next run of {schedule_id} is at {next_run_at}")
    prod_scheduler()
    return CreateScheduleResponse(schedule_id)

@router.post("/{schedule_id}")
async def update_schedule(
    schedule_id: ScheduleId,
    schedule_update: ScheduleUpdate,
    user: UserRead = Depends(current_active_user)
) -> GetScheduleResponse:
    kwargs = schedule2db(schedule_update)

    updated_schedule = await update_one(schedule_id = schedule_id, **kwargs)
    if not updated_schedule:
        raise HTTPException(status_code=404, detail=f"Schedule {schedule_id} not found in the database.")

    # TODO regenerate schedulenext if enabled/crontab were changed
    return GetScheduleResponse.from_db(updated_schedule)
