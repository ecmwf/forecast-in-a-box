# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Persistence layer for user management, guarded by the shared db lock.

All writes and reads go through ``dbRetry`` from ``utility/db.py`` so that
concurrent access to the user SQLite file is serialised the same way as every
other domain db module.
"""

from pydantic import UUID4
from sqlalchemy import delete, select, update

import forecastbox.schemata.user as _user_module
from forecastbox.schemata.user import UserTable
from forecastbox.utility.db import dbRetry


async def list_users() -> list[UserTable]:
    """Return all registered users."""

    async def func(i: int) -> list[UserTable]:
        async with _user_module.async_session_maker() as session:
            query = select(UserTable)
            return (await session.execute(query)).unique().scalars().all()  # type: ignore[invalid-return-type] # NOTE db

    return await dbRetry(func)


async def get_user_by_id(user_id: UUID4) -> UserTable | None:
    """Return a single user by UUID, or ``None`` if not found."""

    async def func(i: int) -> UserTable | None:
        async with _user_module.async_session_maker() as session:
            query = select(UserTable).where(UserTable.id == user_id)  # type: ignore[invalid-argument-type] # NOTE db
            users = (await session.execute(query)).unique().scalars().all()
            return users[0] if users else None

    return await dbRetry(func)


async def delete_user_by_id(user_id: UUID4) -> None:
    """Delete a user by UUID."""

    async def func(i: int) -> None:
        async with _user_module.async_session_maker() as session:
            stmt = delete(UserTable).where(UserTable.id == user_id)  # type: ignore[invalid-argument-type] # NOTE db
            _ = await session.execute(stmt)
            await session.commit()

    await dbRetry(func)


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

    return await dbRetry(func)


async def patch_user_by_id(user_id: UUID4, update_dict: dict) -> None:
    """Apply a raw ``update_dict`` to the user without returning the updated record."""

    async def func(i: int) -> None:
        async with _user_module.async_session_maker() as session:
            stmt = update(UserTable).where(UserTable.id == user_id).values(**update_dict)  # type: ignore[invalid-argument-type] # NOTE db
            _ = await session.execute(stmt)
            await session.commit()

    await dbRetry(func)
