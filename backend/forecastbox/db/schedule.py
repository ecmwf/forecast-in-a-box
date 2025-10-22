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
from typing import Iterable

from forecastbox.config import config
from forecastbox.db.core import addAndCommit, dbRetry, executeAndCommit
from forecastbox.schemas.schedule import Base, ScheduleDefinition, ScheduleNext, ScheduleRun
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

logger = logging.getLogger(__name__)

async_url = f"sqlite+aiosqlite:///{config.db.sqlite_jobdb_path}"
async_engine = create_async_engine(async_url, pool_pre_ping=True)
async_session_maker = async_sessionmaker(async_engine, expire_on_commit=False)

ScheduleId = str

async def create_db_and_tables():
    async with async_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

def _build_schedules_query(
    schedule_id: ScheduleId|None = None,
    enabled: bool | None = None,
    created_by: str | None = None,
    created_at_start: dt.datetime | None = None,
    created_at_end: dt.datetime | None = None,
):
    query = select(ScheduleDefinition)
    if schedule_id is not None:
        query = query.where(ScheduleDefinition.schedule_id == schedule_id)
    if enabled is not None:
        query = query.where(ScheduleDefinition.enabled == enabled)
    if created_by is not None:
        query = query.where(ScheduleDefinition.created_by == created_by)
    if created_at_start is not None:
        query = query.where(ScheduleDefinition.created_at >= created_at_start)
    if created_at_end is not None:
        query = query.where(ScheduleDefinition.created_at <= created_at_end)
    return query

async def get_schedules(
    schedule_id: ScheduleId|None = None,
    enabled: bool | None = None,
    created_by: str | None = None,
    created_at_start: dt.datetime | None = None,
    created_at_end: dt.datetime | None = None,
    offset: int = -1,
    limit: int = -1
) -> Iterable[ScheduleDefinition]:
    async def function(i: int) -> Iterable[ScheduleDefinition]:
        async with async_session_maker() as session:
            query = _build_schedules_query(
                schedule_id=schedule_id,
                enabled=enabled,
                created_by=created_by,
                created_at_start=created_at_start,
                created_at_end=created_at_end,
            )
            if offset != -1:
                query = query.offset(offset)
            if limit != -1:
                query = query.limit(limit)
            result = await session.execute(query)
            return (e[0] for e in result.all())

    return await dbRetry(function)

async def get_schedules_count(
    schedule_id: ScheduleId|None = None,
    enabled: bool | None = None,
    created_by: str | None = None,
    created_at_start: dt.datetime | None = None,
    created_at_end: dt.datetime | None = None,
) -> int:
    async def function(i: int) -> int:
        async with async_session_maker() as session:
            query = _build_schedules_query(
                schedule_id=schedule_id,
                enabled=enabled,
                created_by=created_by,
                created_at_start=created_at_start,
                created_at_end=created_at_end,
            )
            result = await session.execute(select(func.count()).select_from(query.subquery()))
            return result.scalar_one()

    return await dbRetry(function)

async def insert_one(schedule_id: ScheduleId, user_email: str | None, exec_spec: str, dynamic_expr: str, cron_expr: str|None, max_acceptable_delay_hours: int) -> None:
    ref_time = dt.datetime.now()
    entity = ScheduleDefinition(
        schedule_id = schedule_id,
        cron_expr = cron_expr,
        created_at = ref_time,
        updated_at = ref_time,
        exec_spec = exec_spec,
        dynamic_expr = dynamic_expr,
        enabled = True,
        created_by = user_email,
        max_acceptable_delay_hours = max_acceptable_delay_hours,
    )
    await addAndCommit(entity, async_session_maker)


async def update_one(schedule_id: ScheduleId, **kwargs) -> ScheduleDefinition|None:
    ref_time = dt.datetime.now()
    stmt = update(ScheduleDefinition).where(ScheduleDefinition.schedule_id == schedule_id).values(updated_at=ref_time, **kwargs)
    await executeAndCommit(stmt, async_session_maker)

    # NOTE it would be neater to run this in a single db session but it seems sqlite doesnt support that
    schedules = list(await get_schedules(schedule_id=schedule_id))
    if not schedules:
        return None
    else:
        return schedules[0]

async def insert_next_run(schedule_id: ScheduleId, at: dt.datetime) -> None:
    entity = ScheduleNext(
        schedule_next_id = str(uuid.uuid4()),
        schedule_id = schedule_id,
        scheduled_at = at,
    )
    await addAndCommit(entity, async_session_maker)

async def insert_schedule_run(schedule_id: ScheduleId, scheduled_at: dt.datetime, job_id: str|None = None, attempt_cnt: int = 0, trigger: str = "cron") -> None:
    entity = ScheduleRun(
        schedule_run_id = str(uuid.uuid4()),
        schedule_id = schedule_id,
        job_id = job_id,
        attempt_cnt = attempt_cnt,
        scheduled_at = scheduled_at,
        trigger = trigger,
    )
    await addAndCommit(entity, async_session_maker)

async def get_schedulable(now: dt.datetime) -> Iterable[ScheduleNext]:
    async def function(i: int) -> Iterable[ScheduleNext]:
        async with async_session_maker() as session:
            query = select(ScheduleNext).where(ScheduleNext.scheduled_at <= now)
            result = await session.execute(query)
            return list(e[0] for e in result.all())

    return await dbRetry(function)

async def mark_run_executed(next_run_id: str) -> None:
    async def function(i: int) -> None:
        async with async_session_maker() as session:
            stmt = delete(ScheduleNext).where(ScheduleNext.schedule_next_id == next_run_id)
            await session.execute(stmt)
            await session.commit()

    await dbRetry(function)

async def delete_schedule_next_run(schedule_id: ScheduleId) -> None:
    async def function(i: int) -> None:
        async with async_session_maker() as session:
            stmt = delete(ScheduleNext).where(ScheduleNext.schedule_id == schedule_id)
            await session.execute(stmt)
            await session.commit()

    await dbRetry(function)

async def next_schedulable() -> dt.datetime | None:
    async def function(i: int) -> dt.datetime | None:
        async with async_session_maker() as session:
            query = select(func.min(ScheduleNext.scheduled_at))
            result = await session.execute(query)
            return result.scalar_one_or_none()

    return await dbRetry(function)
