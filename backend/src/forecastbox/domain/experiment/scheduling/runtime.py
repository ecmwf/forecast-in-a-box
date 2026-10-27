# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Managed-thread glue for the scheduler.

The scheduler thread is owned by `ExecutionManager`, registered as `ConcurrentThreads.Scheduler`.
This module provides its entrypoint, stop request, and status provider, plus the helpers used by
the rest of the backend (`prod_scheduler`, `status_scheduler`, `restart_scheduler`).

The thread sleeps on the `wake` event, which is cleared before each iteration, so a prod arriving
during an iteration makes the following sleep return immediately.

A start gate (a future armed by the entrypoint before startup) delays the first iteration until
prerequisites such as plugins and the gateway are available. The gate is consumed one-shot: a
restart skips it, so an operator who fixed the gateway after a failed startup can start the
scheduler through the restart route.

The status is a lock-free snapshot: only the scheduler thread writes it, by swapping the
reference to an immutable object.
"""

import datetime as dt
import logging
import threading
from concurrent.futures import Future
from enum import StrEnum

from forecastbox.domain.experiment.exceptions import SchedulerDisabled, SchedulerRestartRefused
from forecastbox.domain.experiment.scheduling.background import (
    max_sleep_seconds,
    schedule_due_experiments,
    scheduler_lock,
    timeout_acquire_background,
)
from forecastbox.utility.concurrency.manager import LifecycleError, StatusModel, execution_manager
from forecastbox.utility.concurrency.synchronization import timed_acquire
from forecastbox.utility.config import ConcurrentThreads, config
from forecastbox.utility.time import current_time

logger = logging.getLogger(__name__)

SCHEDULER_STOP_TIMEOUT_SECONDS = 10.0


class SchedulerState(StrEnum):
    waiting_for_prerequisites = "waiting-for-prerequisites"
    prerequisites_failed = "prerequisites-failed"
    scheduling = "scheduling"
    sleeping = "sleeping"
    stopped = "stopped"


class SchedulerStatus(StatusModel):
    state: SchedulerState
    last_iteration_at: dt.datetime | None = None
    next_wake_at: dt.datetime | None = None

    def is_ready(self) -> bool:
        return self.state in (SchedulerState.waiting_for_prerequisites, SchedulerState.scheduling, SchedulerState.sleeping)


class SchedulerRuntime:
    wake: threading.Event = threading.Event()
    start_gate: Future[None] | None = None
    status: SchedulerStatus = SchedulerStatus(state=SchedulerState.stopped)


def _publish(**changes: object) -> None:
    SchedulerRuntime.status = SchedulerRuntime.status.model_copy(update=changes)


def arm_start_gate(gate: Future[None]) -> None:
    SchedulerRuntime.start_gate = gate


def _wait_for_gate(gate: Future[None], stop_event: threading.Event) -> bool:
    """Return True if the gate opened successfully, False if the scheduler should not run."""
    _publish(state=SchedulerState.waiting_for_prerequisites)
    while not gate.done():
        if stop_event.wait(1.0):
            return False
    if gate.cancelled() or gate.exception() is not None:
        error = "cancelled" if gate.cancelled() else repr(gate.exception())
        logger.critical(f"scheduler start aborted, prerequisite failed with {error}")
        _publish(state=SchedulerState.prerequisites_failed)
        return False
    return True


def scheduler_entrypoint(stop_event: threading.Event) -> None:
    gate, SchedulerRuntime.start_gate = SchedulerRuntime.start_gate, None
    logger.info("Scheduler thread started.")
    try:
        if gate is not None and not _wait_for_gate(gate, stop_event):
            return
        while not stop_event.is_set():
            SchedulerRuntime.wake.clear()
            now = current_time("liveness")
            _publish(state=SchedulerState.scheduling, last_iteration_at=now)
            with timed_acquire(scheduler_lock, timeout_acquire_background) as acquired:
                if not acquired:
                    logger.warning("Scheduler could not acquire scheduler_lock within timeout, skipping iteration.")
                    continue
                sleep_seconds = schedule_due_experiments(now, stop_event)
            _publish(state=SchedulerState.sleeping, next_wake_at=now + dt.timedelta(seconds=sleep_seconds))
            logger.debug(f"Scheduler sleeping for {sleep_seconds} seconds.")
            SchedulerRuntime.wake.wait(sleep_seconds)
    finally:
        if SchedulerRuntime.status.state != SchedulerState.prerequisites_failed:
            _publish(state=SchedulerState.stopped)
        logger.info("Scheduler thread stopped.")


def scheduler_stop_request(timeout: float) -> None:
    SchedulerRuntime.wake.set()


def scheduler_status() -> SchedulerStatus:
    return SchedulerRuntime.status


def prod_scheduler() -> None:
    logger.debug("Prodding possibly sleeping scheduler.")
    SchedulerRuntime.wake.set()


def status_scheduler() -> str:
    if not config.backend.allow_scheduler:
        return "off"
    status = SchedulerRuntime.status
    if status.state not in (SchedulerState.scheduling, SchedulerState.sleeping):
        return "down"
    if status.last_iteration_at is None:
        return "down"
    now = current_time("liveness")
    if (now - status.last_iteration_at) > dt.timedelta(seconds=max_sleep_seconds) * 2:
        logger.warning(f"scheduler reported down due to failing liveness check: {now} >> {status.last_iteration_at}")
        return "down"
    return "up"


def restart_scheduler() -> None:
    """Stop and restart the managed scheduler thread. Blocks while joining, run on a pool worker."""
    if not config.backend.allow_scheduler:
        raise SchedulerDisabled("scheduler is disabled in the configuration")
    execution_manager.stop_thread(ConcurrentThreads.Scheduler, timeout=SCHEDULER_STOP_TIMEOUT_SECONDS)
    try:
        execution_manager.restart_thread(ConcurrentThreads.Scheduler, reset_restart_count=True)
    except LifecycleError as error:
        raise SchedulerRestartRefused(str(error)) from error
