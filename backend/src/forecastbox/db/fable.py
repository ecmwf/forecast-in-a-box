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
from typing import Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from forecastbox.api.types.fable import FableBuilderV1
from forecastbox.config import config
from forecastbox.db.core import addAndCommit, dbRetry, executeAndCommit, querySingle
from forecastbox.schemas.fable import Base, FableRecord

logger = logging.getLogger(__name__)

async_url = f"sqlite+aiosqlite:///{config.db.sqlite_jobdb_path}"
async_engine = create_async_engine(async_url, pool_pre_ping=True)
async_session_maker = async_sessionmaker(async_engine, expire_on_commit=False)


async def create_db_and_tables():
    async with async_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_fable_builder(fable_builder_id: str) -> Optional[FableBuilderV1]:
    query = select(FableRecord).where(FableRecord.fable_builder_id == fable_builder_id)
    record = await querySingle(query, async_session_maker)
    if record:  # type: ignore
        return FableBuilderV1.model_validate(record.fable_builder_v1)
    return None


async def upsert_fable_builder(
    builder: FableBuilderV1, fable_builder_id: Optional[str], tags: list[str], created_by_user: str | None
) -> str:
    ref_time = dt.datetime.now()
    returned_id: str

    if fable_builder_id:
        # Attempt to update an existing record
        query = select(FableRecord).where(FableRecord.fable_builder_id == fable_builder_id)
        existing_record = await querySingle(query, async_session_maker)

        if not existing_record:
            raise KeyError(f"FableBuilderV1 with ID {fable_builder_id} not found")

        if existing_record.created_by != created_by_user:
            raise PermissionError("User not authorized to modify this fable builder")

        stmt = (
            update(FableRecord)
            .where(FableRecord.fable_builder_id == fable_builder_id)
            .values(
                fable_builder_v1=builder.model_dump(mode="json"),
                updated_at=ref_time,
                tags=tags,
            )
        )
        await executeAndCommit(stmt, async_session_maker)
        returned_id = fable_builder_id
    else:
        # Insert a new record
        new_id = str(uuid.uuid4())
        entity = FableRecord(
            fable_builder_id=new_id,
            fable_builder_v1=builder.model_dump(mode="json"),
            created_at=ref_time,
            updated_at=ref_time,
            created_by=created_by_user,
            tags=tags,
        )
        await addAndCommit(entity, async_session_maker)
        returned_id = new_id
    return returned_id
