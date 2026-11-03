# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for the Aviso listener thread, with a fake client and one test against pyaviso."""

import dataclasses
import datetime as dt
import logging
import queue
import socket
import threading
import time
from collections.abc import Callable, Generator, Mapping
from concurrent.futures import Future
from dataclasses import dataclass, field
from typing import Any, cast
from unittest.mock import MagicMock

import pytest

import forecastbox.entrypoint.initializers as initializers
from forecastbox.domain.experiment.triggers import control, listener
from forecastbox.domain.experiment.triggers.db import ActiveTrigger
from forecastbox.domain.experiment.triggers.listener import AvisoListener, NotificationStream
from forecastbox.domain.experiment.triggers.service import HandleResult
from forecastbox.domain.experiment.triggers.spec import AvisoEvent, TriggerSpec, replay_start
from forecastbox.domain.experiment.types import ExperimentDefinitionId
from forecastbox.utility.config import AvisoSettings, ConcurrentThreads, config

NOW = dt.datetime(2026, 11, 3, 12, 0, tzinfo=dt.UTC)
CREATED = dt.datetime(2026, 11, 3, 8, 0, tzinfo=dt.UTC)
EXIT_TIMEOUT = 5.0


@dataclass
class FakeNotification:
    event_type: str = "mars"
    sequence: int = 1
    identifier: dict[str, Any] = field(default_factory=lambda: {"date": "20261103"})
    payload: Any = None
    cloudevent: dict[str, Any] | None = None


class FakeGapError(Exception):
    listener: str | None = None


_END = object()


class FakeStream:
    """Blocks in iteration until an item is pushed, an error is raised, or it is closed."""

    def __init__(self) -> None:
        self._queue: queue.Queue[object] = queue.Queue()
        self.closed = threading.Event()

    def push(self, name: str, notification: FakeNotification) -> None:
        self._queue.put((name, notification))

    def fail(self, error: Exception) -> None:
        self._queue.put(error)

    def __iter__(self) -> "FakeStream":
        return self

    def __next__(self) -> tuple[str, FakeNotification]:
        item = self._queue.get()
        if item is _END:
            raise StopIteration
        if isinstance(item, Exception):
            raise item
        return cast(tuple[str, FakeNotification], item)

    def close(self) -> None:
        self.closed.set()
        self._queue.put(_END)


class FakeClient:
    def __init__(self) -> None:
        self.calls: list[dict[str, dict[str, Any]]] = []
        self.streams: list[FakeStream] = []
        self.created = 0

    def __call__(self) -> "FakeClient":
        self.created += 1
        return self

    def listen_many(self, listeners: Mapping[str, Mapping[str, Any]], *, on_error: str) -> NotificationStream:
        assert on_error == "raise"
        stream = FakeStream()
        self.calls.append({name: dict(entry) for name, entry in listeners.items()})
        self.streams.append(stream)
        return stream  # ty:ignore[invalid-return-type]


def wait_until(predicate: Callable[[], bool], timeout: float = EXIT_TIMEOUT) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.01)
    raise AssertionError("condition not reached in time")


def make_trigger(experiment_id: str, **spec: Any) -> ActiveTrigger:
    spec.setdefault("event_type", "mars")
    return ActiveTrigger(
        experiment_id=ExperimentDefinitionId(experiment_id),
        version=1,
        created_by="user",
        created_at=CREATED,
        blueprint_id="bp",  # ty:ignore[invalid-argument-type]
        blueprint_version=1,
        spec=TriggerSpec.model_validate(spec),
    )


def done_future() -> "Future[None]":
    future: "Future[None]" = Future()
    future.set_result(None)
    return future


