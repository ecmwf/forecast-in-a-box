# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Central, bounded concurrency primitives used by the backend entrypoint."""

import asyncio
import inspect
import threading
import time
import traceback
from collections import deque
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, NewType, Protocol, TypeVar, cast

from pydantic import BaseModel, ConfigDict, SerializeAsAny

from forecastbox.utility.config import ConcurrentPools, ConcurrentThreads, config
from forecastbox.utility.pydantic import FiabBaseModel
from forecastbox.utility.structural import freeze_mapping

T = TypeVar("T")
TaskName = NewType("TaskName", str)
SyncTask = Callable[[], T]
ThreadEntrypoint = Callable[[threading.Event], None]


class ComponentStatusProtocol(Protocol):
    def is_ready(self) -> bool: ...


StatusProvider = Callable[[], ComponentStatusProtocol]
StopRequest = Callable[[float], None]


class ExecutionLifecycle(StrEnum):
    new = "new"
    starting = "starting"
    running = "running"
    stopping = "stopping"
    stopped = "stopped"


@dataclass(frozen=True, eq=True, slots=True)
class RestartPolicy:
    """A finite restart budget for one managed long-lived thread."""

    max_restarts: int = 0

    def __post_init__(self) -> None:
        if self.max_restarts < 0:
            raise ValueError("max_restarts must be non-negative")


NEVER_RESTART = RestartPolicy()


class ExecutionManagerError(RuntimeError):
    """Base class for execution manager errors."""


class LifecycleError(ExecutionManagerError):
    """Raised when an operation is not valid for the manager lifecycle."""


class RegistrationError(ExecutionManagerError):
    """Raised for invalid or duplicate resource registrations."""


class StartupError(ExecutionManagerError):
    """Raised when a resource cannot become ready during startup."""


class SubmissionRejected(ExecutionManagerError):
    """Raised when a task cannot be accepted by a managed pool."""


class StatusModel(FiabBaseModel):
    model_config = ConfigDict(frozen=True)


class ComponentStatus(StatusModel):
    ready: bool
    health: str = "unknown"
    detail: str = ""

    def is_ready(self) -> bool:
        return self.ready


class MonitoredFailure(StatusModel):
    pool_name: ConcurrentPools
    task_name: TaskName
    exception_type: str
    message: str
    traceback: str


class PoolStatus(StatusModel):
    pool_name: ConcurrentPools
    stage: int
    max_workers: int
    max_pending: int
    observed_workers: int
    worker_names: tuple[str, ...]
    submitted: int
    pending: int
    active: int
    succeeded: int
    failed: int
    cancelled: int
    accepting: bool


class ThreadStatus(StatusModel):
    thread_name: ConcurrentThreads
    stage: int
    alive: bool
    ready: bool
    component_status: SerializeAsAny[BaseModel]
    started_at: float | None
    stopped_at: float | None
    uncaught_exception: str | None
    traceback: str | None
    restart_count: int
    restart_limit: int


class StartStatus(StatusModel):
    lifecycle: ExecutionLifecycle
    success: bool
    started_stages: tuple[int, ...]
    error: str | None = None


class ShutdownStatus(StatusModel):
    lifecycle: ExecutionLifecycle
    complete: bool
    incomplete_threads: tuple[ConcurrentThreads, ...]
    incomplete_pools: tuple[ConcurrentPools, ...]


class ExecutionStatus(StatusModel):
    lifecycle: ExecutionLifecycle
    healthy: bool
    pools: dict[ConcurrentPools, PoolStatus]
    threads: dict[ConcurrentThreads, ThreadStatus]
    monitored_failures: tuple[MonitoredFailure, ...]
    unregistered_threads: tuple[str, ...]


_worker_context = threading.local()


