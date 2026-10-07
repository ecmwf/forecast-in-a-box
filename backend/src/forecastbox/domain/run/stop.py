# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Stopping and deleting of Runs: status-guarded transitions in the db, and the stop of the job in cascade.

The status transitions are compare-and-swap: a decision is made on a record read from the db, the write
carries the status that was read, and if the write loses the record is read again and the decision is made anew.
"""

import logging
from functools import partial
from typing import cast

from cascade.controller.report import JobId
from cascade.gateway.api import ShutdownRequest, ShutdownResponse
from cascade.gateway.client import request_response

from forecastbox.domain.gateway.service import get_gateway_url
from forecastbox.domain.run import db
from forecastbox.domain.run.exceptions import RunNotDeletable, RunNotFound, RunNotStoppable
from forecastbox.domain.run.types import RunId
from forecastbox.schemata.run import RunStatus
from forecastbox.utility.auth import AuthContext
from forecastbox.utility.concurrency.manager import TaskName, execution_manager
from forecastbox.utility.config import ConcurrentPools

logger = logging.getLogger(__name__)

_STOPPABLE_STATUSES: frozenset[RunStatus] = frozenset(cast(tuple[RunStatus, ...], ("submitted", "preparing", "running")))
# statuses in which a stop has already been requested
_STOPPED_STATUSES: frozenset[RunStatus] = frozenset(cast(tuple[RunStatus, ...], ("stopping", "stopped")))
# statuses in which no computation is going on anymore, so that the Run may be deleted
_TERMINAL_STATUSES: frozenset[RunStatus] = frozenset(cast(tuple[RunStatus, ...], ("completed", "failed", "stopped")))

_CAS_ATTEMPTS = 5


def ensure_deletable(record: db.RunRecord) -> None:
    """Raise ``RunNotDeletable`` unless the Run has reached a terminal status (completed, failed, stopped)."""
    if record.status not in _TERMINAL_STATUSES:
        raise RunNotDeletable(f"Run {record.run_id!r} has status {record.status!r}, only completed, failed or stopped runs can be deleted.")


def stop_cascade_job(cascade_job_id: str) -> ShutdownResponse:
    """Ask the gateway to terminate the single given job. The gateway itself keeps running.

    Not to be confused with a `ShutdownRequest` without `only_these`, which shuts down the whole gateway.
    """
    request = ShutdownRequest(only_these=[JobId(cascade_job_id)])
    # TODO current gateway's shutdown is heavy and blocking, thus a long timeout. Remove once improved.
    # Note that even once the gateway responds fast, the termination itself may fail or take long, so the
    # reconciliation of the `stopping` status in `service.poll_and_update` is to stay.
    response = request_response(request, get_gateway_url(), 15_000)
    return response  # type: ignore[return-value]


def stop_run(run_id: RunId, attempt_count: int, *, auth_context: AuthContext) -> db.RunRecord:
    """Mark a specific attempt of a Run as ``stopping`` and return the resulting record.

    Does not contact cascade. Idempotent: a Run already ``stopping`` or ``stopped`` is returned as is.

    Raises ``RunNotFound`` and ``RunAccessDenied`` as ``db.get_run`` does.
    Raises ``RunNotStoppable`` if the status is not one of ``submitted``, ``preparing``, ``running``
    (or already stopping/stopped), or if the status keeps changing concurrently.
    """
    for _ in range(_CAS_ATTEMPTS):
        record = db.get_run(run_id, attempt_count, auth_context=auth_context)
        if record.status in _STOPPED_STATUSES:
            return record
        if record.status not in _STOPPABLE_STATUSES:
            raise RunNotStoppable(f"Run {run_id!r} has status {record.status!r} and cannot be stopped.")
        if db.update_run_runtime(run_id, attempt_count, expected_status=record.status, status="stopping"):
            # NOTE we read again to see a cascade_job_id possibly written in the meantime
            fresh = db.get_run_unchecked(run_id, attempt_count)
            if fresh is None:
                raise RunNotFound(f"Run {run_id!r} not found.")
            return fresh
    raise RunNotStoppable(f"Run {run_id!r} is being modified concurrently, retry later.")


def soft_delete_run_cas(run_id: RunId, attempt_count: int, *, auth_context: AuthContext) -> None:
    """Mark a specific attempt of a Run as deleted, along with all other attempts that are terminal.

    Attempts that are not terminal stay visible.

    Raises ``RunNotFound`` if the attempt does not exist.
    Raises ``RunAccessDenied`` if the actor is an authenticated non-admin who does not own the execution.
    Raises ``RunNotDeletable`` if the attempt has not reached a terminal status, or if the status keeps changing concurrently.
    """
    for _ in range(_CAS_ATTEMPTS):
        record = db.get_run(run_id, attempt_count, auth_context=auth_context)
        ensure_deletable(record)
        if db.soft_delete_run(run_id, attempt_count, expected_status=record.status, also_hide_statuses=_TERMINAL_STATUSES):
            return
    raise RunNotDeletable(f"Run {run_id!r} is being modified concurrently, retry later.")


def stop_cascade_and_mark(run_id: RunId, attempt_count: int, cascade_job_id: str) -> None:
    """Issue the stop of the job to the gateway, and on success transition the Run from ``stopping`` to ``stopped``.

    Blocking, intended for a worker thread. Failures are only logged: the Run stays ``stopping``
    and `service.poll_and_update` reconciles it. The db transition requires the current status to be
    ``stopping`` and is not retried on a mismatch, as then somebody else has already recorded a more
    informative state (such as completed or failed).
    """
    get_id = lambda: f"{run_id=}, {attempt_count=}, {cascade_job_id=}"
    try:
        response = stop_cascade_job(cascade_job_id)
        if response.error:
            # NOTE we dont interpret the error content. The poll will eventually find out what is the state
            logger.warning(f"cascade stop of {get_id()} reported error {response.error!r}. Leaving the run as stopping.")
            return
        if not db.update_run_runtime(run_id, attempt_count, expected_status="stopping", status="stopped"):
            logger.debug(f"run no longer stopping after cascade stop, leaving as is: {get_id()}")
    except Exception as e:
        logger.warning(f"cascade stop of {get_id()} failed with {e!r}. Leaving the run as stopping.")


def submit_stop_cascade(run_id: RunId, attempt_count: int, cascade_job_id: str) -> None:
    """Enqueue `stop_cascade_and_mark` on the general pool, unmonitored.

    Raises ``SubmissionRejected`` if the pool does not accept the task.
    """
    execution_manager.submit_unmonitored(
        ConcurrentPools.General,
        TaskName("run.stop.cascade"),
        partial(stop_cascade_and_mark, run_id, attempt_count, cascade_job_id),
    )
