# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Stopping of a submitted Run in cascade, and the follow-up ``stopping`` -> ``stopped`` db transition."""

import logging
from functools import partial

from forecastbox.domain.run import db
from forecastbox.domain.run.cascade import stop_cascade_job
from forecastbox.domain.run.types import RunId
from forecastbox.utility.concurrency.manager import TaskName, execution_manager
from forecastbox.utility.config import ConcurrentPools

logger = logging.getLogger(__name__)


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
