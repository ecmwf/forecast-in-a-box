# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Common session maker invocation, db locking, retries"""

import asyncio
import logging
from asyncio import Lock
from collections.abc import Callable
from typing import Any, Awaitable, TypeVar

import sqlalchemy.exc

logger = logging.getLogger(__name__)
retries = 3
lock = Lock()
T = TypeVar("T")

# TODO integrate with sqlalchemy typing system


async def dbRetry(func: Callable[[int], Awaitable[T]]) -> T:
    for i in range(retries, -1, -1):
        try:
            async with lock:
                return await func(i)
        except sqlalchemy.exc.OperationalError:
            if i == 0:
                raise
            await asyncio.sleep(0.1)
    raise ValueError  # NOTE in case of retries misconfig, we dont want implicit None


async def executeAndCommit(stmt, session_maker) -> None:
    async def func(i: int) -> None:
        async with session_maker() as session:
            await session.execute(stmt)
            await session.commit()

    await dbRetry(func)


async def addAndCommit(entity, session_maker) -> None:
    async def func(i: int) -> None:
        async with session_maker() as session:
            session.add(entity)
            await session.commit()

    await dbRetry(func)


async def querySingle(query, session_maker) -> Any:
    async def func(i: int) -> Any:
        async with session_maker() as session:
            result = await session.execute(query)
            maybe_row = result.first()
            rv = maybe_row if maybe_row is None else maybe_row[0]
            return rv

    return await dbRetry(func)


async def queryCount(query, session) -> int:
    # TODO scalar_one
    result = (await session.execute(query)).scalar()
    if result is None or not isinstance(result, int):
        raise TypeError(result)
    else:
        return result
