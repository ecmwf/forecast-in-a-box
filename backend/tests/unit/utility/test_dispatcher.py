# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for the protocol-based dispatch matching in utility/dispatcher.py."""

import threading
from concurrent.futures import Future
from typing import Callable, cast

import pytest

from forecastbox.utility.config import ConcurrentPools, DispatcherSettings
from forecastbox.utility.dispatcher import (
    _SENTINEL,
    AggregateDispatchError,
    DispatcherClosed,
    DispatcherRegistration,
    DispatcherRegistrationError,
    Event,
    EventDispatcher,
    EventName,
    _QueuedEvent,
)


class _FakeManager:
    """Runs handler tasks inline, sidestepping ExecutionManager pool registration entirely."""

    def _submit_monitored_receipt(self, pool_name: object, task_name: object, task: Callable[[], object]) -> Future:
        future: Future = Future()
        try:
            future.set_result(task())
        except BaseException as error:
            future.set_exception(error)
        return future


class _Matching:
    pass


class _NotMatching:
    pass


def _dispatcher() -> EventDispatcher:
    return EventDispatcher(cast(object, _FakeManager()), DispatcherSettings())  # ty: ignore[invalid-argument-type]


def test_register_rejects_non_type_handler_type() -> None:
    dispatcher = _dispatcher()
    with pytest.raises(DispatcherRegistrationError):
        dispatcher.register(
            DispatcherRegistration(
                handler_id="h",
                handler_type=cast(type, "not-a-type"),
                pool_name=ConcurrentPools.General,
                handler=lambda event: None,
            )
        )


def test_dispatch_matches_by_isinstance_not_by_event_name() -> None:
    dispatcher = _dispatcher()
    calls: list[str] = []

    dispatcher.register(
        DispatcherRegistration(
            handler_id="matching",
            handler_type=_Matching,
            pool_name=ConcurrentPools.General,
            handler=lambda event: calls.append("matching"),
        )
    )
    dispatcher.register(
        DispatcherRegistration(
            handler_id="not-matching",
            handler_type=_NotMatching,
            pool_name=ConcurrentPools.General,
            handler=lambda event: calls.append("not-matching"),
        )
    )
    dispatcher.freeze()
    dispatcher._state = "running"  # bypass entrypoint()'s thread startup, this is a whitebox unit test

    event = Event(name=EventName("some.event"), payload=_Matching())
    receipt = dispatcher.submit(event)
    dispatcher._dispatch(cast(_QueuedEvent, dispatcher._queue.get_nowait()))

    result = receipt.result(timeout=1)
    assert calls == ["matching"]
    assert result.matched_handlers == ("matching",)
    assert result.succeeded


def test_dispatch_records_failed_handlers() -> None:
    dispatcher = _dispatcher()

    def _boom(event: Event) -> None:
        raise ValueError("boom")

    dispatcher.register(
        DispatcherRegistration(
            handler_id="boom",
            handler_type=_Matching,
            pool_name=ConcurrentPools.General,
            handler=_boom,
        )
    )
    dispatcher.freeze()
    dispatcher._state = "running"

    event = Event(name=EventName("some.event"), payload=_Matching())
    receipt = dispatcher.submit(event)
    dispatcher._dispatch(cast(_QueuedEvent, dispatcher._queue.get_nowait()))

    with pytest.raises(Exception):
        receipt.result(timeout=1)


class _PendingManager:
    """Returns pending futures the test completes by hand."""

    def __init__(self, raise_for: set[str] | None = None) -> None:
        self.futures: list[Future] = []
        self.raise_for = raise_for or set()

    def _submit_monitored_receipt(self, pool_name: object, task_name: object, task: Callable[[], object]) -> Future:
        if str(task_name) in self.raise_for:
            raise RuntimeError("submit refused")
        future: Future = Future()
        self.futures.append(future)
        return future


def _pending_dispatcher(manager: _PendingManager, n: int = 3) -> tuple[EventDispatcher, Future]:
    dispatcher = EventDispatcher(cast(object, manager), DispatcherSettings())  # ty: ignore[invalid-argument-type]
    for i in range(n):
        dispatcher.register(
            DispatcherRegistration(
                handler_id=f"h{i}", handler_type=_Matching, pool_name=ConcurrentPools.General, handler=lambda event: None
            )
        )
    dispatcher.freeze()
    dispatcher._state = "running"
    receipt = dispatcher.submit(Event(name=EventName("x"), payload=_Matching()))
    dispatcher._dispatch(cast(_QueuedEvent, dispatcher._queue.get_nowait()))
    return dispatcher, receipt


def test_dispatch_does_not_wait_for_pending_handlers() -> None:
    manager = _PendingManager()
    _, receipt = _pending_dispatcher(manager)
    assert len(manager.futures) == 3
    assert not receipt.done()


def test_receipt_resolves_once_after_all_complete_in_any_order() -> None:
    manager = _PendingManager()
    dispatcher, receipt = _pending_dispatcher(manager)
    manager.futures[2].set_result(None)
    manager.futures[0].set_result(None)
    assert not receipt.done()
    manager.futures[1].set_result(None)
    result = receipt.result(timeout=0)
    assert result.matched_handlers == ("h0", "h1", "h2")
    assert result.succeeded
    assert dispatcher.status().completed == 1


def test_one_failing_handler_yields_aggregate_error() -> None:
    manager = _PendingManager()
    dispatcher, receipt = _pending_dispatcher(manager)
    manager.futures[0].set_result(None)
    manager.futures[1].set_exception(ValueError("bad"))
    manager.futures[2].set_result(None)
    with pytest.raises(AggregateDispatchError) as info:
        receipt.result(timeout=0)
    assert info.value.result.failed_handlers == ("h1",)
    assert dispatcher.status().failed == 1
    assert dispatcher.status().in_flight_handlers == 0


def test_submission_failure_counts_as_failed_handler() -> None:
    manager = _PendingManager(raise_for={"dispatch:h1"})
    _, receipt = _pending_dispatcher(manager)
    assert not receipt.done()
    for future in manager.futures:
        future.set_result(None)
    with pytest.raises(AggregateDispatchError) as info:
        receipt.result(timeout=0)
    assert info.value.result.failed_handlers == ("h1",)


def test_queued_envelopes_fail_with_closed_when_entrypoint_exits() -> None:
    dispatcher = _dispatcher()
    dispatcher.freeze()
    dispatcher._state = "running"
    dispatcher._queue.put_nowait(_SENTINEL)
    receipt = dispatcher.submit(Event(name=EventName("x"), payload=_Matching()))
    stop = threading.Event()
    stop.set()
    # drain deadline already passed -> the loop stops at the sentinel without dispatching the envelope behind it
    dispatcher._drain_deadline = 0.0
    dispatcher.entrypoint(stop)
    with pytest.raises(DispatcherClosed):
        receipt.result(timeout=0)
