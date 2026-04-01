# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""ORM models and database setup for the user/auth database.

Exposes ``create_db_and_tables`` so the entrypoint can discover and run it
via automatic schemata iteration.
"""

from collections.abc import AsyncGenerator

import pydantic
from fastapi import Depends
from fastapi_users import schemas
from fastapi_users.db import SQLAlchemyBaseOAuthAccountTableUUID, SQLAlchemyBaseUserTableUUID, SQLAlchemyUserDatabase
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, relationship

from forecastbox.utility.config import config


class UserRead(schemas.BaseUser[pydantic.UUID4]):
    pass


class UserCreate(schemas.BaseUserCreate):
    pass


class UserUpdate(schemas.BaseUserUpdate):
    pass


class Base(DeclarativeBase):
    pass


class OAuthAccount(SQLAlchemyBaseOAuthAccountTableUUID, Base):
    pass


# NOTE its a bit unfortunate we have a separate UserTable and UserRead objects, as
# they effectively represent the same entity and are used interchangeably. Couldnt
# ideate how to get rid of that due to different hierarchies etc


class UserTable(SQLAlchemyBaseUserTableUUID, Base):
    oauth_accounts: Mapped[list[OAuthAccount]] = relationship("OAuthAccount", lazy="joined")


async_url = f"sqlite+aiosqlite:///{config.db.sqlite_userdb_path}"
sync_url = f"sqlite:///{config.db.sqlite_userdb_path}"

async_engine = create_async_engine(async_url)
async_session_maker = async_sessionmaker(async_engine, expire_on_commit=False)
sync_engine = create_engine(sync_url)


async def create_db_and_tables():
    async with async_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_async_session() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_maker() as session:
        yield session


async def get_user_db(session: AsyncSession = Depends(get_async_session)):
    yield SQLAlchemyUserDatabase(session, UserTable, OAuthAccount)
