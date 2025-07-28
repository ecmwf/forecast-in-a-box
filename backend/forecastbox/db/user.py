from collections.abc import AsyncGenerator

from fastapi import Depends
from fastapi_users.db import SQLAlchemyUserDatabase
from forecastbox.config import config
from forecastbox.schemas.user import Base
from forecastbox.schemas.user import OAuthAccount
from forecastbox.schemas.user import UserTable
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.ext.asyncio import async_sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine

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