class Harness:
    """Runs a listener on a thread, mirroring how the manager sets the stop event first and then
    calls the stop request."""

    def __init__(self, backoff: int = 30, prerequisites: tuple["Future[None]", ...] | None = None, with_client: bool = True) -> None:
        self.client = FakeClient()
        self.triggers: list[ActiveTrigger] = []
        self.handled: list[tuple[str, AvisoEvent]] = []
        self.stop_event = threading.Event()
        self.listener = AvisoListener(
            AvisoSettings(enabled=True, reconnect_backoff_seconds=backoff),
            prerequisites if prerequisites is not None else (done_future(),),
            client_factory=self.client if with_client else None,
            history_gap_error=FakeGapError,
        )
        self.thread = threading.Thread(target=self.listener.entrypoint, args=(self.stop_event,), daemon=True)

    def handle(self, experiment_id: str, event: AvisoEvent) -> HandleResult:
        self.handled.append((experiment_id, event))
        return HandleResult(status="submitted", run_id="run")

    def start(self) -> None:
        self.thread.start()

    def stop(self) -> None:
        self.stop_event.set()
        self.listener.request_stop(EXIT_TIMEOUT)
        self.thread.join(EXIT_TIMEOUT)
        assert not self.thread.is_alive(), "listener thread did not exit"

    def state(self) -> str:
        return self.listener.status().state


@pytest.fixture
def harness(monkeypatch: pytest.MonkeyPatch) -> Generator[Harness, None, None]:
    control.unregister()
    h = Harness()
    monkeypatch.setattr(listener, "list_active_triggers", lambda: list(h.triggers))
    monkeypatch.setattr(listener, "handle_event", h.handle)
    monkeypatch.setattr(listener, "current_time", lambda reason: NOW)
    yield h
    h.stop_event.set()
    h.listener.request_stop(EXIT_TIMEOUT)
    if h.thread.is_alive():
        h.thread.join(EXIT_TIMEOUT)
    control.unregister()


# ----- registration


def test_disabled_registers_nothing_and_never_imports(monkeypatch: pytest.MonkeyPatch) -> None:
    manager = MagicMock()
    imports = MagicMock()
    monkeypatch.setattr(initializers, "execution_manager", manager)
    monkeypatch.setattr(listener, "try_import", imports)
    monkeypatch.setattr(config.aviso, "enabled", False)
    initializers._register_aviso_listener()
    manager.register_thread.assert_not_called()
    imports.assert_not_called()


def test_enabled_registers_with_prerequisites(monkeypatch: pytest.MonkeyPatch) -> None:
    manager = MagicMock()
    imports = MagicMock()
    monkeypatch.setattr(initializers, "execution_manager", manager)
    monkeypatch.setattr(listener, "try_import", imports)
    monkeypatch.setattr(config.aviso, "enabled", True)
    initializers._register_aviso_listener()
    manager.register_thread.assert_called_once()
    args, kwargs = manager.register_thread.call_args
    assert args[0] is ConcurrentThreads.AvisoListener
    registered = kwargs["status_provider"].__self__
    assert isinstance(registered, AvisoListener)
    assert registered._prerequisites == (initializers.PluginsCatalogInitialized, initializers.GatewayInitialized)
    assert kwargs["status_provider"]().is_ready()
    assert kwargs["stop_request"] == registered.request_stop
    # nothing is imported at registration
    imports.assert_not_called()


def test_pyaviso_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    control.unregister()
    monkeypatch.setattr(listener, "try_import", lambda name: None)
    h = Harness(with_client=False)
    h.start()
    try:
        wait_until(lambda: h.state() == "unavailable")
        status = control.listener_status()
        assert status.state == "unavailable"
        assert status.message == "pyaviso not installed"
        assert h.listener.component_status().is_ready()
    finally:
        h.stop()
    assert control.listener_status().state == "disabled"


def test_registers_into_control_and_unregisters(harness: Harness) -> None:
    harness.start()
    wait_until(lambda: control.listener_status().state == "listening")
    harness.stop()
    assert control.listener_status().state == "disabled"
    assert harness.state() == "stopped"


