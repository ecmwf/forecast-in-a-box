# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Bridges the synchronous event dispatcher to the async websocket connections that deliver
ClientNotification messages to clients.

Concurrency notes for `NotificationBroadcaster`:
- `_loop` is written by the `broadcaster` initializer steps of `entrypoint.initializers`: set by
  `init_broadcaster` on the event loop thread before any event can be dispatched, and cleared by
  `stop_broadcaster` during shutdown, after the managed threads (including the event dispatcher)
  stopped. It is read from arbitrary General-pool worker threads inside `publish`. A single
  attribute read/write of a reference is atomic under CPython's GIL -- there is no risk of
  observing a torn/half-initialized value -- so no lock is needed here. `publish` captures it into
  a local variable once, to avoid any conceptual check-then-use race.
- `asyncio.run_coroutine_threadsafe` (used by `publish`) is documented to be safe to call
  concurrently from multiple threads, so no additional lock is needed to serialize `publish` calls
  either. `publish` does not wait for the broadcast to complete; failures are only logged.
- `_clients` is a pyrsistent `PSet`, mutated only on the event loop thread: `register`/`unregister`
  run inside the websocket route coroutine, and `_broadcast` runs as a coroutine scheduled via
  `run_coroutine_threadsafe` onto that same loop. Because asyncio is cooperative, none of these can
  interleave except at `await` points, so plain reference swaps (`NotificationBroadcaster._clients =
  ...`) are sufficient -- no lock is needed. `_broadcast` snapshots `_clients` once before its first
  `await`, and folds any disconnected clients back into the *current* `_clients` (not the stale
  snapshot) with a single swap at the end, so a client registered mid-broadcast is never lost even
  though it may miss that one broadcast.
- All of the above relies on CPython's GIL providing atomic reference reads/writes and a strict
  single-bytecode-at-a-time execution order. This would need revisiting under a no-GIL build.
"""

import asyncio
import concurrent.futures
import logging

from fastapi import WebSocket
from pyrsistent import pset
from pyrsistent.typing import PSet

from forecastbox.domain.notification.models import ClientNotification

logger = logging.getLogger(__name__)


class NotificationBroadcasterNotInitialized(Exception):
    """Raised when `publish` is called before `init_broadcaster` has run."""


class NotificationBroadcaster:
    """Process-local singleton state. See module docstring for the concurrency reasoning."""

    _loop: asyncio.AbstractEventLoop | None = None
    _stopped: bool = False
    _clients: PSet[WebSocket] = pset()


def init_broadcaster(loop: asyncio.AbstractEventLoop) -> None:
    """Called once, early during app startup, from a coroutine running on `loop`."""
    NotificationBroadcaster._stopped = False
    NotificationBroadcaster._loop = loop


def stop_broadcaster() -> None:
    """Called once during app shutdown, after the event dispatcher stopped. Subsequent `publish`
    calls are dropped."""
    NotificationBroadcaster._stopped = True
    NotificationBroadcaster._loop = None


def register_client(websocket: WebSocket) -> None:
    """Must be called from the event loop thread (the websocket route handler)."""
    NotificationBroadcaster._clients = NotificationBroadcaster._clients.add(websocket)


def unregister_client(websocket: WebSocket) -> None:
    """Must be called from the event loop thread (the websocket route handler)."""
    NotificationBroadcaster._clients = NotificationBroadcaster._clients.discard(websocket)


async def _broadcast(notification: ClientNotification) -> None:
    clients = NotificationBroadcaster._clients
    payload = notification.model_dump_json()
    dead: list[WebSocket] = []
    for client in clients:
        try:
            await client.send_text(payload)
        except Exception:
            dead.append(client)
    if dead:
        NotificationBroadcaster._clients = NotificationBroadcaster._clients.difference(dead)


def _log_broadcast_failure(future: "concurrent.futures.Future[None]") -> None:
    if future.cancelled():
        logger.warning("notification broadcast was cancelled")
        return
    error = future.exception()
    if error is not None:
        logger.error(f"notification broadcast failed with {error!r}")


def publish(notification: ClientNotification) -> None:
    """Synchronous entrypoint, callable from any thread -- in particular, from a dispatcher handler
    running on a General-pool worker thread. Schedules the broadcast to all currently connected
    clients on the event loop and returns without waiting for it. Raises
    `NotificationBroadcasterNotInitialized` before initialization; after `stop_broadcaster` the
    notification is dropped.
    """
    # TODO fire-and-forget publish is undesirable -- delivery failures are only logged and not reported
    # to the dispatcher; it is done primarily to not block the General pool for long. Revisit with a
    # proper delivery mechanism.
    loop = NotificationBroadcaster._loop
    if loop is None:
        if NotificationBroadcaster._stopped:
            logger.debug(f"notification broadcaster stopped, dropping notification {notification.sourceDomainEvent}")
            return
        logger.error("NotificationBroadcaster.publish called before initialization -- dropping notification")
        raise NotificationBroadcasterNotInitialized("notification broadcaster event loop is not initialized")
    try:
        future = asyncio.run_coroutine_threadsafe(_broadcast(notification), loop)
    except RuntimeError as error:
        logger.warning(f"failed to schedule notification broadcast, event loop not usable: {error!r}")
        return
    future.add_done_callback(_log_broadcast_failure)
