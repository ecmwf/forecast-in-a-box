"""
Contains db functions for model_edits and model_downloads tables

Note that those reside in the jobdb as well -- there is no modeldb
"""

# NOTE consider rewrite of this to a *dictionary*, there seems no need for persistence

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy import select, update, delete
import datetime as dt
import logging
from forecastbox.schemas.model import Base, ModelDownload, ModelEdit
from forecastbox.config import config
from forecastbox.db.core import executeAndCommit, querySingle, addAndCommit

logger = logging.getLogger(__name__)

async_url = f"sqlite+aiosqlite:///{config.db.sqlite_jobdb_path}"
async_engine = create_async_engine(async_url, pool_pre_ping=True)
async_session_maker = async_sessionmaker(async_engine, expire_on_commit=False)


async def create_db_and_tables():
    async with async_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def update_progress(model_id: str, progress: int, error: str | None):
    ref_time = dt.datetime.now()
    query = ModelDownload.model_id == model_id
    stmt = update(ModelDownload).where(query).values(updated_at=ref_time, progress=progress, error=error)
    await executeAndCommit(stmt, async_session_maker)


async def get_download(model_id: str) -> ModelDownload | None:
    query = select(ModelDownload).where(ModelDownload.model_id == model_id)
    return await querySingle(query, async_session_maker)


async def start_download(model_id: str) -> None:
    ref_time = dt.datetime.now()
    entity = ModelDownload(
        model_id=model_id,
        progress=0,
        created_at=ref_time,
        updated_at=ref_time,
        error=None,
    )
    await addAndCommit(entity, async_session_maker)


async def delete_download(model_id: str) -> None:
    where = ModelDownload.model_id == model_id
    stmt = delete(ModelDownload).where(where)
    await executeAndCommit(stmt, async_session_maker)


async def start_editing(model_id: str, metadata: str) -> None:
    ref_time = dt.datetime.now()
    entity = ModelEdit(
        model_id=model_id,
        created_at=ref_time,
        metadata=metadata,
    )
    await addAndCommit(entity, async_session_maker)


async def get_edit(model_id: str) -> ModelEdit | None:
    query = select(ModelEdit).where(ModelEdit.model_id == model_id)
    return await querySingle(query, async_session_maker)


async def finish_edit(model_id: str) -> None:
    where = ModelEdit.model_id == model_id
    stmt = delete(ModelEdit).where(where)
    await executeAndCommit(stmt, async_session_maker)