class ManagedPool:
    """Private adapter around a thread pool with explicit bounded admission."""

    def __init__(self, pool_name: ConcurrentPools, max_workers: int, max_pending: int, stage: int) -> None:
        if max_workers <= 0 or max_pending <= 0:
            raise RegistrationError("pool worker and pending limits must be positive")
        if stage < 0:
            raise RegistrationError("pool stage must be non-negative")
        self.pool_name = pool_name
        self.max_workers = max_workers
        self.max_pending = max_pending
        self.stage = stage
        self._executor: ThreadPoolExecutor | None = None
        self._permits = threading.BoundedSemaphore(max_pending)
        self._lock = threading.RLock()
        self._futures: set[Future[Any]] = set()
        self._worker_names: dict[int, str] = {}
        self._submitted = 0
        self._pending = 0
        self._active = 0
        self._succeeded = 0
        self._failed = 0
        self._cancelled = 0
        self._accepting = False

    def _initialize_worker(self) -> None:
        current = threading.current_thread()
        with self._lock:
            self._worker_names[threading.get_native_id()] = current.name
        _worker_context.pool_name = self.pool_name

    def start(self, timeout: float) -> None:
        with self._lock:
            if self._executor is not None:
                return
            self._executor = ThreadPoolExecutor(
                max_workers=self.max_workers,
                thread_name_prefix=f"fiab-{self.pool_name.value}",
                initializer=self._initialize_worker,
            )
            self._accepting = True

        barrier = threading.Barrier(self.max_workers + 1)
        warm_futures = [self._executor.submit(barrier.wait) for _ in range(self.max_workers)]
        try:
            barrier.wait(timeout=max(timeout, 0))
            for future in warm_futures:
                future.result(timeout=max(timeout, 0))
        except BaseException:
            for future in warm_futures:
                future.cancel()
            self.close()
            raise

    def submit(self, task_name: TaskName, task: SyncTask[T]) -> Future[T]:
        if inspect.iscoroutinefunction(task):
            raise SubmissionRejected(f"coroutine task rejected: {task_name}")
        if getattr(_worker_context, "pool_name", None) == self.pool_name:
            raise SubmissionRejected(f"pool worker cannot submit to the same pool: {self.pool_name.value}")
        if not self._permits.acquire(blocking=False):
            raise SubmissionRejected(f"pool capacity exhausted: {self.pool_name.value}")

        with self._lock:
            executor = self._executor
            if executor is None or not self._accepting:
                self._permits.release()
                raise SubmissionRejected(f"pool is not accepting submissions: {self.pool_name.value}")
            self._submitted += 1
            self._pending += 1

        def wrapped() -> T:
            _worker_context.pool_name = self.pool_name
            with self._lock:
                self._pending -= 1
                self._active += 1
            try:
                result = task()
                if inspect.iscoroutine(result):
                    result.close()
                    raise TypeError(f"task returned a coroutine: {task_name}")
                return cast(T, result)
            finally:
                with self._lock:
                    self._active -= 1

        try:
            future = executor.submit(wrapped)
        except BaseException:
            with self._lock:
                self._pending -= 1
                self._failed += 1
            self._permits.release()
            raise

        with self._lock:
            self._futures.add(future)

        def completed(done: Future[T]) -> None:
            with self._lock:
                self._futures.discard(done)
                if done.cancelled():
                    self._pending -= 1
                    self._cancelled += 1
                elif done.exception() is None:
                    self._succeeded += 1
                else:
                    self._failed += 1
            self._permits.release()

        future.add_done_callback(completed)
        return future

    def close(self, deadline: float | None = None) -> bool:
        with self._lock:
            self._accepting = False
            executor = self._executor
        if executor is None:
            return True
        executor.shutdown(wait=False, cancel_futures=False)
        while True:
            with self._lock:
                complete = not self._futures
            if complete:
                executor.shutdown(wait=True, cancel_futures=False)
                return True
            if deadline is not None and time.monotonic() >= deadline:
                return False
            time.sleep(0.005)

    def status(self) -> PoolStatus:
        with self._lock:
            return PoolStatus(
                pool_name=self.pool_name,
                stage=self.stage,
                max_workers=self.max_workers,
                max_pending=self.max_pending,
                observed_workers=len(self._worker_names),
                worker_names=tuple(sorted(self._worker_names.values())),
                submitted=self._submitted,
                pending=self._pending,
                active=self._active,
                succeeded=self._succeeded,
                failed=self._failed,
                cancelled=self._cancelled,
                accepting=self._accepting,
            )


@dataclass
class _ThreadRecord:
    thread_name: ConcurrentThreads
    entrypoint: ThreadEntrypoint
    status_provider: StatusProvider
    stop_request: StopRequest | None
    stage: int
    restart_policy: RestartPolicy
    stop_event: threading.Event | None = None
    thread: threading.Thread | None = None
    started_at: float | None = None
    stopped_at: float | None = None
    uncaught_exception: str | None = None
    traceback: str | None = None
    restart_count: int = 0


