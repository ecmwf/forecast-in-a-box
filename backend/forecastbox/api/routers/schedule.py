# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Scheduled jobs"""

import logging
import uuid

from typing_extensions import Self
from fastapi import APIRouter, Body, Depends, HTTPException, Response, UploadFile
from forecastbox.db.schedule import get_schedules, get_runs, insert_one
from forecastbox.schemas.user import UserRead
from forecastbox.schemas.schedule import ScheduleDefinition, ScheduleRun
from forecastbox.auth.users import current_active_user

from apscheduler.triggers.cron import CronTrigger

logger = logging.getLogger(__name__)

router = APIRouter(
    tags=["schedule"],
    responses={404: {"description": "Not found"}},
)

@dataclass
class GetScheduleResponse:
    """Get Schedule Response."""

    cron_expr: str|None
    """Cron expression for the schedule. None if not time-triggered"""
    created_at: str
    """Creation timestamp of the schedule."""
    updated_at: str
    """Last update timestamp of the schedule."""
    job_spec: str
    """Specification of the product computed by the schedule, without the dynamic fields."""
    dynamic_expr: str
    """Dynamic expressions used by the schedule."""
    enabled: bool
    """Whether the schedule is currently enabled to run."""
    created_by: str|None
    """Email of the user who created this schedule"""

    @classmethod
    def from_db(cls, entity: ScheduleDefinition) -> Self:
        return cls(
            cron_expr=entity.cron_expr,
            created_at=str(entity.created_at),
            updated_at=str(entity.updated_at),
            job_spec=entity.job_spec,
            dynamic_expr=entity.dynamic_expr,
            enabled=entity.enabled,
            created_by=entity.created_by,
        )


@router.get("/{schedule_id}")
async def get_schedule(schedule_id: ScheduleId, user: UserRead = Depends(current_active_user)) -> GetScheduleResponse:
    maybe_schedule = list(get_schedules(schedule_id = schedule_id))
    if not maybe_schedule:
        raise HTTPException(status_code=404, detail=f"Schedule {schedule_id} not found in the database.")

    return GetScheduleResponse(maybe_schedule[0])

@router.put("/create")
async def create_timed_schedule(user: UserRead | None = Depends(current_active_user), graph_spec: ???, dynamic_expr: ???, cron_expr: str) -> ScheduleId:
    ! # TODO create models for request
    try:
        CronTrigger.from_crontab(cron_expr)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid crontab: {cron_expr} => {e}")
    schedule_id = str(uuid.uuid4()) # TODO gen from db

    await insert_one(
        schedule_id,
        user.email if user is not None else None,
        graph_spec.model_dump_json(),
        dynamic_expr.model_dump_json(),
        cron_expr,
    )
    return schedule_id
