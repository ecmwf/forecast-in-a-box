# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Persistence layer for user management, guarded by a users-database-local lock.

All writes and reads go through the local ``db_retry`` helper so concurrent
access to the user SQLite file is serialized independently from jobs persistence.
"""

import asyncio
from collections.abc import Awaitable, Callable
from typing import TypeVar

import sqlalchemy.exc
from pydantic import UUID4
from sqlalchemy import delete, select, update

import forecastbox.schemata.user as _user_module
from forecastbox.schemata.user import UserTable

# TODO investigate the lock bypass -- not all db access locks, is that a bug or a feature?
retries = 3
db_lock = asyncio.Lock()
T = TypeVar("T")


async def db_retry(func: Callable[[int], Awaitable[T]]) -> T:
    for i in range(retries, -1, -1):
        try:
            async with db_lock:
                return await func(i)
        except sqlalchemy.exc.OperationalError:
            if i == 0:
                raise
            await asyncio.sleep(0.1)
    raise ValueError  # NOTE in case of retries misconfig, we dont want implicit None


async def list_users() -> list[UserTable]:
    """Return all registered users."""

    async def func(i: int) -> list[UserTable]:
        async with _user_module.async_session_maker() as session:
            query = select(UserTable)
            return (await session.execute(query)).unique().scalars().all()  # type: ignore[invalid-return-type] # NOTE db

    return await db_retry(func)


async def get_user_by_id(user_id: UUID4) -> UserTable | None:
    """Return a single user by UUID, or ``None`` if not found."""

    async def func(i: int) -> UserTable | None:
        async with _user_module.async_session_maker() as session:
            query = select(UserTable).where(UserTable.id == user_id)  # type: ignore[invalid-argument-type] # NOTE db
            users = (await session.execute(query)).unique().scalars().all()
            return users[0] if users else None

    return await db_retry(func)


async def delete_user_by_id(user_id: UUID4) -> None:
    """Delete a user by UUID."""

    async def func(i: int) -> None:
        async with _user_module.async_session_maker() as session:
            stmt = delete(UserTable).where(UserTable.id == user_id)  # type: ignore[invalid-argument-type] # NOTE db
            _ = await session.execute(stmt)
            await session.commit()

    await db_retry(func)


async def update_user_by_id(user_id: UUID4, update_dict: dict) -> UserTable | None:
    """Apply ``update_dict`` to the user and return the updated record, or ``None`` if not found."""

    async def func(i: int) -> UserTable | None:
        async with _user_module.async_session_maker() as session:
            stmt = update(UserTable).where(UserTable.id == user_id).values(**update_dict)  # type: ignore[invalid-argument-type] # NOTE db
            _ = await session.execute(stmt)
            await session.commit()
            query = select(UserTable).where(UserTable.id == user_id)  # type: ignore[invalid-argument-type] # NOTE db
            users = (await session.execute(query)).scalars().all()
            return users[0] if users else None

    return await db_retry(func)


async def patch_user_by_id(user_id: UUID4, update_dict: dict) -> None:
    """Apply a raw ``update_dict`` to the user without returning the updated record."""

    async def func(i: int) -> None:
        async with _user_module.async_session_maker() as session:
            stmt = update(UserTable).where(UserTable.id == user_id).values(**update_dict)  # type: ignore[invalid-argument-type] # NOTE db
            _ = await session.execute(stmt)
            await session.commit()

    await db_retry(func)
