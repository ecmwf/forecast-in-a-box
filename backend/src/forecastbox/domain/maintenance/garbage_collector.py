# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Proof-of-concept periodic maintenance thread owned by `ExecutionManager` (stage 2, so it
starts after and stops before the scheduler). Runs every `CLEANUP_INTERVAL_SECONDS` or when
triggered, never at startup. Calls a locked jobs-DB helper directly on its own thread; the
session is created and closed inside the helper. No rows are modified and nothing is emitted.
"""

import datetime as dt
import logging
import threading
from enum import StrEnum
from typing import Any

from forecastbox.domain.blueprint.db import BlueprintStorageSummary, summarize_blueprint_storage
from forecastbox.domain.maintenance.exceptions import CleanupNotRunning
from forecastbox.utility.concurrency.manager import StatusModel
from forecastbox.utility.time import current_time

logger = logging.getLogger(__name__)

CLEANUP_INTERVAL_SECONDS = 3 * 60 * 60


class GarbageCollectorState(StrEnum):
    idle = "idle"
    querying = "querying"
    stopped = "stopped"


class GarbageCollectorStatus(StatusModel):
    state: GarbageCollectorState
    last_attempt_at: dt.datetime | None = None
    last_success_at: dt.datetime | None = None
    next_wake_at: dt.datetime | None = None
    last_result: BlueprintStorageSummary | None = None
    last_failure: str | None = None

    def is_ready(self) -> bool:
        return self.state in (GarbageCollectorState.idle, GarbageCollectorState.querying)


class GarbageCollectorRuntime:
    wake: threading.Event = threading.Event()
    status: GarbageCollectorStatus = GarbageCollectorStatus(state=GarbageCollectorState.stopped)


def _publish(**changes: Any) -> None:
    GarbageCollectorRuntime.status = GarbageCollectorRuntime.status.model_copy(update=changes)


def _run_once() -> None:
    _publish(state=GarbageCollectorState.querying, last_attempt_at=current_time("liveness"))
    try:
        summary = summarize_blueprint_storage()
    except Exception as e:
        logger.exception("database maintenance query failed")
        _publish(last_failure=repr(e))
    else:
        _publish(last_result=summary, last_success_at=current_time("liveness"), last_failure=None)
        logger.debug(f"database maintenance result: {summary}")


def garbage_collector_entrypoint(stop_event: threading.Event) -> None:
    try:
        while not stop_event.is_set():
            _publish(
                state=GarbageCollectorState.idle,
                next_wake_at=current_time("liveness") + dt.timedelta(seconds=CLEANUP_INTERVAL_SECONDS),
            )
            GarbageCollectorRuntime.wake.wait(CLEANUP_INTERVAL_SECONDS)
            if stop_event.is_set():
                break
            GarbageCollectorRuntime.wake.clear()
            _run_once()
    finally:
        _publish(state=GarbageCollectorState.stopped, next_wake_at=None)


def garbage_collector_stop_request(timeout: float) -> None:
    GarbageCollectorRuntime.wake.set()


def garbage_collector_status() -> GarbageCollectorStatus:
    return GarbageCollectorRuntime.status


def trigger_cleanup() -> None:
    if GarbageCollectorRuntime.status.state not in (GarbageCollectorState.idle, GarbageCollectorState.querying):
        raise CleanupNotRunning("The database maintenance thread is not running.")
    GarbageCollectorRuntime.wake.set()
