# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for ExecutionManager / ManagedPool, using local manager instances."""

import threading
from collections.abc import Callable, Generator
from concurrent.futures import Future

import pytest

from forecastbox.utility.concurrency.manager import (
    ComponentStatus,
    ExecutionLifecycle,
    ExecutionManager,
    SubmissionRejected,
    TaskName,
)
from forecastbox.utility.config import ConcurrentPools, ConcurrentThreads


@pytest.fixture
def manager() -> Generator[ExecutionManager, None, None]:
    instance = ExecutionManager(10)
    yield instance
    instance.shutdown(timeout=2)


def _ready() -> ComponentStatus:
    return ComponentStatus(ready=True)


def _waiting_entrypoint(order: list[str], name: str) -> Callable[[threading.Event], None]:
    def entrypoint(stop_event: threading.Event) -> None:
        stop_event.wait()
        order.append(name)

    return entrypoint


def test_bounded_admission_rejects_when_max_pending_reached(manager: ExecutionManager) -> None:
    manager.register_pool(ConcurrentPools.General, max_workers=1, max_pending=2)
    manager.start(timeout=2)
    release = threading.Event()
    first = manager.submit_unmonitored(ConcurrentPools.General, TaskName("a"), release.wait)
    second = manager.submit_unmonitored(ConcurrentPools.General, TaskName("b"), release.wait)
    with pytest.raises(SubmissionRejected):
        manager.submit_unmonitored(ConcurrentPools.General, TaskName("c"), release.wait)
    release.set()
    first.result(timeout=2)
    second.result(timeout=2)
    # NOTE the permit is released by a done-callback, which may run just after result() returns
    for _ in range(200):
        if manager.status().pools[ConcurrentPools.General].pending == 0:
            break
        threading.Event().wait(0.005)
    manager.submit_unmonitored(ConcurrentPools.General, TaskName("d"), lambda: None).result(timeout=2)


def test_same_pool_submission_from_worker_is_rejected(manager: ExecutionManager) -> None:
    manager.register_pool(ConcurrentPools.JobsDb, max_workers=1, max_pending=4)
    manager.start(timeout=2)

    def nested() -> None:
        manager.submit_unmonitored(ConcurrentPools.JobsDb, TaskName("inner"), lambda: None)

    future = manager.submit_unmonitored(ConcurrentPools.JobsDb, TaskName("outer"), nested)
    with pytest.raises(SubmissionRejected):
        future.result(timeout=2)


def test_coroutine_task_is_rejected(manager: ExecutionManager) -> None:
    manager.register_pool(ConcurrentPools.General, max_workers=1, max_pending=4)
    manager.start(timeout=2)

    async def coroutine() -> None:
        pass

    with pytest.raises(SubmissionRejected):
        manager.submit_unmonitored(ConcurrentPools.General, TaskName("coro"), coroutine)


def test_threads_stop_in_descending_stage_order_and_pools_stay_usable(manager: ExecutionManager) -> None:
    order: list[str] = []
    manager.register_pool(ConcurrentPools.General, max_workers=1, max_pending=4)
    manager.register_thread(ConcurrentThreads.EventDispatcher, _waiting_entrypoint(order, "stage0"), status_provider=_ready, stage=0)
    manager.register_thread(ConcurrentThreads.Scheduler, _waiting_entrypoint(order, "stage1"), status_provider=_ready, stage=1)
    manager.register_thread(
        ConcurrentThreads.DatabaseGarbageCollector, _waiting_entrypoint(order, "stage2"), status_provider=_ready, stage=2
    )
    start = manager.start(timeout=2)
    assert start.started_stages == (0, 1, 2)

    incomplete = manager.stop_threads(timeout=2)
    assert incomplete == ()
    assert order == ["stage2", "stage1", "stage0"]
    assert manager.status().lifecycle is ExecutionLifecycle.stopping
    # NOTE external submissions are rejected once stopping
    with pytest.raises(SubmissionRejected):
        manager.submit_unmonitored(ConcurrentPools.General, TaskName("late"), lambda: None)

    status = manager.shutdown(timeout=2)
    assert status.complete


def test_raising_stop_request_does_not_abort_shutdown(manager: ExecutionManager) -> None:
    order: list[str] = []

    def failing_stop_request(timeout: float) -> None:
        raise RuntimeError("boom")

    manager.register_pool(ConcurrentPools.General, max_workers=1, max_pending=4)
    manager.register_thread(
        ConcurrentThreads.Scheduler,
        _waiting_entrypoint(order, "scheduler"),
        status_provider=_ready,
        stop_request=failing_stop_request,
        stage=1,
    )
    manager.start(timeout=2)
    status = manager.shutdown(timeout=2)
    assert status.complete
    assert order == ["scheduler"]
    assert not manager.status().pools[ConcurrentPools.General].accepting


def test_submit_after_failed_dependency_skips_task(manager: ExecutionManager) -> None:
    manager.register_pool(ConcurrentPools.General, max_workers=1, max_pending=4)
    manager.start(timeout=2)
    dependency: Future[None] = Future()
    ran: list[bool] = []
    result = manager.submit_after(dependency, ConcurrentPools.General, TaskName("after"), lambda: ran.append(True))
    dependency.set_exception(RuntimeError("dependency failed"))
    with pytest.raises(RuntimeError, match="dependency failed"):
        result.result(timeout=2)
    assert ran == []
    assert any(failure.task_name == "after" for failure in manager.status().monitored_failures)


def test_status_counters_health_and_thread_identity(manager: ExecutionManager) -> None:
    manager.register_pool(ConcurrentPools.General, max_workers=2, max_pending=4)
    manager.register_thread(ConcurrentThreads.EventDispatcher, _waiting_entrypoint([], "t"), status_provider=_ready, stage=0)
    manager.start(timeout=2)
    manager.submit_unmonitored(ConcurrentPools.General, TaskName("ok"), lambda: None).result(timeout=2)
    failing = manager.submit_unmonitored(ConcurrentPools.General, TaskName("fail"), lambda: 1 / 0)
    with pytest.raises(ZeroDivisionError):
        failing.result(timeout=2)

    for _ in range(200):
        pool = manager.status().pools[ConcurrentPools.General]
        if pool.succeeded == 1 and pool.failed == 1:
            break
        threading.Event().wait(0.005)
    status = manager.status()
    pool = status.pools[ConcurrentPools.General]
    assert (pool.submitted, pool.succeeded, pool.failed) == (2, 1, 1)
    assert pool.healthy
    assert status.healthy

    thread = status.threads[ConcurrentThreads.EventDispatcher]
    assert thread.alive
    assert thread.native_id is not None

    for worker_name in pool.worker_names:
        assert worker_name not in status.unregistered_threads
    assert "fiab-event-dispatcher" not in status.unregistered_threads
