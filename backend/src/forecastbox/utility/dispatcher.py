# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Process-local event dispatcher with bounded intake."""

import asyncio
import inspect
import threading
import time
from collections import deque
from collections.abc import Callable, Mapping
from concurrent.futures import Future
from dataclasses import dataclass
from functools import partial
from queue import Empty, Full, Queue
from typing import Any, NewType, cast

from forecastbox.utility.concurrency.manager import (
    ExecutionManager,
    StatusModel,
    TaskName,
    execution_manager,
)
from forecastbox.utility.config import ConcurrentPools, DispatcherSettings, config
from forecastbox.utility.structural import freeze_recursively

EventName = NewType("EventName", str)


class DispatcherError(RuntimeError):
    """Base class for dispatcher errors."""


class DispatcherNotRunning(DispatcherError):
    """Raised when event intake is not available."""


class DispatcherQueueFull(DispatcherError):
    """Raised when bounded event intake is full."""


class DispatcherClosed(DispatcherError):
    """Raised when event intake has been permanently closed."""


class DispatcherRegistrationError(DispatcherError):
    """Raised for invalid dispatcher registrations."""


@dataclass(frozen=True, eq=True, slots=True)
class Event:
    """An event payload containing stable plain data, never runtime resources."""

    name: EventName
    kwargs: Mapping[str, object]

    def __post_init__(self) -> None:
        object.__setattr__(self, "kwargs", freeze_recursively(dict(self.kwargs)))


@dataclass(frozen=True, eq=True, slots=True)
class DispatcherRegistration:
    handler_id: str
    event_name: EventName
    pool_name: ConcurrentPools
    handler: Callable[[Event], None]


@dataclass(frozen=True, eq=True, slots=True)
class DispatchResult:
    event_name: EventName
    handler_count: int
    failed_handlers: tuple[str, ...] = ()

    @property
    def succeeded(self) -> bool:
        return not self.failed_handlers


class AggregateDispatchError(DispatcherError):
    """Raised after all handlers for an event have had an opportunity to run."""

    def __init__(self, result: DispatchResult) -> None:
        self.result = result
        super().__init__(f"handlers failed for event {result.event_name}: {', '.join(result.failed_handlers)}")


class DispatcherStatus(StatusModel):
    state: str
    accepting: bool
    running: bool
    stopping: bool
    queue_capacity: int
    queue_depth: int
    submitted: int
    dispatched: int
    completed: int
    failed: int
    handler_counts_by_event: Mapping[EventName, int]
    in_flight_handlers: int
    queue_failures: tuple[str, ...]
    aggregate_failures: tuple[str, ...]

    def is_ready(self) -> bool:
        return self.running


@dataclass
class _QueuedEvent:
    event: Event
    receipt: Future[DispatchResult]


_SENTINEL = object()


