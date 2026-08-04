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
- `_loop` is written exactly once, from `entrypoint.app`'s lifespan (`init_broadcaster`), on the
  event loop thread, before the app starts serving requests. It is later read from arbitrary
  General-pool worker threads inside `publish`. A single attribute read/write of a reference is
  atomic under CPython's GIL -- there is no risk of observing a torn/half-initialized value -- so no
  lock is needed here. `publish` still captures it into a local variable once, to avoid any
  conceptual check-then-use race.
- `asyncio.run_coroutine_threadsafe` (used by `publish`) is documented to be safe to call
  concurrently from multiple threads, so no additional lock is needed to serialize `publish` calls
  either.
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
import logging

from fastapi import WebSocket
from pyrsistent import pset
from pyrsistent.typing import PSet

from forecastbox.domain.notification.models import ClientNotification

logger = logging.getLogger(__name__)

PUBLISH_TIMEOUT_SECONDS = 5.0


class NotificationBroadcasterNotInitialized(Exception):
    """Raised when `publish` is called before `init_broadcaster` has run."""


class NotificationPublishTimedOut(Exception):
    """Raised when the notifications to the clients failed to be sent in due time"""


class NotificationBroadcaster:
    """Process-local singleton state. See module docstring for the concurrency reasoning."""

    _loop: asyncio.AbstractEventLoop | None = None
    _clients: PSet[WebSocket] = pset()


def init_broadcaster(loop: asyncio.AbstractEventLoop) -> None:
    """Called once, early during app startup, from a coroutine running on `loop`."""
    NotificationBroadcaster._loop = loop


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


def publish(notification: ClientNotification) -> None:
    """Synchronous entrypoint, callable from any thread -- in particular, from a dispatcher handler
    running on a General-pool worker thread. Blocks until the broadcast to all currently connected
    clients has completed (or raises on failure/timeout), so that the dispatcher can record a
    failure the same way it would for any other handler.
    """
    loop = NotificationBroadcaster._loop
    if loop is None:
        logger.error("NotificationBroadcaster.publish called before initialization -- dropping notification")
        raise NotificationBroadcasterNotInitialized("notification broadcaster event loop is not initialized")
    future = asyncio.run_coroutine_threadsafe(_broadcast(notification), loop)
    try:
        future.result(timeout=PUBLISH_TIMEOUT_SECONDS)
    except TimeoutError:
        raise NotificationPublishTimedOut() from None
