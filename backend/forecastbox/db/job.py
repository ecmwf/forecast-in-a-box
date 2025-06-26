from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
import logging
from forecastbox.schemas.job import Base, JobRecord
from forecastbox.config import config
from cascade.controller.report import JobId
from sqlalchemy import select, update, func, delete
import datetime as dt
from typing import Iterable

logger = logging.getLogger(__name__)

async_url = f"sqlite+aiosqlite:///{config.db.sqlite_jobdb_path}"
async_engine = create_async_engine(async_url)
async_session_maker = async_sessionmaker(async_engine, expire_on_commit=False)


async def create_db_and_tables():
    async with async_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def insert_one(job_id: JobId, error: str | None, user_id: str | None, graph_spec: str, outputs: str) -> None:
    async with async_session_maker() as session:
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
        session.add(entity)
        await session.commit()


async def get_one(job_id: JobId) -> JobRecord | None:
    async with async_session_maker() as session:
        query = select(JobRecord).where(JobRecord.job_id == job_id)
        result = await session.execute(query)
        maybe_row = result.first()
        return maybe_row if maybe_row is None else maybe_row[0]


async def get_all() -> Iterable[JobRecord]:
    async with async_session_maker() as session:
        query = select(JobRecord)
        result = await session.execute(query)
        return (e[0] for e in result.all())


async def update_one(job_id: JobId, **kwargs) -> None:
    async with async_session_maker() as session:
        ref_time = dt.datetime.now()
        stmt = update(JobRecord).where(JobRecord.job_id == job_id).values(updated_at=ref_time, **kwargs)
        await session.execute(stmt)
        await session.commit()


async def delete_all() -> None:
    async with async_session_maker() as session:
        query = select(func.count("*")).select_from(JobRecord)
        user_count = (await session.execute(query)).scalar()
        stmt = delete(JobRecord)
        await session.execute(stmt)
        await session.commit()
        return user_count


async def delete_one(job_id: JobId) -> None:
    async with async_session_maker() as session:
        where = JobRecord.job_id == job_id
        query = select(func.count("*")).select_from(JobRecord).where(where)
        user_count = (await session.execute(query)).scalar()
        stmt = delete(JobRecord).where(where)
        await session.execute(stmt)
        await session.commit()
        return user_count