# ----- loop


def test_dispatch_and_replay(harness: Harness) -> None:
    harness.triggers = [
        make_trigger("e1", filter={"class": "od"}, max_acceptable_delay_hours=2),
        make_trigger("e2", event_type="dissemination"),
        make_trigger("off", enabled=False),
    ]
    harness.start()
    wait_until(lambda: len(harness.client.calls) == 1)
    wait_until(lambda: harness.state() == "listening")
    first = harness.client.calls[0]
    assert set(first) == {"e1", "e2"}
    e1_spec = harness.triggers[0].spec
    assert first["e1"] == {
        "event_type": "mars",
        "filter": {"class": "od"},
        "start_from": replay_start(e1_spec, CREATED, NOW).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    assert first["e1"]["start_from"] == "2026-11-03T10:00:00Z"
    assert first["e2"]["event_type"] == "dissemination"
    assert "filter" not in first["e2"]
    assert harness.listener.status().active_triggers == 2

    harness.client.streams[0].push(
        "e1",
        FakeNotification(
            sequence=7, identifier={"date": "20261103", "step": 6}, payload={"a": 1}, cloudevent={"time": "2026-11-03T11:30:00Z"}
        ),
    )
    harness.client.streams[0].push("e2", FakeNotification(event_type="dissemination", sequence=8, payload="text"))
    wait_until(lambda: len(harness.handled) == 2)
    (id1, ev1), (id2, ev2) = harness.handled
    assert id1 == "e1"
    assert ev1 == AvisoEvent(
        source="aviso",
        event_type="mars",
        sequence=7,
        identifier={"date": "20261103", "step": 6},
        payload={"a": 1},
        published_at=dt.datetime(2026, 11, 3, 11, 30, tzinfo=dt.UTC),
    )
    assert id2 == "e2"
    assert ev2.payload is None
    assert ev2.published_at == NOW
    assert harness.listener.status().last_event_at == NOW
    harness.stop()


def test_unknown_name_and_conversion_error_are_skipped(harness: Harness) -> None:
    harness.triggers = [make_trigger("e1")]
    harness.start()
    wait_until(lambda: len(harness.client.calls) == 1)
    stream = harness.client.streams[0]
    stream.push("other", FakeNotification())
    stream.push("e1", FakeNotification(sequence="bad"))  # ty:ignore[invalid-argument-type]
    stream.push("e1", FakeNotification(sequence=2))
    wait_until(lambda: len(harness.handled) == 1)
    assert harness.handled[0][1].sequence == 2
    assert harness.state() == "listening"
    harness.stop()


def test_no_triggers_waits_and_prod_reloads(harness: Harness) -> None:
    harness.start()
    wait_until(lambda: harness.listener.status().message == "no enabled triggers")
    assert harness.state() == "listening"
    assert harness.client.calls == []
    assert harness.client.created == 0
    harness.triggers = [make_trigger("e1")]
    control.prod_listener()
    wait_until(lambda: len(harness.client.calls) == 1)
    assert set(harness.client.calls[0]) == {"e1"}
    harness.stop()


def test_prod_reloads_triggers(harness: Harness) -> None:
    harness.triggers = [make_trigger("e1")]
    harness.start()
    wait_until(lambda: len(harness.client.calls) == 1)
    harness.triggers = [make_trigger("e1"), make_trigger("e2")]
    control.prod_listener()
    wait_until(lambda: len(harness.client.calls) == 2)
    assert harness.client.streams[0].closed.is_set()
    assert set(harness.client.calls[1]) == {"e1", "e2"}
    wait_until(lambda: harness.listener.status().active_triggers == 2)
    assert harness.state() == "listening"
    harness.stop()


def test_error_backs_off_and_rebuilds(harness: Harness) -> None:
    harness.listener._settings = AvisoSettings(enabled=True, reconnect_backoff_seconds=1)
    harness.triggers = [make_trigger("e1")]
    harness.start()
    wait_until(lambda: len(harness.client.calls) == 1)
    harness.client.streams[0].fail(RuntimeError("boom"))
    wait_until(lambda: harness.state() == "backoff")
    status = harness.listener.status()
    assert status.last_error == "RuntimeError: boom"
    assert len(harness.client.calls) == 1
    wait_until(lambda: len(harness.client.calls) == 2)
    wait_until(lambda: harness.state() == "listening")
    assert harness.client.calls[1] == harness.client.calls[0]
    harness.stop()


def test_stream_end_backs_off(harness: Harness) -> None:
    harness.listener._settings = AvisoSettings(enabled=True, reconnect_backoff_seconds=1)
    harness.triggers = [make_trigger("e1")]
    harness.start()
    wait_until(lambda: len(harness.client.calls) == 1)
    harness.client.streams[0].close()
    wait_until(lambda: harness.state() == "backoff")
    wait_until(lambda: len(harness.client.calls) == 2)
    harness.stop()


def test_factory_failure_backs_off(harness: Harness) -> None:
    def failing() -> Any:
        raise RuntimeError("no base url")

    harness.listener._client_factory = failing
    harness.triggers = [make_trigger("e1")]
    harness.start()
    wait_until(lambda: harness.state() == "backoff")
    assert harness.listener.status().last_error == "RuntimeError: no base url"
    harness.stop()


def test_stop_during_backoff(harness: Harness) -> None:
    harness.triggers = [make_trigger("e1")]
    harness.start()
    wait_until(lambda: len(harness.client.calls) == 1)
    harness.client.streams[0].fail(RuntimeError("boom"))
    wait_until(lambda: harness.state() == "backoff")
    start = time.monotonic()
    harness.stop()
    assert time.monotonic() - start < EXIT_TIMEOUT


def test_history_gap_reopens_one_trigger_at_live_edge(harness: Harness) -> None:
    harness.triggers = [make_trigger("e1"), make_trigger("e2")]
    harness.start()
    wait_until(lambda: len(harness.client.calls) == 1)
    assert "start_from" in harness.client.calls[0]["e1"]
    gap = FakeGapError("history too old")
    gap.listener = "e1"
    harness.client.streams[0].fail(gap)
    # the 30 s backoff would time out this wait, so the reopening is immediate
    wait_until(lambda: len(harness.client.calls) == 2)
    assert "start_from" not in harness.client.calls[1]["e1"]
    assert "start_from" in harness.client.calls[1]["e2"]
    wait_until(lambda: harness.state() == "listening")
    assert harness.listener.status().last_error == "FakeGapError: history too old"
    # the live edge is kept for later builds
    control.prod_listener()
    wait_until(lambda: len(harness.client.calls) == 3)
    assert "start_from" not in harness.client.calls[2]["e1"]
    assert "start_from" in harness.client.calls[2]["e2"]
    harness.stop()


def test_two_history_gaps_accumulate_at_the_live_edge(harness: Harness) -> None:
    harness.triggers = [make_trigger("e1"), make_trigger("e2")]
    harness.start()
    wait_until(lambda: len(harness.client.calls) == 1)
    for index, name in enumerate(("e1", "e2")):
        gap = FakeGapError(f"gap {name}")
        gap.listener = name
        harness.client.streams[index].fail(gap)
        wait_until(lambda: len(harness.client.calls) == index + 2)
    assert "start_from" not in harness.client.calls[1]["e1"]
    assert "start_from" in harness.client.calls[1]["e2"]
    # both triggers stay at the live edge, and the stream is not rebuilt in a loop
    assert all("start_from" not in entry for entry in harness.client.calls[2].values())
    wait_until(lambda: harness.state() == "listening")
    time.sleep(0.3)
    assert len(harness.client.calls) == 3
    # the live edge survives a reload, an unchanged version keeping it
    control.prod_listener()
    wait_until(lambda: len(harness.client.calls) == 4)
    assert all("start_from" not in entry for entry in harness.client.calls[3].values())
    harness.stop()


def test_live_edge_dropped_when_version_changes(harness: Harness) -> None:
    harness.triggers = [make_trigger("e1"), make_trigger("e2")]
    harness.start()
    wait_until(lambda: len(harness.client.calls) == 1)
    gap = FakeGapError("gap")
    gap.listener = "e1"
    harness.client.streams[0].fail(gap)
    wait_until(lambda: len(harness.client.calls) == 2)
    assert "start_from" not in harness.client.calls[1]["e1"]
    updated = dataclasses.replace(harness.triggers[0], version=2)
    harness.triggers = [updated, harness.triggers[1]]
    control.prod_listener()
    wait_until(lambda: len(harness.client.calls) == 3)
    assert "start_from" in harness.client.calls[2]["e1"]
    harness.stop()


def test_live_edge_dropped_when_trigger_inactive(harness: Harness) -> None:
    harness.triggers = [make_trigger("e1")]
    harness.start()
    wait_until(lambda: len(harness.client.calls) == 1)
    gap = FakeGapError("gap")
    gap.listener = "e1"
    harness.client.streams[0].fail(gap)
    wait_until(lambda: len(harness.client.calls) == 2)
    harness.triggers = []
    control.prod_listener()
    wait_until(lambda: harness.listener.status().message == "no enabled triggers")
    harness.triggers = [make_trigger("e1")]
    control.prod_listener()
    wait_until(lambda: len(harness.client.calls) == 3)
    assert "start_from" in harness.client.calls[2]["e1"]
    harness.stop()


def test_missing_cloudevent_time_warns_once_per_trigger(harness: Harness, caplog: pytest.LogCaptureFixture) -> None:
    harness.triggers = [make_trigger("e1"), make_trigger("e2")]
    harness.start()
    wait_until(lambda: len(harness.client.calls) == 1)
    stream = harness.client.streams[0]
    with caplog.at_level(logging.WARNING, logger=listener.logger.name):
        stream.push("e1", FakeNotification(sequence=1))
        stream.push("e1", FakeNotification(sequence=2, cloudevent={"time": "not a time"}))
        stream.push("e1", FakeNotification(sequence=3, cloudevent={"time": "2026-11-03T11:30:00Z"}))
        stream.push("e2", FakeNotification(sequence=4, cloudevent={"id": "x"}))
        wait_until(lambda: len(harness.handled) == 4)
    warnings = [r.getMessage() for r in caplog.records if "no valid CloudEvent time" in r.getMessage()]
    assert len(warnings) == 2
    assert "trigger e1" in warnings[0]
    assert "trigger e2" in warnings[1]
    assert "stale protection does not apply" in warnings[0]
    harness.stop()


def test_history_gap_at_live_edge_backs_off(harness: Harness) -> None:
    harness.triggers = [make_trigger("e1")]
    harness.start()
    wait_until(lambda: len(harness.client.calls) == 1)
    gap = FakeGapError("gap")
    gap.listener = "e1"
    harness.client.streams[0].fail(gap)
    wait_until(lambda: len(harness.client.calls) == 2)
    again = FakeGapError("gap again")
    again.listener = "e1"
    harness.client.streams[1].fail(again)
    wait_until(lambda: harness.state() == "backoff")
    assert len(harness.client.calls) == 2
    harness.stop()


def test_stop_during_prerequisite_wait(harness: Harness) -> None:
    pending: "Future[None]" = Future()
    other = Harness(prerequisites=(done_future(), pending))
    other.client = harness.client
    other.listener._client_factory = harness.client
    other.start()
    try:
        wait_until(lambda: other.state() == "waiting_prerequisites")
        assert harness.client.calls == []
        start = time.monotonic()
        other.stop()
        assert time.monotonic() - start < EXIT_TIMEOUT
    finally:
        pending.set_result(None)
    assert harness.client.calls == []


def test_listens_once_prerequisites_resolve(harness: Harness) -> None:
    pending: "Future[None]" = Future()
    other = Harness(prerequisites=(pending,))
    other.listener._client_factory = harness.client
    harness.triggers = [make_trigger("e1")]
    other.start()
    wait_until(lambda: other.state() == "waiting_prerequisites")
    assert harness.client.calls == []
    pending.set_result(None)
    wait_until(lambda: len(harness.client.calls) == 1)
    other.stop()


def test_failed_prerequisite_is_unavailable(harness: Harness) -> None:
    failed: "Future[None]" = Future()
    failed.set_exception(RuntimeError("plugins failed"))
    other = Harness(prerequisites=(failed,))
    other.listener._client_factory = harness.client
    other.start()
    wait_until(lambda: other.state() == "unavailable")
    assert other.listener.status().message == "prerequisites failed"
    assert other.listener.status().last_error == "RuntimeError: plugins failed"
    other.stop()
    assert harness.client.calls == []


def test_stop_while_blocked_waiting_for_notifications(harness: Harness) -> None:
    harness.triggers = [make_trigger("e1")]
    harness.start()
    wait_until(lambda: harness.state() == "listening" and len(harness.client.calls) == 1)
    time.sleep(0.2)
    assert harness.thread.is_alive()
    start = time.monotonic()
    harness.stop()
    assert time.monotonic() - start < EXIT_TIMEOUT
    assert harness.client.streams[0].closed.is_set()


# ----- real pyaviso


def test_real_pyaviso_close_unblocks_iteration(monkeypatch: pytest.MonkeyPatch) -> None:
    """Stopping must unblock a real pyaviso iterator which waits on an open SSE stream."""
    pyaviso = pytest.importorskip("pyaviso")
    control.unregister()
    server = socket.socket()
    server.bind(("127.0.0.1", 0))
    server.listen(8)
    requests: list[bytes] = []
    release = threading.Event()

    def serve(connection: socket.socket) -> None:
        requests.append(connection.recv(65536).split(b"\r\n")[0])
        connection.sendall(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\n\r\n:keepalive\n\n")
        release.wait(30)
        connection.close()

    def accept() -> None:
        while True:
            try:
                connection, _ = server.accept()
            except OSError:
                return
            threading.Thread(target=serve, args=(connection,), daemon=True).start()

    threading.Thread(target=accept, daemon=True).start()
    base_url = f"http://127.0.0.1:{server.getsockname()[1]}"
    monkeypatch.setattr(listener, "list_active_triggers", lambda: [make_trigger("e1")])
    monkeypatch.setattr(listener, "handle_event", lambda *_: HandleResult(status="submitted"))
    real = AvisoListener(
        AvisoSettings(enabled=True, base_url=base_url, reconnect_backoff_seconds=30),
        (done_future(),),
        client_factory=lambda: pyaviso.AvisoClient(base_url=base_url, auth=pyaviso.Anonymous()),
        history_gap_error=pyaviso.HistoryGapError,
    )
    stop_event = threading.Event()
    thread = threading.Thread(target=real.entrypoint, args=(stop_event,), daemon=True)
    thread.start()
    try:
        wait_until(lambda: len(requests) == 1)
        time.sleep(0.3)
        assert thread.is_alive()
        assert real.status().state == "listening"
        start = time.monotonic()
        stop_event.set()
        real.request_stop(EXIT_TIMEOUT)
        thread.join(EXIT_TIMEOUT)
        assert not thread.is_alive(), "closing the real iterator did not unblock the listener thread"
        assert time.monotonic() - start < EXIT_TIMEOUT
    finally:
        release.set()
        server.close()
        stop_event.set()
        real.request_stop(1)
        control.unregister()
