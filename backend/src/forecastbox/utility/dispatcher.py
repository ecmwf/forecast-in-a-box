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
import logging
import threading
import time
from collections import deque
from collections.abc import Callable
from concurrent.futures import CancelledError, Future
from dataclasses import dataclass, field
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

logger = logging.getLogger(__name__)
EventName = NewType("EventName", str)


class DispatcherError(Exception):
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
    """An event payload containing stable plain data, never runtime resources.

    ``name`` is a label kept for observability (logging, status reporting) only -- it plays no
    role in routing. Routing is protocol-based: handlers register a ``handler_type`` (typically a
    runtime_checkable Protocol) and are invoked whenever ``isinstance(payload, handler_type)``.
    """

    name: EventName
    payload: object

    def __post_init__(self) -> None:
        object.__setattr__(self, "payload", freeze_recursively(self.payload))


@dataclass(frozen=True, eq=True, slots=True)
class DispatcherRegistration:
    handler_id: str
    handler_type: type
    pool_name: ConcurrentPools
    handler: Callable[[Event], None]


@dataclass(frozen=True, eq=True, slots=True)
class DispatchResult:
    event_name: EventName
    matched_handlers: tuple[str, ...] = ()
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
    in_flight_handlers: int
    queue_failures: tuple[str, ...]
    aggregate_failures: tuple[str, ...]

    def is_ready(self) -> bool:
        return self.running


@dataclass
class _QueuedEvent:
    event: Event
    receipt: Future[DispatchResult]


@dataclass
class _Aggregation:
    remaining: int
    failed: list[str] = field(default_factory=list)
    lock: threading.Lock = field(default_factory=threading.Lock)


_SENTINEL = object()


class EventDispatcher:
    """Owns registration, queueing, and dispatch for one process-local runtime.

    Dequeue order is FIFO and the handlers of one event are submitted in registration order. The
    dispatcher thread never waits for handlers: handler execution and completion order across events
    is not guaranteed, and a receipt resolves from the pool thread that finishes the last handler.
    """

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
        self._queue_failures: deque[str] = deque(maxlen=100)
        self._aggregate_failures: deque[str] = deque(maxlen=100)

    def register(self, registration: DispatcherRegistration) -> None:
        if not isinstance(registration, DispatcherRegistration):
            raise DispatcherRegistrationError("malformed dispatcher registration")
        if not registration.handler_id or not isinstance(registration.handler_type, type):
            raise DispatcherRegistrationError("dispatcher registrations require an id and a handler type")
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
        return receipt

    def _accepting(self) -> bool:
        return self._state == "running" and self._frozen

    async def async_submit(self, event: Event) -> DispatchResult:
        receipt = self.submit(event)
        return await asyncio.wrap_future(receipt)

    def _dispatch(self, queued: _QueuedEvent) -> None:
        event = queued.event
        with self._lock:
            registrations = tuple(
                registration for registration in self._registrations.values() if isinstance(event.payload, registration.handler_type)
            )
            self._in_flight_handlers += len(registrations)
            self._dispatched += len(registrations)

        if not registrations:
            with self._lock:
                self._completed += 1
            queued.receipt.set_result(DispatchResult(event.name, (), ()))
            return

        aggregation = _Aggregation(remaining=len(registrations))
        for registration in registrations:
            try:
                handler_task = partial(registration.handler, event)
                future = self.manager._submit_monitored_receipt(
                    registration.pool_name,
                    TaskName(f"dispatch:{registration.handler_id}"),
                    handler_task,
                )
            except BaseException as error:
                failed_future: Future[object] = Future()
                failed_future.set_exception(error)
                self._handler_done(queued, registrations, aggregation, registration.handler_id, failed_future)
                continue
            cast(Future[object], future).add_done_callback(
                partial(self._handler_done, queued, registrations, aggregation, registration.handler_id)
            )

    def _handler_done(
        self,
        queued: _QueuedEvent,
        registrations: tuple[DispatcherRegistration, ...],
        aggregation: "_Aggregation",
        handler_id: str,
        future: Future[object],
    ) -> None:
        error: BaseException | None = None
        if future.cancelled():
            error = CancelledError()
        else:
            error = future.exception()
        if error is not None:
            with self._lock:
                self._aggregate_failures.append(f"{handler_id}: {error!r}")
        with aggregation.lock:
            if error is not None:
                aggregation.failed.append(handler_id)
            aggregation.remaining -= 1
            last = aggregation.remaining == 0
            failures = tuple(aggregation.failed)
        if not last:
            return
        result = DispatchResult(queued.event.name, tuple(registration.handler_id for registration in registrations), failures)
        with self._lock:
            self._in_flight_handlers -= len(registrations)
            if failures:
                self._failed += 1
            else:
                self._completed += 1
        # NOTE receipt callbacks run arbitrary code, hence no lock is held here
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
        while True:
            try:
                leftover = self._queue.get_nowait()
            except Empty:
                break
            try:
                if leftover is not _SENTINEL:
                    queued_left = cast(_QueuedEvent, leftover)
                    queued_left.receipt.set_exception(DispatcherClosed("event dispatcher stopped before dispatch"))
                    with self._lock:
                        self._queue_failures.append(f"event {queued_left.event.name} not dispatched before stop")
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
                in_flight_handlers=self._in_flight_handlers,
                queue_failures=tuple(self._queue_failures),
                aggregate_failures=tuple(self._aggregate_failures),
            )


_dispatcher = EventDispatcher(execution_manager, config.backend.dispatcher)


def register_dispatcher(registration: DispatcherRegistration) -> None:
    _dispatcher.register(registration)


def freeze_registration() -> None:
    _dispatcher.freeze()


def submit_event(event: Event) -> Future[DispatchResult]:
    return _dispatcher.submit(event)


async def async_submit_event(event: Event) -> DispatchResult:
    return await _dispatcher.async_submit(event)


def event_dispatcher_entrypoint(stop_event: threading.Event) -> None:
    _dispatcher.entrypoint(stop_event)


def stop_request(timeout: float) -> None:
    _dispatcher.request_stop(timeout)


def status() -> DispatcherStatus:
    return _dispatcher.status()