class ExecutionManager:
    """Owns named pools and long-lived threads for one application lifecycle."""

    def __init__(self, failure_history_size: int = 100) -> None:
        if failure_history_size <= 0:
            raise ValueError("failure_history_size must be positive")
        self._lock = threading.RLock()
        self._lifecycle = ExecutionLifecycle.new
        self._pools: dict[ConcurrentPools, ManagedPool] = {}
        self._threads: dict[ConcurrentThreads, _ThreadRecord] = {}
        self._ready_stages: set[int] = set()
        self._monitored_failures: deque[MonitoredFailure] = deque(maxlen=failure_history_size)

    def register_pool(self, pool_name: ConcurrentPools, *, max_workers: int, max_pending: int, stage: int = 0) -> None:
        with self._lock:
            if self._lifecycle not in (ExecutionLifecycle.new, ExecutionLifecycle.starting):
                raise LifecycleError("pools can only be registered before or during startup")
            if pool_name in self._pools:
                raise RegistrationError(f"duplicate pool: {pool_name.value}")
            self._pools[pool_name] = ManagedPool(pool_name, max_workers, max_pending, stage)

    def register_thread(
        self,
        thread_name: ConcurrentThreads,
        entrypoint: ThreadEntrypoint,
        *,
        status_provider: StatusProvider,
        stop_request: StopRequest | None = None,
        stage: int,
        restart_policy: RestartPolicy = NEVER_RESTART,
    ) -> None:
        if stage < 0:
            raise RegistrationError("thread stage must be non-negative")
        with self._lock:
            if self._lifecycle not in (ExecutionLifecycle.new, ExecutionLifecycle.starting):
                raise LifecycleError("threads can only be registered before or during startup")
            if thread_name in self._threads:
                raise RegistrationError(f"duplicate thread: {thread_name}")
            self._threads[thread_name] = _ThreadRecord(
                thread_name=thread_name,
                entrypoint=entrypoint,
                status_provider=status_provider,
                stop_request=stop_request,
                stage=stage,
                restart_policy=restart_policy,
            )

    def _start_thread(self, record: _ThreadRecord) -> None:
        stop_event = threading.Event()
        record.stop_event = stop_event

        def run() -> None:
            record.started_at = time.time()
            try:
                record.entrypoint(stop_event)
            except BaseException as error:
                record.uncaught_exception = repr(error)
                record.traceback = traceback.format_exc()
            finally:
                record.stopped_at = time.time()

        record.thread = threading.Thread(name=f"fiab-{record.thread_name.value}", target=run)
        record.thread.start()

    def _thread_snapshot(self, record: _ThreadRecord) -> ThreadStatus:
        try:
            component = record.status_provider()
            if not isinstance(component, BaseModel):
                raise TypeError("status provider must return a Pydantic model")
            is_ready = getattr(component, "is_ready", None)
            if not callable(is_ready):
                raise TypeError("status provider result must define is_ready()")
            ready = is_ready()
            if not isinstance(ready, bool):
                raise TypeError("status provider is_ready() must return bool")
        except BaseException as error:
            component = ComponentStatus(ready=False, health="failure", detail=repr(error))
            ready = False
        alive = record.thread.is_alive() if record.thread is not None else False
        return ThreadStatus(
            thread_name=record.thread_name,
            stage=record.stage,
            alive=alive,
            ready=ready,
            component_status=component,
            started_at=record.started_at,
            stopped_at=record.stopped_at,
            uncaught_exception=record.uncaught_exception,
            traceback=record.traceback,
            restart_count=record.restart_count,
            restart_limit=record.restart_policy.max_restarts,
        )

    def _wait_for_ready(self, record: _ThreadRecord, deadline: float) -> None:
        while time.monotonic() < deadline:
            snapshot = self._thread_snapshot(record)
            if snapshot.ready:
                return
            if not snapshot.alive and record.stopped_at is not None:
                raise StartupError(f"managed thread stopped before readiness: {record.thread_name}")
            time.sleep(0.005)
        raise StartupError(f"managed thread readiness timed out: {record.thread_name}")

    def start(self, *, timeout: float) -> StartStatus:
        if timeout <= 0:
            raise ValueError("startup timeout must be positive")
        with self._lock:
            if self._lifecycle is not ExecutionLifecycle.new:
                raise LifecycleError(f"cannot start manager from {self._lifecycle.value}")
            self._lifecycle = ExecutionLifecycle.starting
            stages = sorted({pool.stage for pool in self._pools.values()} | {thread.stage for thread in self._threads.values()})
        deadline = time.monotonic() + timeout
        started_stages: list[int] = []
        try:
            for stage in stages:
                if time.monotonic() >= deadline:
                    raise StartupError("execution manager startup timed out")
                for pool in self._pools.values():
                    if pool.stage == stage:
                        pool.start(max(0, deadline - time.monotonic()))
                with self._lock:
                    self._ready_stages.add(stage)
                for record in self._threads.values():
                    if record.stage == stage:
                        self._start_thread(record)
                for record in self._threads.values():
                    if record.stage == stage:
                        self._wait_for_ready(record, deadline)
                started_stages.append(stage)
            with self._lock:
                self._lifecycle = ExecutionLifecycle.running
            return StartStatus(
                lifecycle=ExecutionLifecycle.running,
                success=True,
                started_stages=tuple(started_stages),
            )
        except BaseException as error:
            self._abort_startup(deadline)
            if isinstance(error, StartupError):
                raise
            raise StartupError(str(error)) from error

    def _abort_startup(self, deadline: float) -> None:
        with self._lock:
            self._lifecycle = ExecutionLifecycle.stopping
        for record in sorted(self._threads.values(), key=lambda item: item.stage, reverse=True):
            self._stop_record(record, deadline)
        for pool in self._pools.values():
            pool.close(deadline)
        with self._lock:
            self._lifecycle = ExecutionLifecycle.stopped

    def _stop_record(self, record: _ThreadRecord, deadline: float) -> bool:
        thread = record.thread
        if thread is None or not thread.is_alive():
            return True
        if record.stop_event is not None:
            record.stop_event.set()
        if record.stop_request is not None:
            remaining = max(0, deadline - time.monotonic())
            record.stop_request(remaining)
        remaining = max(0, deadline - time.monotonic())
        thread.join(remaining)
        return not thread.is_alive()

    def stop_thread(self, thread_name: ConcurrentThreads, *, timeout: float) -> ThreadStatus:
        with self._lock:
            record = self._threads.get(thread_name)
            if record is None:
                raise KeyError(f"unknown managed thread: {thread_name}")
        self._stop_record(record, time.monotonic() + max(timeout, 0))
        return self._thread_snapshot(record)

    def restart_thread(self, thread_name: ConcurrentThreads) -> ThreadStatus:
        with self._lock:
            if self._lifecycle is not ExecutionLifecycle.running:
                raise LifecycleError("threads can only be restarted while the manager is running")
            record = self._threads.get(thread_name)
            if record is None:
                raise KeyError(f"unknown managed thread: {thread_name}")
            if record.thread is not None and record.thread.is_alive():
                raise LifecycleError(f"thread is still alive: {thread_name}")
            if record.restart_count >= record.restart_policy.max_restarts:
                raise LifecycleError(f"restart policy exhausted: {thread_name}")
            record.restart_count += 1
        self._start_thread(record)
        return self._thread_snapshot(record)

    def _can_submit(self, pool: ManagedPool) -> None:
        with self._lock:
            if self._lifecycle is ExecutionLifecycle.running:
                return
            current = threading.current_thread()
            managed_thread = any(record.thread is current for record in self._threads.values())
            if (
                managed_thread
                and self._lifecycle in (ExecutionLifecycle.starting, ExecutionLifecycle.stopping)
                and pool.stage in self._ready_stages
            ):
                return
            raise SubmissionRejected(f"manager is not accepting submissions: {self._lifecycle.value}")

    def _pool(self, pool_name: ConcurrentPools) -> ManagedPool:
        with self._lock:
            pool = self._pools.get(pool_name)
        if pool is None:
            raise SubmissionRejected(f"pool is not registered: {pool_name.value}")
        return pool

    def submit_unmonitored(self, pool_name: ConcurrentPools, task_name: TaskName, task: SyncTask[T]) -> Future[T]:
        pool = self._pool(pool_name)
        self._can_submit(pool)
        return pool.submit(task_name, task)

    def _record_failure(self, pool_name: ConcurrentPools, task_name: TaskName, error: BaseException) -> None:
        failure = MonitoredFailure(
            pool_name=pool_name,
            task_name=task_name,
            exception_type=type(error).__name__,
            message=str(error),
            traceback="".join(traceback.format_exception(type(error), error, error.__traceback__)),
        )
        with self._lock:
            self._monitored_failures.append(failure)

    def _submit_monitored_receipt(self, pool_name: ConcurrentPools, task_name: TaskName, task: SyncTask[T]) -> Future[T]:
        future = self.submit_unmonitored(pool_name, task_name, task)

        def record_failure(done: Future[T]) -> None:
            if done.cancelled():
                self._record_failure(pool_name, task_name, FutureCancelledError("task was cancelled"))
                return
            error = done.exception()
            if error is not None:
                self._record_failure(pool_name, task_name, error)

        future.add_done_callback(record_failure)
        return future

    def submit_monitored(self, pool_name: ConcurrentPools, task_name: TaskName, task: SyncTask[T]) -> None:
        self._submit_monitored_receipt(pool_name, task_name, task)

    async def awaitable_submit(self, pool_name: ConcurrentPools, task_name: TaskName, task: SyncTask[T]) -> T:
        future = self.submit_unmonitored(pool_name, task_name, task)
        return await asyncio.wrap_future(future)

    def submit_after(
        self,
        dependency: Future[Any],
        pool_name: ConcurrentPools,
        task_name: TaskName,
        task: SyncTask[T],
        *,
        run_if_dependency_failed: bool = False,
    ) -> None:
        def continue_submission(done: Future[Any]) -> None:
            dependency_failed = False
            try:
                done.result()
            except BaseException as error:
                dependency_failed = True
                self._record_failure(pool_name, task_name, error)
            if dependency_failed and not run_if_dependency_failed:
                return
            try:
                self._submit_monitored_receipt(pool_name, task_name, task)
            except BaseException as error:
                self._record_failure(pool_name, task_name, error)

        dependency.add_done_callback(continue_submission)

    def status(self) -> ExecutionStatus:
        with self._lock:
            pools = dict(self._pools)
            records = dict(self._threads)
            failures = tuple(self._monitored_failures)
            lifecycle = self._lifecycle
        pool_statuses = {name: pool.status() for name, pool in pools.items()}
        threads = {name: self._thread_snapshot(record) for name, record in records.items()}
        registered_names = {record.thread.name for record in records.values() if record.thread is not None}
        unregistered = tuple(sorted(thread.name for thread in threading.enumerate() if thread.name not in registered_names))
        healthy = lifecycle is ExecutionLifecycle.running and all(status.uncaught_exception is None for status in threads.values())
        return ExecutionStatus(
            lifecycle=lifecycle,
            healthy=healthy,
            pools=dict(freeze_mapping(pool_statuses)),
            threads=dict(freeze_mapping(threads)),
            monitored_failures=failures,
            unregistered_threads=unregistered,
        )

    def shutdown(self, *, timeout: float) -> ShutdownStatus:
        if timeout <= 0:
            raise ValueError("shutdown timeout must be positive")
        with self._lock:
            if self._lifecycle is ExecutionLifecycle.stopped:
                return ShutdownStatus(
                    lifecycle=ExecutionLifecycle.stopped,
                    complete=True,
                    incomplete_threads=(),
                    incomplete_pools=(),
                )
            self._lifecycle = ExecutionLifecycle.stopping
        deadline = time.monotonic() + timeout
        incomplete_threads: list[ConcurrentThreads] = []
        records = sorted(self._threads.values(), key=lambda item: item.stage, reverse=True)
        for record in records:
            if not self._stop_record(record, deadline):
                incomplete_threads.append(record.thread_name)
        incomplete_pools: list[ConcurrentPools] = []
        for pool_name, pool in self._pools.items():
            if not pool.close(deadline):
                incomplete_pools.append(pool_name)
        with self._lock:
            self._lifecycle = ExecutionLifecycle.stopped
        return ShutdownStatus(
            lifecycle=ExecutionLifecycle.stopped,
            complete=not incomplete_threads and not incomplete_pools,
            incomplete_threads=tuple(incomplete_threads),
            incomplete_pools=tuple(incomplete_pools),
        )


class FutureCancelledError(RuntimeError):
    """Internal failure representation for monitored cancellation."""


execution_manager = ExecutionManager(config.backend.concurrency.failure_history_size)
