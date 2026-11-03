# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Long-lived thread which turns Aviso notifications into `handle_event` calls.

The thread is registered with the `execution_manager` by the entrypoint, only when
`config.aviso.enabled` is set.  It waits for the prerequisite futures it is given, then opens
one `listen_many` stream with an entry per enabled trigger, keyed by the experiment id, and
passes every notification to `handle_event`.  Each trigger replays from `replay_start`.

Control flow:
 - `control.prod_listener()` closes the stream, and the loop reloads the triggers.
 - A terminal error of the stream is recorded, followed by a wait of
   `reconnect_backoff_seconds` and a rebuild.
 - A `HistoryGapError` of one trigger reopens that trigger at the live edge on the next
   build, without a wait.
 - Every wait checks the stop event.  `request_stop` closes the stream, which unblocks a
   thread waiting for notifications; this was verified against the real pyaviso iterator.

`pyaviso` is an optional dependency, imported only when the listener starts without an
injected client factory.  It uses its own Rust HTTP stack, so it does not go through
`utility/http_pools.py`; this is an accepted exception, like `httpx_oauth`.
"""

import dataclasses
import datetime as dt
import logging
import threading
from collections.abc import Callable, Iterator, Mapping, Sequence
from concurrent.futures import CancelledError, Future
from concurrent.futures import wait as wait_for_futures
from typing import Any, Protocol, cast

from forecastbox.domain.experiment.triggers import control
from forecastbox.domain.experiment.triggers.db import ActiveTrigger, list_active_triggers
from forecastbox.domain.experiment.triggers.service import handle_event
from forecastbox.domain.experiment.triggers.spec import AvisoEvent, IdentifierValue, replay_start
from forecastbox.utility.concurrency.manager import StatusModel
from forecastbox.utility.config import AvisoSettings
from forecastbox.utility.packages import try_import
from forecastbox.utility.time import current_time

logger = logging.getLogger(__name__)

_PREREQUISITE_POLL_SECONDS = 0.5
_IDLE_POLL_SECONDS = 1.0
PYAVISO_MISSING_MESSAGE = "pyaviso not installed"


class NotificationLike(Protocol):
    """The part of a pyaviso `Notification` which the listener reads."""

    @property
    def event_type(self) -> str: ...
    @property
    def sequence(self) -> int: ...
    @property
    def identifier(self) -> dict[str, Any]: ...
    @property
    def payload(self) -> Any: ...
    @property
    def cloudevent(self) -> dict[str, Any] | None: ...


class NotificationStream(Protocol):
    """Iterator of `(name, notification)` pairs, as returned by pyaviso `listen_many`."""

    def __iter__(self) -> Iterator[tuple[str, NotificationLike]]: ...
    def close(self) -> None: ...


class ListenClient(Protocol):
    """The part of the pyaviso client which the listener uses."""

    def listen_many(self, listeners: Mapping[str, Mapping[str, Any]], *, on_error: str) -> NotificationStream: ...


ClientFactory = Callable[[], ListenClient]


class AvisoListenerStatus(StatusModel):
    """Status of the listener for the `ExecutionManager`.  Always ready, since the listener
    must not delay startup waiting for prerequisites or for the Aviso connection."""

    state: str
    message: str | None = None
    active_triggers: int = 0
    last_event_at: dt.datetime | None = None
    last_error: str | None = None

    def is_ready(self) -> bool:
        return True


def _format_error(error: BaseException) -> str:
    return f"{type(error).__name__}: {error}"


def _to_start_from(value: dt.datetime) -> str:
    return value.astimezone(dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _cloudevent_time(notification: NotificationLike) -> dt.datetime | None:
    cloudevent = notification.cloudevent
    value = cloudevent.get("time") if cloudevent else None
    if not isinstance(value, str):
        return None
    try:
        parsed = dt.datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=dt.UTC)


def _published_at(notification: NotificationLike, fallback: dt.datetime) -> dt.datetime:
    return _cloudevent_time(notification) or fallback


def notification2event(notification: NotificationLike, now: dt.datetime) -> AvisoEvent:
    """Convert a notification to an event.  The publication time is the CloudEvent time,
    falling back to `now` when it is missing or unparseable."""
    payload = notification.payload
    return AvisoEvent(
        source="aviso",
        event_type=notification.event_type,
        sequence=int(notification.sequence),
        identifier=cast(dict[str, IdentifierValue], dict(notification.identifier)),
        payload=cast(dict[str, object], payload) if isinstance(payload, dict) else None,
        published_at=_published_at(notification, now),
    )


class _StreamEnded(Exception):
    """The stream ended without a request to close it."""


class AvisoListener:
    """State and loop of the listener.  The `entrypoint`, `request_stop` and `component_status`
    methods are given to the `ExecutionManager`; `prod` and `status` are registered into `control`.

    Without a `client_factory`, `pyaviso` is imported when the thread starts and the client is
    `pyaviso.AvisoClient(base_url=settings.base_url)`; a missing package yields the state
    `unavailable`.  The `history_gap_error` is the exception type which marks a replay
    that cannot be served; it is taken from pyaviso unless a factory is injected."""

    def __init__(
        self,
        settings: AvisoSettings,
        prerequisites: Sequence[Future[None]],
        *,
        client_factory: ClientFactory | None = None,
        history_gap_error: type[Exception] | None = None,
    ) -> None:
        self._settings = settings
        self._prerequisites = tuple(prerequisites)
        self._client_factory = client_factory
        self._history_gap_error = history_gap_error
        self._stop_event = threading.Event()
        self._wake = threading.Event()
        self._stream: NotificationStream | None = None
        self._stream_lock = threading.Lock()
        # the status is an immutable value, replaced atomically under the lock and read lock-free
        self._status = control.ListenerStatus(state="starting")
        self._status_lock = threading.Lock()

    # ----- status

    def status(self) -> control.ListenerStatus:
        return self._status

    def component_status(self) -> AvisoListenerStatus:
        status = self._status
        return AvisoListenerStatus(
            state=status.state,
            message=status.message,
            active_triggers=status.active_triggers,
            last_event_at=status.last_event_at,
            last_error=status.last_error,
        )

    def _update(self, **changes: Any) -> None:
        with self._status_lock:
            self._status = dataclasses.replace(self._status, **changes)

    # ----- control from other threads

    def prod(self) -> None:
        """Ask the loop to reload the triggers.  Does not block beyond closing the stream."""
        self._wake.set()
        self._close_stream()

    def request_stop(self, timeout: float) -> None:
        """Unblock the loop after the manager has set the stop event."""
        self._wake.set()
        self._close_stream()

    def _close_stream(self) -> None:
        with self._stream_lock:
            stream = self._stream
        if stream is None:
            return
        try:
            stream.close()
        except Exception:
            logger.exception("closing the aviso stream failed")

    # ----- thread

    def entrypoint(self, stop_event: threading.Event) -> None:
        self._stop_event = stop_event
        control.register(self.prod, self.status)
        try:
            if self._prepare_client_factory() and self._await_prerequisites():
                self._loop()
            if not stop_event.is_set():
                # unavailable: stay registered, reporting the status, until stopped
                stop_event.wait()
        except Exception as e:
            logger.exception("the aviso listener failed")
            self._update(state="unavailable", message="listener failed", last_error=_format_error(e))
            stop_event.wait()
        finally:
            self._update(state="stopped", message=None, active_triggers=0)
            control.unregister()

    def _prepare_client_factory(self) -> bool:
        if self._client_factory is not None:
            return True
        # runtime reason: pyaviso is an optional extra, imported only when the listener is enabled
        try:
            module = try_import("pyaviso")
        except ImportError as e:
            logger.error(f"importing pyaviso failed: {e}")
            self._update(state="unavailable", message="pyaviso import failed", last_error=_format_error(e))
            return False
        if module is None:
            logger.error(PYAVISO_MISSING_MESSAGE)
            self._update(state="unavailable", message=PYAVISO_MISSING_MESSAGE)
            return False
        base_url = self._settings.base_url
        self._client_factory = lambda: cast(ListenClient, module.AvisoClient(base_url=base_url))
        self._history_gap_error = module.HistoryGapError
        return True

    def _await_prerequisites(self) -> bool:
        self._update(state="waiting_prerequisites", message=None)
        while not self._stop_event.is_set():
            _, pending = wait_for_futures(self._prerequisites, timeout=_PREREQUISITE_POLL_SECONDS)
            if not pending:
                break
        else:
            return False
        for future in self._prerequisites:
            error = CancelledError() if future.cancelled() else future.exception()
            if error is not None:
                logger.error(f"aviso listener prerequisite failed: {error!r}")
                self._update(state="unavailable", message="prerequisites failed", last_error=_format_error(error))
                return False
        return True

    def _wait_wake(self) -> None:
        while not self._stop_event.is_set():
            if self._wake.wait(_IDLE_POLL_SECONDS):
                return

    def _loop(self) -> None:
        # Triggers which fell back to the live edge after a history gap, with the definition
        # version at which that happened.  An entry is kept across rebuilds and dropped when
        # the trigger is no longer active or its version changes, or when the process restarts.
        live_edge: dict[str, int] = {}
        while not self._stop_event.is_set():
            self._wake.clear()
            try:
                triggers = [t for t in list_active_triggers() if t.spec.enabled]
                current = {t.experiment_id: t.version for t in triggers}
                for name in [n for n, version in live_edge.items() if current.get(n) != version]:
                    del live_edge[name]
                if not triggers:
                    self._update(state="listening", message="no enabled triggers", active_triggers=0)
                    self._wait_wake()
                    continue
                self._listen(triggers, live_edge)
            except Exception as e:
                if self._stop_event.is_set():
                    break
                self._back_off(e)

    def _back_off(self, error: Exception) -> None:
        seconds = self._settings.reconnect_backoff_seconds
        logger.error(f"aviso listener error, retrying in {seconds}s: {_format_error(error)}")
        self._update(state="backoff", message=f"retrying in {seconds}s", last_error=_format_error(error))
        self._stop_event.wait(seconds)

    def _build_listeners(self, triggers: Sequence[ActiveTrigger], live_edge: Mapping[str, int]) -> dict[str, dict[str, Any]]:
        now = current_time("scheduling")
        listeners: dict[str, dict[str, Any]] = {}
        for trigger in triggers:
            entry: dict[str, Any] = {"event_type": trigger.spec.event_type}
            if trigger.spec.filter:
                entry["filter"] = trigger.spec.filter
            if trigger.experiment_id not in live_edge:
                entry["start_from"] = _to_start_from(replay_start(trigger.spec, trigger.created_at, now))
            listeners[trigger.experiment_id] = entry
        return listeners

    def _listen(self, triggers: Sequence[ActiveTrigger], live_edge: dict[str, int]) -> None:
        """Consume one stream until a reload, a stop, or an error.  A history gap of one
        trigger which was opened with a replay is added to `live_edge` and the stream is
        rebuilt at once; a gap of a trigger already at the live edge, and any other error,
        propagates."""
        assert self._client_factory is not None
        by_id: dict[str, ActiveTrigger] = {t.experiment_id: t for t in triggers}
        listeners = self._build_listeners(triggers, live_edge)
        replayed = {name for name, entry in listeners.items() if "start_from" in entry}
        warned: set[str] = set()
        stream = self._client_factory().listen_many(listeners, on_error="raise")
        with self._stream_lock:
            self._stream = stream
        try:
            if self._wake.is_set() or self._stop_event.is_set():
                stream.close()
            else:
                self._update(state="listening", message=None, active_triggers=len(triggers))
            for name, notification in stream:
                self._dispatch(by_id, name, notification, warned)
                if self._wake.is_set() or self._stop_event.is_set():
                    break
            if not self._wake.is_set() and not self._stop_event.is_set():
                raise _StreamEnded("the aviso stream ended")
        except Exception as e:
            gap_name = getattr(e, "listener", None)
            if self._history_gap_error is not None and isinstance(e, self._history_gap_error) and gap_name in replayed:
                logger.warning(f"aviso history gap for trigger {gap_name}, reopening at the live edge: {e}")
                live_edge[gap_name] = by_id[gap_name].version
                self._update(last_error=_format_error(e))
                return
            raise
        finally:
            with self._stream_lock:
                self._stream = None
            try:
                stream.close()
            except Exception:
                logger.exception("closing the aviso stream failed")

    def _dispatch(self, by_id: Mapping[str, ActiveTrigger], name: str, notification: NotificationLike, warned: set[str]) -> None:
        trigger = by_id.get(name)
        if trigger is None:
            logger.warning(f"aviso notification for unknown trigger {name}")
            return
        now = current_time("scheduling")
        if name not in warned and _cloudevent_time(notification) is None:
            warned.add(name)
            logger.warning(
                f"aviso notification for trigger {name} has no valid CloudEvent time, "
                "so its publication time is the receipt time and stale protection does not apply"
            )
        try:
            event = notification2event(notification, now)
            result = handle_event(trigger.experiment_id, event)
        except Exception:
            logger.exception(f"handling an aviso notification for trigger {name} failed")
            return
        logger.debug(f"handled aviso event for trigger {name}: {result.status}")
        self._update(last_event_at=now)
