import datetime as dt
import logging
from collections.abc import Iterable

from cascade.controller.report import JobId
from forecastbox.config import config
from forecastbox.db.core import addAndCommit, dbRetry, executeAndCommit, querySingle
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
        # NOTE we insert with running instead of submitted due to linearization of submit-insert
        status="running" if not error else "failed",
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


async def get_all() -> Iterable[JobRecord]:
    async def function(i: int) -> Iterable[JobRecord]:
        async with async_session_maker() as session:
            query = select(JobRecord)
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
            user_count = (await session.execute(query)).scalar()
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
            user_count = (await session.execute(query)).scalar()
            stmt = delete(JobRecord).where(where)
            await session.execute(stmt)
            await session.commit()
            return user_count

    return await dbRetry(function)
