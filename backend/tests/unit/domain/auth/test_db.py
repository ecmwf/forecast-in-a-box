# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import asyncio
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.exc import OperationalError

import forecastbox.domain.auth.db as auth_db
from forecastbox.utility import db as jobs_db


def _operational_error() -> OperationalError:
    return OperationalError("test", {}, RuntimeError("busy"))


@pytest.mark.asyncio
async def test_db_retry_uses_local_lock_and_retries_operational_errors() -> None:
    calls: list[int] = []

    async def operation(attempt: int) -> str:
        calls.append(attempt)
        if len(calls) < 4:
            raise _operational_error()
        return "done"

    async with auth_db.db_lock:
        operation_task = asyncio.create_task(auth_db.db_retry(operation))
        await asyncio.sleep(0)
        assert calls == []

    with patch.object(auth_db.asyncio, "sleep", new=AsyncMock()) as sleep:
        assert await operation_task == "done"

    assert calls == [3, 2, 1, 0]
    assert sleep.await_count == 3
    assert auth_db.db_lock is not jobs_db.lock
