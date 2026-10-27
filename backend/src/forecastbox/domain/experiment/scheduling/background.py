# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""One scheduling iteration and the lock protecting the schedule tables.
Executed by the managed scheduler thread, see `runtime.py`.
"""

import datetime as dt
import logging
import threading

from forecastbox.domain.experiment.scheduling import db
from forecastbox.domain.experiment.scheduling.job_utils import experiment2runnable
from forecastbox.domain.experiment.types import ExperimentDefinitionId
from forecastbox.domain.run.service import submit_run_sync
from forecastbox.utility.auth import AuthContext
from forecastbox.utility.time import current_time, get_sleepable_difference

logger = logging.getLogger(__name__)

# NOTE this lock can be locked externally, eg when updating schedules. For all operations
# potentially involving the ScheduleNext table etc, as well as scheduler instance itself
# to guarantee the singleton nature
scheduler_lock = threading.Lock()
timeout_acquire_request = 3  # aggressive timeout, we dont want to block async worker for long
timeout_acquire_background = 5  # the loop retries; bounds how long a stop request can go unnoticed

# NOTE this does not really affect how often scheduler checks for new jobs --
# if anything is scheduled for earlier, we sleep for shorter time in advance,
# or are `prod`ed explicitly. The actual importance of this interval is to
# implement liveness checks correctly
max_sleep_seconds: int = 15 * 60


def schedule_due_experiments(now: dt.datetime, stop_event: threading.Event) -> float:
    """Submit due scheduled runs, advance their next-run rows, and return the number of
    seconds to sleep before the next iteration (at most max_sleep_seconds)."""
    logger.debug(f"Scheduler inquiry at {now}")

    schedulable = db.get_schedulable_experiments(now)

    for exp_next, exp_def in schedulable:
        if stop_event.is_set():
            break
        experiment_id = ExperimentDefinitionId(str(exp_next.experiment_id))
        scheduled_at = exp_next.scheduled_at
        logger.debug(f"Processing scheduled experiment {experiment_id} at {scheduled_at}")

        get_spec_result = experiment2runnable(experiment_id, scheduled_at)
        try:
            is_valid = (not exp_def.is_deleted) and bool((exp_def.experiment_definition or {}).get("enabled"))
        except (TypeError, KeyError) as e:
            logger.error(f"unexpected parsing failure for {experiment_id=}: {repr(e)} on {exp_def.experiment_definition}")
            is_valid = False

        if get_spec_result.t is not None:
            runnable = get_spec_result.t
            if (now - scheduled_at).total_seconds() / 3600 > runnable.max_acceptable_delay_hours:
                logger.warning(
                    f"Skipping experiment {experiment_id} at {scheduled_at}: "
                    f"older than max_acceptable_delay_hours ({runnable.max_acceptable_delay_hours} hours)."
                )
            elif not is_valid:
                # NOTE this should not happen -- we have locks etc preventing this
                logger.error(f"Skipping {experiment_id} at {scheduled_at}: it is not valid!")
            else:
                exec_result = submit_run_sync(
                    runnable.blueprint,
                    # NOTE the is_admin may be True, but we dont know and its not important for this call
                    AuthContext(
                        user_id=runnable.created_by,
                        is_admin=False,
                    ),
                    experiment_id=experiment_id,
                    experiment_version=exp_def.version,
                    compiler_runtime_context=runnable.compiler_runtime_context,
                    experiment_context=f"scheduled_at={runnable.scheduled_at.isoformat()}",
                )
                if exec_result.t is not None:
                    logger.debug(f"Execution {exec_result.t.run_id} submitted for experiment {experiment_id}")
                else:
                    logger.error(f"Failed to submit experiment {experiment_id}: {exec_result.e}")

            db.delete_experiment_next(experiment_id)
            if runnable.next_run_at and is_valid:
                db.upsert_experiment_next(experiment_id=experiment_id, scheduled_at=runnable.next_run_at)
                logger.debug(f"Next run for {experiment_id}: {runnable.next_run_at}")
            else:
                logger.warning(f"No next run computed for {experiment_id}")
        else:
            logger.error(f"Could not create runnable for experiment {experiment_id}: {get_spec_result.e}")
            db.delete_experiment_next(experiment_id)

    next_schedulable_at = db.next_schedulable_experiment()

    if next_schedulable_at:
        sleep_duration = max(
            min(max_sleep_seconds, get_sleepable_difference(current_time("scheduling"), next_schedulable_at)),
            0,
        )
    else:
        sleep_duration = max_sleep_seconds

    return sleep_duration
