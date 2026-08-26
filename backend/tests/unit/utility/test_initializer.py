# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for `forecastbox.utility.initializer`."""

import pytest

from forecastbox.utility.initializer import Initializer, Initializers, noop


@pytest.mark.asyncio
async def test_start_and_stop_order() -> None:
    calls: list[str] = []
    initializers = Initializers(
        [
            Initializer("a", start=lambda: calls.append("a.start"), stop=lambda: calls.append("a.stop")),
            Initializer("b", start=lambda: calls.append("b.start"), stop=lambda: calls.append("b.stop")),
            Initializer("c", start=lambda: calls.append("c.start"), stop=lambda: calls.append("c.stop")),
        ]
    )

    await initializers.initialize()
    assert calls == ["a.start", "b.start", "c.start"]

    await initializers.shutdown()
    assert calls == ["a.start", "b.start", "c.start", "c.stop", "b.stop", "a.stop"]


@pytest.mark.asyncio
async def test_defaults_to_noop() -> None:
    initializer = Initializer("noop-both")
    assert initializer.start is noop
    assert initializer.stop is noop

    initializers = Initializers([initializer])
    await initializers.initialize()
    await initializers.shutdown()  # should not raise


@pytest.mark.asyncio
async def test_startup_failure_stops_remaining_steps_and_unwinds_only_started_ones() -> None:
    calls: list[str] = []

    def failing_start() -> None:
        calls.append("b.start")
        raise ValueError("boom")

    initializers = Initializers(
        [
            Initializer("a", start=lambda: calls.append("a.start"), stop=lambda: calls.append("a.stop")),
            Initializer("b", start=failing_start, stop=lambda: calls.append("b.stop")),
            Initializer("c", start=lambda: calls.append("c.start"), stop=lambda: calls.append("c.stop")),
        ]
    )

    with pytest.raises(ValueError, match="boom"):
        await initializers.initialize()

    # "c" never started, so it should not have been attempted
    assert calls == ["a.start", "b.start"]

    await initializers.shutdown()
    # only "a" actually completed its start, "b" raised during start so it's not unwound either
    assert calls == ["a.start", "b.start", "a.stop"]


@pytest.mark.asyncio
async def test_teardown_failure_is_isolated_logged_and_aggregated() -> None:
    calls: list[str] = []

    def failing_stop() -> None:
        calls.append("b.stop")
        raise RuntimeError("teardown boom")

    initializers = Initializers(
        [
            Initializer("a", start=lambda: calls.append("a.start"), stop=lambda: calls.append("a.stop")),
            Initializer("b", start=lambda: calls.append("b.start"), stop=failing_stop),
            Initializer("c", start=lambda: calls.append("c.start"), stop=lambda: calls.append("c.stop")),
        ]
    )

    await initializers.initialize()

    with pytest.raises(ExceptionGroup) as exc_info:
        await initializers.shutdown()

    # all three stops were attempted, despite "b" raising
    assert calls == ["a.start", "b.start", "c.start", "c.stop", "b.stop", "a.stop"]
    assert len(exc_info.value.exceptions) == 1
    assert isinstance(exc_info.value.exceptions[0], RuntimeError)


@pytest.mark.asyncio
async def test_async_start_and_stop_callables_are_awaited() -> None:
    calls: list[str] = []

    async def async_start() -> None:
        calls.append("start")

    async def async_stop() -> None:
        calls.append("stop")

    initializers = Initializers([Initializer("async-step", start=async_start, stop=async_stop)])

    await initializers.initialize()
    assert calls == ["start"]

    await initializers.shutdown()
    assert calls == ["start", "stop"]
