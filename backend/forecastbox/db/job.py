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
from collections.abc import Iterable

from cascade.controller.report import JobId
from forecastbox.config import config
from forecastbox.db.core import addAndCommit, dbRetry, executeAndCommit, queryCount, querySingle
from forecastbox.schemas.job import Base, JobRecord
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

logger = logging.getLogger(__name__)

async_url = f"sqlite+aiosqlite:///{config.db.sqlite_jobdb_path}"
async_engine = create_async_engine(async_url, pool_pre_ping=True)
async_session_maker = async_sessionmaker(async_engine, expire_on_commit=False)


async def create_db_and_tables():
    async with async_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def insert_one(job_id: JobId, error: str | None, user_id: str | None, graph_spec: str, outputs: str) -> None:
    ref_time = dt.datetime.now()
    entity = JobRecord(
        job_id=job_id,
        status="submitted" if not error else "failed",
        created_at=ref_time,
        updated_at=ref_time,
        created_by=user_id,
        graph_specification=graph_spec,
        outputs=outputs,
        error=error,
    )
    await addAndCommit(entity, async_session_maker)


async def get_one(job_id: JobId) -> JobRecord | None:
    query = select(JobRecord).where(JobRecord.job_id == job_id)
    return await querySingle(query, async_session_maker)

async def get_count(status: str | None = None) -> int:
    async def function(i: int) -> int:
        async with async_session_maker() as session:
            query = select(func.count("*")).select_from(JobRecord)
            if status is not None:
                query = query.where(JobRecord.status == status)
            return await queryCount(query, session)
    return await dbRetry(function)

async def get_all(status: str|None = None, offset: int = -1, limit: int = -1) -> Iterable[JobRecord]:
    async def function(i: int) -> Iterable[JobRecord]:
        async with async_session_maker() as session:
            query = select(JobRecord)
            if status is not None:
                query = query.where(JobRecord.status == status)
            if offset != -1:
                query = query.offset(offset)
            if limit != -1:
                query = query.limit(limit)
            result = await session.execute(query)
            return (e[0] for e in result.all())

    return await dbRetry(function)


async def update_one(job_id: JobId, **kwargs) -> None:
    ref_time = dt.datetime.now()
    stmt = update(JobRecord).where(JobRecord.job_id == job_id).values(updated_at=ref_time, **kwargs)
    await executeAndCommit(stmt, async_session_maker)

async def delete_all() -> int:
    async def function(i: int) -> int:
        async with async_session_maker() as session:
            query = select(func.count("*")).select_from(JobRecord)
            user_count = await queryCount(query, session)
            stmt = delete(JobRecord)
            await session.execute(stmt)
            await session.commit()
            return user_count

    return await dbRetry(function)


async def delete_one(job_id: JobId) -> int:
    async def function(i: int) -> int:
        async with async_session_maker() as session:
            where = JobRecord.job_id == job_id
            query = select(func.count("*")).select_from(JobRecord).where(where)
            user_count = await queryCount(query, session)
            stmt = delete(JobRecord).where(where)
            await session.execute(stmt)
            await session.commit()
            return user_count

    return await dbRetry(function)
