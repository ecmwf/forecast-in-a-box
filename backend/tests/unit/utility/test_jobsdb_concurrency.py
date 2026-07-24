# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Focused unit coverage for synchronous jobs-db concurrency primitives."""

import threading
import time

import pytest

from forecastbox.utility.concurrency.manager import ExecutionManager, SubmissionRejected, TaskName
from forecastbox.utility.config import ConcurrentPools


@pytest.fixture
def manager() -> ExecutionManager:
    manager = ExecutionManager(10)
    manager.register_pool(ConcurrentPools.JobsDb, max_workers=1, max_pending=1, stage=0)
    manager.start(timeout=2)
    try:
        yield manager
    finally:
        manager.shutdown(timeout=2)


def test_same_pool_reentrant_submission_is_rejected(manager: ExecutionManager) -> None:
    seen: list[str] = []

    def outer() -> None:
        with pytest.raises(SubmissionRejected, match="same pool"):
            manager.submit_unmonitored(ConcurrentPools.JobsDb, TaskName("inner"), lambda: None)
        seen.append("rejected")

    manager.submit_unmonitored(ConcurrentPools.JobsDb, TaskName("outer"), outer).result(timeout=2)

    assert seen == ["rejected"]


def test_jobs_db_capacity_rejection_propagates(manager: ExecutionManager) -> None:
    started = threading.Event()
    release = threading.Event()

    def blocking() -> None:
        started.set()
        release.wait(2)

    future = manager.submit_unmonitored(ConcurrentPools.JobsDb, TaskName("blocking"), blocking)
    started.wait(1)
    with pytest.raises(SubmissionRejected, match="capacity exhausted"):
        manager.submit_unmonitored(ConcurrentPools.JobsDb, TaskName("second"), lambda: None)
    release.set()
    future.result(timeout=2)
