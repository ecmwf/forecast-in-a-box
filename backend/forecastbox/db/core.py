"""Common session maker invocation, db locking, retries"""

import asyncio
import logging
from asyncio import Lock
from typing import Any
from typing import Callable
from typing import TypeVar

import sqlalchemy.exc

logger = logging.getLogger(__name__)
retries = 3
lock = Lock()
T = TypeVar("T")

# TODO integrate with sqlalchemy typing system


async def dbRetry(func: Callable[[int], T]) -> T:
    for i in range(retries, -1, -1):
        try:
            async with lock:
                return await func(i)
        except sqlalchemy.exc.OperationalError:
            if i == 0:
                raise
            await asyncio.sleep(0.1)


async def executeAndCommit(stmt, session_maker) -> None:
    async def func(i: int) -> None:
        async with session_maker() as session:
            logger.debug(f"db action await (attempt #{retries - i}) {stmt=}")
            await session.execute(stmt)
            await session.commit()
            logger.debug(f"db action done (attempt #{retries - i}) {stmt=}")

    await dbRetry(func)


async def addAndCommit(entity, session_maker) -> None:
    async def func(i: int) -> None:
        async with session_maker() as session:
            logger.debug(f"db action await (attempt #{retries - i}) {entity=}")
            session.add(entity)
            await session.commit()
            logger.debug(f"db action done (attempt #{retries - i}) {entity=}")

    await dbRetry(func)


async def querySingle(query, session_maker) -> Any:
    async def func(i: int) -> Any:
        async with session_maker() as session:
            logger.debug(f"db action await (attempt #{retries - i}) {query=}")
            result = await session.execute(query)
            maybe_row = result.first()
            rv = maybe_row if maybe_row is None else maybe_row[0]
            logger.debug(f"db action done (attempt #{retries - i}) {query=}")
            return rv

    return await dbRetry(func)
