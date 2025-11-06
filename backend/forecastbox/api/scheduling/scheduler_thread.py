# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""The main loop of the scheduler -- checks the ScheduledRun table, submits jobs.
Runs in its own thread with its own async loop (which makes low sense, but it uses
many async methods shared with the backend)
"""

# NOTE this asyncio here is really odd. Either consider running in main task loop,
# (but can we reliably and neatly wake/stop/status-check/restart then?), or have
# non-async methods as well

import asyncio
import datetime as dt
import logging
import threading
from typing import cast

from forecastbox.api.execution import execute
from forecastbox.api.scheduling.dt_utils import calculate_next_run
from forecastbox.api.scheduling.job_utils import schedule2runnable
from forecastbox.config import config
from forecastbox.db.schedule import (delete_schedule_next_run, get_schedulable, insert_next_run, insert_schedule_run,
                                     mark_run_executed, next_schedulable)

logger = logging.getLogger(__name__)

# NOTE this lock can be locked externally, eg when updating schedules. For all operations
# potentially involving the ScheduleNext table etc, as well as scheduler instance itself
# to guarantee the singleton nature
scheduler_lock = threading.Lock()

# NOTE this does not really affect how often scheduler checks for new jobs --
# if anything is scheduled for earlier, we sleep for shorter time in advance,
# or are `prod`ed explicitly. The actual importance of this interval is to
# implement liveness checks correctly
sleep_duration_min: int = 15 * 60

class SchedulerThread(threading.Thread):
    def __init__(self):
        super().__init__()
        self.stop_event = threading.Event()
        self.sleep_condition = threading.Condition()
        self.liveness_timestamp: dt.datetime|None = None
        self.liveness_signal = threading.Event()

    def mark_alive(self) -> dt.datetime:
        self.liveness_timestamp = dt.datetime.now()
        self.liveness_signal.set()
        return self.liveness_timestamp

    async def _try_schedule(self) -> int:
        now = self.mark_alive()
        logger.debug(f"Scheduler inquiry at {now}")

        schedulable_runs = await get_schedulable(now)

        for run in schedulable_runs:
            schedule_id_str: str = cast(str, run.schedule_id)
            scheduled_at_dt: dt.datetime = cast(dt.datetime, run.scheduled_at)
            schedule_next_id_str: str = cast(str, run.schedule_next_id)
            logger.debug(f"Processing scheduled run {schedule_next_id_str} for schedule {schedule_id_str} at {scheduled_at_dt}")

            get_spec_result = await schedule2runnable(schedule_id_str, scheduled_at_dt)

            if get_spec_result.t is not None:
                if get_spec_result.t.max_acceptable_delay_hours is not None and \
                   (now - scheduled_at_dt).total_seconds() / 3600 > get_spec_result.t.max_acceptable_delay_hours:
                    logger.warning(f"Skipping scheduled run {schedule_next_id_str} for schedule {schedule_id_str} at {scheduled_at_dt} "
                                   f"because it is older than max_acceptable_delay_hours ({get_spec_result.t.max_acceptable_delay_hours} hours).")
                    await insert_schedule_run(schedule_id_str, scheduled_at_dt, job_id=None, trigger="cron_skipped", attempt_cnt = get_spec_result.t.attempt_cnt)
                else:
                    exec_result = await execute(get_spec_result.t.exec_spec, get_spec_result.t.created_by)
                    if exec_result.t is not None:
                        logger.debug(f"Job {exec_result.t.id} submitted for schedule {schedule_id_str}")
                        await insert_schedule_run(schedule_id_str, scheduled_at_dt, exec_result.t.id, attempt_cnt = get_spec_result.t.attempt_cnt)
                    else:
                        logger.error(f"Failed to submit job for schedule {schedule_id_str} because of {exec_result.e}")
            else:
                logger.error(f"Could not create schedule spec for schedule {schedule_id_str}")

            await mark_run_executed(schedule_next_id_str)
            if get_spec_result.t is not None:
                if get_spec_result.t.next_run_at:
                    logger.debug(f"Next run for {schedule_id_str} will be at {get_spec_result.t.next_run_at}")
                    await insert_next_run(schedule_id_str, get_spec_result.t.next_run_at)
                else:
                    logger.warning(f"No next run for {schedule_id_str}, not scheduling")
                    # logging as warning because its not expected rn, but presumably we'll supported bounded-ocurrence schedules eventually

        next_schedulable_at = await next_schedulable()

        sleep_duration = sleep_duration_min
        if next_schedulable_at:
            time_to_next_schedulable_at = (next_schedulable_at - dt.datetime.now()).total_seconds()
            if time_to_next_schedulable_at > 0:
                sleep_duration = min(time_to_next_schedulable_at, sleep_duration_min)
            else:
                sleep_duration = 0

        return sleep_duration

    async def _run(self):
        while not self.stop_event.is_set():
            with scheduler_lock:
                sleep_duration = await self._try_schedule()

            if sleep_duration > 0:
                with self.sleep_condition:
                    logger.debug(f"Scheduler sleeping for {sleep_duration} seconds.")
                    # NOTE this probably blocks the asyncio loop, but we dont really care
                    self.sleep_condition.wait(sleep_duration)

    def run(self):
        logger.info("Scheduler thread started.")
        asyncio.run(self._run())

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
    with scheduler_lock:
        if Globals.scheduler is not None:
            raise ValueError("double start")
        Globals.scheduler = SchedulerThread()
        Globals.scheduler.start()

def stop_scheduler():
    with scheduler_lock:
        if Globals.scheduler is None:
            raise ValueError("unexpected stop")
        Globals.scheduler.stop()
        Globals.scheduler.prod()
        if Globals.scheduler.is_alive(): # just in case it wasnt even started
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
    Globals.scheduler.liveness_signal.wait(0) # we do this just for ensuring a multithread sync
    now = dt.datetime.now()
    if (now - Globals.scheduler.liveness_timestamp) > dt.timedelta(minutes=sleep_duration_min) * 2:
        logger.warning(f"scheduler reported down due to failing liveness check: {now} >> {Globals.scheduler.liveness_timestamp}")
        return "down"
    return "up"

# NOTE this is not a class method of scheduler because its called from a different thread
async def regenerate_schedule_next(schedule_id: str, cron_expr: str, enabled: bool) -> None:
    await delete_schedule_next_run(schedule_id)

    if enabled:
        next_run_at = calculate_next_run(dt.datetime.now(), cron_expr)
        await insert_next_run(schedule_id, next_run_at)
        logger.debug(f"Regenerated next run for {schedule_id} at {next_run_at}")
    else:
        logger.debug(f"Schedule {schedule_id} is disabled, no next run inserted.")