class EventDispatcher:
    """Owns registration, queueing, and dispatch for one process-local runtime."""

    def __init__(self, manager: ExecutionManager, settings: DispatcherSettings) -> None:
        self.manager = manager
        self.settings = settings
        self._queue: Queue[_QueuedEvent | object] = Queue(maxsize=settings.queue_capacity)
        self._lock = threading.RLock()
        self._registrations: dict[str, DispatcherRegistration] = {}
        self._frozen = False
        self._state = "new"
        self._stop_event: threading.Event | None = None
        self._drain_deadline: float | None = None
        self._submitted = 0
        self._dispatched = 0
        self._completed = 0
        self._failed = 0
        self._in_flight_handlers = 0
        self._handler_counts: dict[EventName, int] = {}
        self._queue_failures: deque[str] = deque(maxlen=100)
        self._aggregate_failures: deque[str] = deque(maxlen=100)

    def register(self, registration: DispatcherRegistration) -> None:
        if not isinstance(registration, DispatcherRegistration):
            raise DispatcherRegistrationError("malformed dispatcher registration")
        if not registration.handler_id or not isinstance(registration.event_name, str):
            raise DispatcherRegistrationError("dispatcher registrations require an id and event name")
        if not isinstance(registration.pool_name, ConcurrentPools):
            raise DispatcherRegistrationError("dispatcher registration has an unknown pool")
        if not callable(registration.handler) or inspect.iscoroutinefunction(registration.handler):
            raise DispatcherRegistrationError("dispatcher handlers must be synchronous callables")
        with self._lock:
            if self._frozen or self._state != "new":
                raise DispatcherRegistrationError("dispatcher registration is closed")
            if registration.handler_id in self._registrations:
                raise DispatcherRegistrationError(f"duplicate dispatcher handler id: {registration.handler_id}")
            self._registrations[registration.handler_id] = registration

    def freeze(self) -> None:
        with self._lock:
            if self._state != "new":
                raise DispatcherRegistrationError("dispatcher registration is closed")
            self._frozen = True

    def submit(self, event: Event) -> Future[DispatchResult]:
        if not isinstance(event, Event):
            raise DispatcherError("events must use the Event contract")
        receipt: Future[DispatchResult] = Future()
        with self._lock:
            if self._state == "new":
                raise DispatcherNotRunning("event dispatcher has not started")
            if not self._accepting():
                raise DispatcherClosed("event dispatcher intake is closed")
            try:
                self._queue.put_nowait(_QueuedEvent(event, receipt))
            except Full as error:
                self._queue_failures.append(f"queue full for event {event.name}")
                raise DispatcherQueueFull("event dispatcher queue is full") from error
            self._submitted += 1
            self._handler_counts[event.name] = sum(reg.event_name == event.name for reg in self._registrations.values())
        return receipt

    def _accepting(self) -> bool:
        return self._state == "running" and self._frozen

    async def async_submit(self, event: Event) -> DispatchResult:
        receipt = self.submit(event)
        return await asyncio.wrap_future(receipt)

    def _dispatch(self, queued: _QueuedEvent) -> None:
        event = queued.event
        with self._lock:
            registrations = tuple(registration for registration in self._registrations.values() if registration.event_name == event.name)
            self._in_flight_handlers += len(registrations)
            self._dispatched += len(registrations)

        failures: list[str] = []
        futures: list[tuple[str, Future[object]]] = []
        for registration in registrations:
            try:
                handler_task = partial(registration.handler, event)
                future = self.manager._submit_monitored_receipt(
                    registration.pool_name,
                    TaskName(f"dispatch:{registration.handler_id}"),
                    handler_task,
                )
                futures.append((registration.handler_id, cast(Future[object], future)))
            except BaseException as error:
                failures.append(registration.handler_id)
                with self._lock:
                    self._aggregate_failures.append(f"{registration.handler_id}: {error!r}")

        for handler_id, future in futures:
            try:
                future.result()
            except BaseException as error:
                failures.append(handler_id)
                with self._lock:
                    self._aggregate_failures.append(f"{handler_id}: {error!r}")

        result = DispatchResult(event.name, len(registrations), tuple(failures))
        with self._lock:
            self._in_flight_handlers -= len(registrations)
            if failures:
                self._failed += 1
            else:
                self._completed += 1
        if failures:
            queued.receipt.set_exception(AggregateDispatchError(result))
        else:
            queued.receipt.set_result(result)

    def entrypoint(self, stop_event: threading.Event) -> None:
        with self._lock:
            self._stop_event = stop_event
            self._state = "running"
        while True:
            try:
                item = self._queue.get(timeout=0.05)
            except Empty:
                if stop_event.is_set() and self._queue.empty():
                    break
                continue
            try:
                if item is _SENTINEL:
                    if stop_event.is_set():
                        while not self._queue.empty() and (self._drain_deadline is None or time.monotonic() < self._drain_deadline):
                            try:
                                queued = cast(_QueuedEvent, self._queue.get_nowait())
                            except Empty:
                                break
                            try:
                                self._dispatch(queued)
                            finally:
                                self._queue.task_done()
                        break
                    continue
                self._dispatch(cast(_QueuedEvent, item))
            finally:
                self._queue.task_done()
        with self._lock:
            self._state = "stopped"
            self._stop_event = None

    def request_stop(self, timeout: float) -> None:
        with self._lock:
            if self._state in {"stopped", "new"}:
                return
            self._state = "stopping"
            self._drain_deadline = time.monotonic() + max(timeout, 0)
            try:
                self._queue.put_nowait(_SENTINEL)
            except Full:
                self._queue_failures.append("unable to enqueue dispatcher stop sentinel")

    def status(self) -> DispatcherStatus:
        with self._lock:
            state = self._state
            return DispatcherStatus(
                state=state,
                accepting=self._accepting(),
                running=state == "running",
                stopping=state == "stopping",
                queue_capacity=self.settings.queue_capacity,
                queue_depth=self._queue.qsize(),
                submitted=self._submitted,
                dispatched=self._dispatched,
                completed=self._completed,
                failed=self._failed,
                handler_counts_by_event=dict(self._handler_counts),
                in_flight_handlers=self._in_flight_handlers,
                queue_failures=tuple(self._queue_failures),
                aggregate_failures=tuple(self._aggregate_failures),
            )


_dispatcher = EventDispatcher(execution_manager, config.backend.dispatcher)


def _current_dispatcher() -> EventDispatcher:
    global _dispatcher
    if _dispatcher.manager is not execution_manager:
        _dispatcher = EventDispatcher(execution_manager, config.backend.dispatcher)
    return _dispatcher


def register_dispatcher(registration: DispatcherRegistration) -> None:
    _current_dispatcher().register(registration)


def freeze_registration() -> None:
    _current_dispatcher().freeze()


def submit_event(event: Event) -> Future[DispatchResult]:
    return _current_dispatcher().submit(event)


async def async_submit_event(event: Event) -> DispatchResult:
    return await _current_dispatcher().async_submit(event)


def event_dispatcher_entrypoint(stop_event: threading.Event) -> None:
    _current_dispatcher().entrypoint(stop_event)


def stop_request(timeout: float) -> None:
    _current_dispatcher().request_stop(timeout)


def status() -> DispatcherStatus:
    return _current_dispatcher().status()
