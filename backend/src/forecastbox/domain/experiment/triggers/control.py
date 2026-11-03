# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Control interface of the event listener.  The listener registers a prod function and a
status function, and the service and route code use them without importing the listener.
Nothing registered means the listener is disabled."""

import datetime as dt
import logging
import threading
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

logger = logging.getLogger(__name__)

ListenerState = Literal["disabled", "starting", "waiting_prerequisites", "listening", "backoff", "unavailable", "stopped"]


@dataclass(frozen=True, eq=True, slots=True)
class ListenerStatus:
    state: ListenerState
    message: str | None = None
    active_triggers: int = 0
    last_event_at: dt.datetime | None = None
    last_error: str | None = None


@dataclass(frozen=True, eq=False, slots=True)
class _Registration:
    prod_fn: Callable[[], None]
    status_fn: Callable[[], ListenerStatus]


# the registration is immutable and replaced atomically under the lock, reads are lock-free
_registration: _Registration | None = None
_lock = threading.Lock()


def register(prod_fn: Callable[[], None], status_fn: Callable[[], ListenerStatus]) -> None:
    """Install the listener's functions, replacing any previous registration.  The `prod_fn`
    asks the listener to reload its triggers and must not block; the `status_fn` returns the
    current status and must be callable from any thread."""
    global _registration
    with _lock:
        _registration = _Registration(prod_fn=prod_fn, status_fn=status_fn)


def unregister() -> None:
    """Remove the registered listener, if any."""
    global _registration
    with _lock:
        _registration = None


def prod_listener() -> None:
    """Ask the registered listener to reload its triggers.  Does nothing when none is
    registered, and never raises."""
    registration = _registration
    if registration is None:
        return
    try:
        registration.prod_fn()
    except Exception:
        logger.exception("prodding the trigger listener failed")


def listener_status() -> ListenerStatus:
    """Return the status of the registered listener, or a `disabled` status when none is
    registered.  Never raises -- a failing status function yields an `unavailable` status."""
    registration = _registration
    if registration is None:
        return ListenerStatus(state="disabled", message="no listener registered")
    try:
        return registration.status_fn()
    except Exception as e:
        logger.exception("querying the trigger listener status failed")
        return ListenerStatus(state="unavailable", message="status query failed", last_error=f"{type(e).__name__}: {e}")
