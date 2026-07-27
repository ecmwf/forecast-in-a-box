# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Synchronous locking, retries, and session helpers for jobs persistence.

The lock in this module is a synchronous ``threading.RLock`` that serializes all
in-process access to the jobs SQLite database. The administrative users database
has its own separate async lock and retry helper in ``domain.auth.db``.
"""

import logging
import threading
import time
from collections.abc import Callable
from typing import Any, TypeVar

import sqlalchemy.exc

logger = logging.getLogger(__name__)
retries = 3
# This lock is for jobs persistence only. The users database has a separate lock.
lock = threading.RLock()
T = TypeVar("T")

# TODO integrate with sqlalchemy typing system


def dbRetry(func: Callable[[int], T]) -> T:
    for i in range(retries, -1, -1):
        try:
            with lock:
                return func(i)
        except sqlalchemy.exc.OperationalError:
            if i == 0:
                raise
            time.sleep(0.1)
    raise ValueError  # NOTE in case of retries misconfig, we dont want implicit None


def executeAndCommit(stmt: Any, session_maker: Any) -> None:
    def func(i: int) -> None:
        with session_maker() as session:
            session.execute(stmt)
            session.commit()

    dbRetry(func)


def addAndCommit(entity: Any, session_maker: Any) -> None:
    def func(i: int) -> None:
        with session_maker() as session:
            session.add(entity)
            session.commit()

    dbRetry(func)


def querySingle(query: Any, session_maker: Any) -> Any:
    def func(i: int) -> Any:
        with session_maker() as session:
            result = session.execute(query)
            maybe_row = result.first()
            return maybe_row if maybe_row is None else maybe_row[0]

    return dbRetry(func)


def queryCount(query: Any, session: Any) -> int:
    # TODO scalar_one
    result = session.execute(query).scalar()
    if result is None or not isinstance(result, int):
        raise TypeError(result)
    else:
        return result
