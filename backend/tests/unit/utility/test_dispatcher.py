# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for the protocol-based dispatch matching in utility/dispatcher.py."""

from concurrent.futures import Future
from typing import Callable, cast

import pytest

from forecastbox.utility.config import ConcurrentPools, DispatcherSettings
from forecastbox.utility.dispatcher import (
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
