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

import orjson
from apscheduler.triggers.cron import CronTrigger
from fastapi import APIRouter, Depends, HTTPException
from forecastbox.api.types import ScheduleSpecification, ScheduleUpdate
from forecastbox.auth.users import current_active_user
from forecastbox.db.schedule import ScheduleId, get_schedules, insert_one, update_one
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
    user: UserRead = Depends(current_active_user)
) -> list[GetScheduleResponse]:
    schedules = await get_schedules(
        enabled=enabled,
        created_by=created_by,
        created_at_start=created_at_start,
        created_at_end=created_at_end,
    )
    return [GetScheduleResponse.from_db(s) for s in schedules]

@router.put("/create")
async def create_schedule(schedule_spec: ScheduleSpecification, user: UserRead | None = Depends(current_active_user)) -> CreateScheduleResponse:
    # TODO validate that the schedule is enabled, ie the scheduler is running
    try:
        CronTrigger.from_crontab(schedule_spec.cron_expr)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid crontab: {schedule_spec.cron_expr} => {e}")
    schedule_id = str(uuid.uuid4()) # TODO gen from db instead

    await insert_one(
        schedule_id,
        user.email if user is not None else None,
        schedule_spec.exec_spec.model_dump_json(),
        orjson.dumps(schedule_spec.dynamic_expr).decode('ascii'),
        schedule_spec.cron_expr,
    )
    # TODO register the schedule
    return CreateScheduleResponse(schedule_id)

@router.post("/{schedule_id}")
async def update_schedule(
    schedule_id: ScheduleId,
    schedule_update: ScheduleUpdate,
    user: UserRead = Depends(current_active_user)
) -> GetScheduleResponse:
    kwargs = {}
    if schedule_update.exec_spec is not None:
        kwargs['exec_spec'] = schedule_update.model_dump_json()
    if schedule_update.dynamic_expr is not None:
        kwargs['dynamic_expr'] = orjson.dumps(schedule_update.dynamic_expr).decode('ascii')
    if schedule_update.enabled is not None:
        kwargs['enabled'] = schedule_update.enabled
    if schedule_update.cron_expr is not None:
        kwargs['cron_expr'] = schedule_update.cron_expr

    updated_schedule = await update_one(schedule_id = schedule_id, **kwargs)
    if not updated_schedule:
        raise HTTPException(status_code=404, detail=f"Schedule {schedule_id} not found in the database.")

    return GetScheduleResponse.from_db(updated_schedule)
