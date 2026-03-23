# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""The main loop of the scheduler -- checks the ScheduledRun table, submits jobs.
Runs in its own thread, submitting async work to the main event loop via
asyncio.run_coroutine_threadsafe to avoid cross-loop issues with asyncio primitives
(e.g. the asyncio.Lock in db/core.py).
"""

import asyncio
import datetime as dt
import logging
import threading
from typing import Any, cast

import forecastbox.db.jobs as db_jobs
from forecastbox.api.execution import execute
from forecastbox.api.scheduling.dt_utils import calculate_next_run, current_scheduling_time
from forecastbox.api.scheduling.job_utils import experiment2runnable
from forecastbox.config import config
from forecastbox.ecpyutil import timed_acquire

logger = logging.getLogger(__name__)

# NOTE this lock can be locked externally, eg when updating schedules. For all operations
# potentially involving the ScheduleNext table etc, as well as scheduler instance itself
# to guarantee the singleton nature
scheduler_lock = threading.Lock()
timeout_acquire_request = 1  # aggressive timeout, we dont want to block async worker for long
timeout_acquire_lifecycle = 5  # moderate timeout during scheduler startup/shutdown
timeout_acquire_background = 60  # leisure timeout for the scheduler background thread

# NOTE this does not really affect how often scheduler checks for new jobs --
# if anything is scheduled for earlier, we sleep for shorter time in advance,
# or are `prod`ed explicitly. The actual importance of this interval is to
# implement liveness checks correctly
sleep_duration_min: int = 15 * 60


class SchedulerThread(threading.Thread):
    def __init__(self, loop: asyncio.AbstractEventLoop):
        super().__init__()
        self._loop = loop
        self.stop_event = threading.Event()
        self.sleep_condition = threading.Condition()
        self.liveness_timestamp: dt.datetime | None = None
        self.liveness_signal = threading.Event()

    def _run_async(self, coro: Any) -> Any:
        """Submit a coroutine to the main event loop and block until it completes."""
        return asyncio.run_coroutine_threadsafe(coro, self._loop).result()

    def mark_alive(self) -> dt.datetime:
        self.liveness_timestamp = dt.datetime.now()
        self.liveness_signal.set()
        return self.liveness_timestamp

    def _try_schedule(self) -> int:
        """Check and submit due ExperimentDefinition scheduled runs."""
        now = self.mark_alive()
        logger.debug(f"Scheduler inquiry at {now}")

        schedulable = self._run_async(db_jobs.get_schedulable_experiments(now))

        for exp_next, exp_def in schedulable:
            experiment_id = cast(str, exp_next.experiment_id)
            scheduled_at = cast(dt.datetime, exp_next.scheduled_at)
            logger.debug(f"Processing scheduled experiment {experiment_id} at {scheduled_at}")

            get_spec_result = self._run_async(experiment2runnable(experiment_id, scheduled_at))
            try:
                is_valid = (not exp_def.is_deleted) and (cast(dict, exp_def.experiment_definition)["enabled"])
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
                    logger.error("Skipping {experiment_id} at {scheduled_at}: it is not valid!")
                else:
                    exec_result = self._run_async(
                        execute(
                            runnable.definition,
                            runnable.created_by,
                            experiment_id=experiment_id,
                            experiment_version=cast(int, exp_def.version),
                            compiler_runtime_context=runnable.compiler_runtime_context,
                            experiment_context=f"scheduled_at={runnable.scheduled_at.isoformat()}",
                        )
                    )
                    if exec_result.t is not None:
                        logger.debug(f"Execution {exec_result.t.execution_id} submitted for experiment {experiment_id}")
                    else:
                        logger.error(f"Failed to submit experiment {experiment_id}: {exec_result.e}")

                self._run_async(db_jobs.delete_experiment_next(experiment_id))
                if runnable.next_run_at and is_valid:
                    self._run_async(db_jobs.upsert_experiment_next(experiment_id=experiment_id, scheduled_at=runnable.next_run_at))
                    logger.debug(f"Next run for {experiment_id}: {runnable.next_run_at}")
                else:
                    logger.warning(f"No next run computed for {experiment_id}")
            else:
                logger.error(f"Could not create runnable for experiment {experiment_id}: {get_spec_result.e}")
                self._run_async(db_jobs.delete_experiment_next(experiment_id))

        next_schedulable_at = self._run_async(db_jobs.next_schedulable_experiment())

        sleep_duration = sleep_duration_min
        if next_schedulable_at:
            time_to_next_schedulable_at = int((next_schedulable_at - current_scheduling_time()).total_seconds())
            if time_to_next_schedulable_at > 0:
                sleep_duration = min(time_to_next_schedulable_at, sleep_duration_min)
            else:
                sleep_duration = 0

        return sleep_duration

    def run(self) -> None:
        logger.info("Scheduler thread started.")
        while not self.stop_event.is_set():
            with timed_acquire(scheduler_lock, timeout_acquire_background) as acquired:
                if not acquired:
                    logger.warning("Scheduler could not acquire scheduler_lock within timeout, skipping iteration.")
                    continue
                sleep_duration = self._try_schedule()

            if sleep_duration > 0:
                with self.sleep_condition:
                    logger.debug(f"Scheduler sleeping for {sleep_duration} seconds.")
                    self.sleep_condition.wait(sleep_duration)

    def stop(self):
        self.stop_event.set()
        with self.sleep_condition:
            logger.debug("Waking possibly sleeping scheduler.")
            self.sleep_condition.notify()
        logger.info("Scheduler thread stopped.")

    def prod(self):
        with self.sleep_condition:
            logger.debug("Prodding possibly sleeping scheduler.")
            self.sleep_condition.notify()


class Globals:
    scheduler: SchedulerThread | None = None


def start_scheduler():
    loop = asyncio.get_running_loop()
    with timed_acquire(scheduler_lock, timeout_acquire_lifecycle) as acquired:
        if not acquired:
            raise ValueError("Could not acquire scheduler_lock within timeout during start")
        if Globals.scheduler is not None:
            raise ValueError("double start")
        Globals.scheduler = SchedulerThread(loop)
        Globals.scheduler.start()


def stop_scheduler():
    with timed_acquire(scheduler_lock, timeout_acquire_lifecycle) as acquired:
        if not acquired:
            raise ValueError("Could not acquire scheduler_lock within timeout during stop")
        if Globals.scheduler is None:
            raise ValueError("unexpected stop")
        Globals.scheduler.stop()
        Globals.scheduler.prod()
        if Globals.scheduler.is_alive():  # just in case it wasnt even started
            Globals.scheduler.join(1)
        if Globals.scheduler.is_alive():
            logger.warning(f"scheduler thread {Globals.scheduler.name} / {Globals.scheduler.native_id} is alive despite stop/join!")
        Globals.scheduler = None


def prod_scheduler():
    if Globals.scheduler is None:
        logger.warning("scheduler is None! No prodding")
    else:
        Globals.scheduler.prod()


def status_scheduler():
    if not config.api.allow_scheduler:
        return "off"
    if Globals.scheduler is None:
        logger.warning("scheduler reported down due to being None")
        return "down"
    if not Globals.scheduler.is_alive():
        logger.warning("scheduler reported down due to thread not being alive")
        return "down"
    Globals.scheduler.liveness_signal.wait(0)  # we do this just for ensuring a multithread sync
    now = dt.datetime.now()
    if (
        Globals.scheduler.liveness_timestamp is None
        or (now - Globals.scheduler.liveness_timestamp) > dt.timedelta(minutes=sleep_duration_min) * 2
    ):
        logger.warning(f"scheduler reported down due to failing liveness check: {now} >> {Globals.scheduler.liveness_timestamp}")
        return "down"
    return "up"
