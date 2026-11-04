# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for the listener control interface."""

import dataclasses
import datetime as dt
from collections.abc import Generator

import pytest

from forecastbox.domain.experiment.triggers import control


@pytest.fixture(autouse=True)
def clean_registration() -> Generator[None, None, None]:
    control.unregister()
    yield
    control.unregister()


def test_defaults() -> None:
    status = control.ListenerStatus(state="starting")
    assert status.message is None
    assert status.active_triggers == 0
    assert status.last_event_at is None
    assert status.last_error is None
    with pytest.raises(dataclasses.FrozenInstanceError):
        status.state = "listening"  # ty:ignore[invalid-assignment]


def test_nothing_registered() -> None:
    control.prod_listener()
    status = control.listener_status()
    assert status.state == "disabled"
    assert status.active_triggers == 0


def test_register_prod_and_status() -> None:
    calls: list[int] = []
    last = dt.datetime(2026, 11, 3, tzinfo=dt.UTC)
    expected = control.ListenerStatus(state="listening", active_triggers=2, last_event_at=last)
    control.register(lambda: calls.append(1), lambda: expected)
    control.prod_listener()
    control.prod_listener()
    assert calls == [1, 1]
    assert control.listener_status() == expected


def test_unregister() -> None:
    calls: list[int] = []
    control.register(lambda: calls.append(1), lambda: control.ListenerStatus(state="listening"))
    control.unregister()
    control.prod_listener()
    assert calls == []
    assert control.listener_status().state == "disabled"


def test_register_replaces() -> None:
    calls: list[str] = []
    control.register(lambda: calls.append("old"), lambda: control.ListenerStatus(state="starting"))
    control.register(lambda: calls.append("new"), lambda: control.ListenerStatus(state="listening"))
    control.prod_listener()
    assert calls == ["new"]
    assert control.listener_status().state == "listening"


def test_prod_exception_is_swallowed(caplog: pytest.LogCaptureFixture) -> None:
    def failing() -> None:
        raise RuntimeError("boom")

    control.register(failing, lambda: control.ListenerStatus(state="listening"))
    control.prod_listener()
    assert "prodding the trigger listener failed" in caplog.text


def test_status_exception_gives_unavailable() -> None:
    def failing() -> control.ListenerStatus:
        raise RuntimeError("boom")

    control.register(lambda: None, failing)
    status = control.listener_status()
    assert status.state == "unavailable"
    assert status.last_error == "RuntimeError: boom"
