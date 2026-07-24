# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Synchronous locking, retries, and session helpers for jobs persistence.

The lock in this module serializes access to the jobs SQLite database. The
administrative users database has its own lock and retry helper in
``domain.auth.db``.
"""

import sqlite3
import threading
import time
from collections.abc import Callable
from typing import Any, TypeVar, cast

import sqlalchemy.exc
from sqlalchemy.orm import Session, sessionmaker

retries = 3
# TODO investigate concurrent reads. SQLite should support concurrent readers,
# but the first implementation deliberately serializes all access so this
# rework does not also need to solve read/write classification and consistency.
lock = threading.RLock()
T = TypeVar("T")
SessionMaker = sessionmaker[Session]

# TODO integrate with sqlalchemy typing system


def dbRetry(func: Callable[[int], T]) -> T:
    for i in range(retries, -1, -1):
        try:
            with lock:
                return func(i)
        except (sqlite3.OperationalError, sqlalchemy.exc.OperationalError):
            if i == 0:
                raise
            time.sleep(0.1)
    raise ValueError("dbRetry exhausted without returning")


def executeAndCommit(stmt: Any, session_maker: SessionMaker) -> None:
    def func(i: int) -> None:
        with session_maker() as session:
            session.execute(stmt)
            session.commit()

    dbRetry(func)


def addAndCommit(entity: Any, session_maker: SessionMaker) -> None:
    def func(i: int) -> None:
        with session_maker() as session:
            session.add(entity)
            session.commit()

    dbRetry(func)


def querySingle(query: Any, session_maker: SessionMaker) -> Any:
    def func(i: int) -> Any:
        with session_maker() as session:
            result = session.execute(query)
            maybe_row = result.first()
            return maybe_row if maybe_row is None else maybe_row[0]

    return dbRetry(func)


def queryCount(query: Any, session_maker: SessionMaker) -> int:
    def func(i: int) -> int:
        with session_maker() as session:
            result = session.execute(query).scalar()
            if result is None or not isinstance(result, int):
                raise TypeError(result)
            return cast(int, result)

    return dbRetry(func)
