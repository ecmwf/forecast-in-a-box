import datetime as dt
import threading
import time
from collections.abc import Callable, Iterator
from concurrent.futures import Future

import pytest

import forecastbox.domain.experiment.scheduling.runtime as rt
from forecastbox.domain.experiment.exceptions import SchedulerDisabled, SchedulerRestartRefused
from forecastbox.domain.experiment.scheduling.background import max_sleep_seconds
from forecastbox.utility.concurrency.manager import (
    NEVER_RESTART,
    ExecutionManager,
    LifecycleError,
    RestartPolicy,
    StatusModel,
)
from forecastbox.utility.config import ConcurrentThreads, config
from forecastbox.utility.time import current_time


@pytest.fixture(autouse=True)
def fresh_runtime() -> Iterator[None]:
    rt.SchedulerRuntime.wake = threading.Event()
    rt.SchedulerRuntime.start_gate = None
    rt.SchedulerRuntime.status = rt.SchedulerStatus(state=rt.SchedulerState.stopped)
    yield
    rt.SchedulerRuntime.start_gate = None
    rt.SchedulerRuntime.status = rt.SchedulerStatus(state=rt.SchedulerState.stopped)


def wait_until(predicate: Callable[[], bool], timeout: float = 5.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.01)
    raise AssertionError("condition not reached")


def start_thread(stop: threading.Event) -> threading.Thread:
    thread = threading.Thread(target=rt.scheduler_entrypoint, args=(stop,))
    thread.start()
    return thread


def test_gate_success(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(rt, "schedule_due_experiments", lambda now, stop: 3600)
    gate: Future[None] = Future()
    rt.arm_start_gate(gate)
    stop = threading.Event()
    thread = start_thread(stop)
    wait_until(lambda: rt.scheduler_status().state == rt.SchedulerState.waiting_for_prerequisites)
    gate.set_result(None)
    wait_until(lambda: rt.scheduler_status().state == rt.SchedulerState.sleeping)
    stop.set()
    rt.scheduler_stop_request(1.0)
    thread.join(5)
    assert not thread.is_alive()
    assert rt.scheduler_status().state == rt.SchedulerState.stopped


def test_gate_failure_and_one_shot(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[int] = []

    def fake(now: dt.datetime, stop: threading.Event) -> float:
        calls.append(1)
        return 3600

    monkeypatch.setattr(rt, "schedule_due_experiments", fake)
    monkeypatch.setattr(config.backend, "allow_scheduler", True)
    gate: Future[None] = Future()
    gate.set_exception(RuntimeError("boom"))
    rt.arm_start_gate(gate)
    stop = threading.Event()
    rt.scheduler_entrypoint(stop)
    assert calls == []
    assert rt.scheduler_status().state == rt.SchedulerState.prerequisites_failed
    assert rt.status_scheduler() == "down"

    thread = start_thread(stop)
    wait_until(lambda: rt.scheduler_status().state == rt.SchedulerState.sleeping)
    assert calls == [1]
    stop.set()
    rt.scheduler_stop_request(1.0)
    thread.join(5)


def test_prod_during_iteration_not_lost(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[int] = []

    def fake(now: dt.datetime, stop: threading.Event) -> float:
        calls.append(1)
        if len(calls) == 1:
            rt.prod_scheduler()
        return 3600

    monkeypatch.setattr(rt, "schedule_due_experiments", fake)
    stop = threading.Event()
    thread = start_thread(stop)
    wait_until(lambda: len(calls) >= 2)
    stop.set()
    rt.scheduler_stop_request(1.0)
    thread.join(5)


def test_status_scheduler(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config.backend, "allow_scheduler", False)
    assert rt.status_scheduler() == "off"
    monkeypatch.setattr(config.backend, "allow_scheduler", True)
    now = current_time("liveness")
    stale = now - dt.timedelta(seconds=3 * max_sleep_seconds)
    rt.SchedulerRuntime.status = rt.SchedulerStatus(state=rt.SchedulerState.sleeping, last_iteration_at=stale)
    assert rt.status_scheduler() == "down"
    rt.SchedulerRuntime.status = rt.SchedulerStatus(state=rt.SchedulerState.sleeping, last_iteration_at=now)
    assert rt.status_scheduler() == "up"


class _Ready(StatusModel):
    def is_ready(self) -> bool:
        return True


def test_manager_restart_semantics() -> None:
    manager = ExecutionManager(10)
    name = ConcurrentThreads.Scheduler
    runs: list[int] = []

    def entry(stop: threading.Event) -> None:
        runs.append(1)
        if len(runs) == 1:
            raise RuntimeError("first run fails")
        stop.wait(10)

    manager.register_thread(
        name, entry, status_provider=lambda: _Ready(), stop_request=None, stage=0, restart_policy=RestartPolicy(max_restarts=1)
    )
    try:
        manager.start(timeout=5)
        wait_until(lambda: not manager.status().threads[name].alive)
        assert manager.status().healthy is False
        manager.restart_thread(name)
        wait_until(lambda: len(runs) == 2)
        assert manager.status().threads[name].uncaught_exception is None
        assert manager.status().healthy is True
        manager.stop_thread(name, timeout=5)
        with pytest.raises(LifecycleError):
            manager.restart_thread(name)
        status = manager.restart_thread(name, reset_restart_count=True)
        assert status.restart_count == 0
        manager.stop_thread(name, timeout=5)
    finally:
        manager.shutdown(timeout=5)


def test_manager_never_restart_reset() -> None:
    manager = ExecutionManager(10)
    name = ConcurrentThreads.Scheduler
    manager.register_thread(name, lambda stop: None, status_provider=lambda: _Ready(), stage=0, restart_policy=NEVER_RESTART)
    try:
        manager.start(timeout=5)
        wait_until(lambda: not manager.status().threads[name].alive)
        with pytest.raises(LifecycleError):
            manager.restart_thread(name)
        manager.restart_thread(name, reset_restart_count=True)
    finally:
        manager.shutdown(timeout=5)


def test_restart_scheduler(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config.backend, "allow_scheduler", False)
    with pytest.raises(SchedulerDisabled):
        rt.restart_scheduler()
    monkeypatch.setattr(config.backend, "allow_scheduler", True)

    def refuse(*args: object, **kwargs: object) -> None:
        raise LifecycleError("nope")

    monkeypatch.setattr(rt.execution_manager, "stop_thread", lambda *a, **k: None)
    monkeypatch.setattr(rt.execution_manager, "restart_thread", refuse)
    with pytest.raises(SchedulerRestartRefused):
        rt.restart_scheduler()
