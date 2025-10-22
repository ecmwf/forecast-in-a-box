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
import logging
import threading
from datetime import datetime
from typing import cast

from forecastbox.api.execution import execute
from forecastbox.api.scheduling.job_utils import schedule2spec
from forecastbox.db.schedule import (get_schedulable, insert_next_run, insert_schedule_run, mark_run_executed,
                                     next_schedulable)

logger = logging.getLogger(__name__)

scheduler_lock = threading.Lock()

class SchedulerThread(threading.Thread):
    def __init__(self):
        super().__init__()
        self._stop_event = threading.Event()
        self.sleep_condition = threading.Condition()

    async def _try_schedule(self) -> int:
        now = datetime.now()
        logger.debug(f"Scheduler inquiry at {now}")

        schedulable_runs = await get_schedulable(now)

        for run in schedulable_runs:
            schedule_id_str: str = cast(str, run.schedule_id)
            scheduled_at_dt: datetime = cast(datetime, run.scheduled_at)
            schedule_next_id_str: str = cast(str, run.schedule_next_id)
            logger.debug(f"Processing scheduled run {schedule_next_id_str} for schedule {schedule_id_str} at {scheduled_at_dt}")

            get_spec_result = await schedule2spec(schedule_id_str, scheduled_at_dt)

            if get_spec_result.t is not None:
                if get_spec_result.t.max_acceptable_delay_hours is not None and \
                   (now - scheduled_at_dt).total_seconds() / 3600 > get_spec_result.t.max_acceptable_delay_hours:
                    logger.warning(f"Skipping scheduled run {schedule_next_id_str} for schedule {schedule_id_str} at {scheduled_at_dt} "
                                   f"because it is older than max_acceptable_delay_hours ({get_spec_result.t.max_acceptable_delay_hours} hours).")
                    await insert_schedule_run(schedule_id_str, scheduled_at_dt, job_id=None, trigger="cron_skipped")
                else:
                    exec_result = await execute(get_spec_result.t.exec_spec, get_spec_result.t.created_by)
                    if exec_result.t is not None:
                        logger.debug(f"Job {exec_result.t.id} submitted for schedule {schedule_id_str}")
                        await insert_schedule_run(schedule_id_str, scheduled_at_dt, exec_result.t.id)
                    else:
                        logger.error(f"Failed to submit job for schedule {schedule_id_str} because of {exec_result.e}")
            else:
                logger.error(f"Could not create schedule spec for schedule {schedule_id_str}")

            await mark_run_executed(schedule_next_id_str)
            if get_spec_result.t is not None:
                logger.debug(f"Next run for {schedule_id_str} will be at {get_spec_result.t.next_run_at}")
                await insert_next_run(schedule_id_str, get_spec_result.t.next_run_at)

        next_schedulable_at = await next_schedulable()

        sleep_duration = 15 * 60
        if next_schedulable_at:
            time_to_next_schedulable_at = (next_schedulable_at - datetime.now()).total_seconds()
            if time_to_next_schedulable_at > 0:
                sleep_duration = min(time_to_next_schedulable_at, sleep_duration)
            else:
                sleep_duration = 0

        return sleep_duration

    async def _run(self):
        while not self._stop_event.is_set():
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
        self._stop_event.set()
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
    if Globals.scheduler is not None:
        raise ValueError("double start")
    Globals.scheduler = SchedulerThread()
    Globals.scheduler.start()

def stop_scheduler():
    if Globals.scheduler is None:
        raise ValueError("unexpected stop")

def prod_scheduler():
    if Globals.scheduler is None:
        logger.warning("scheduler is None! No prodding")
    else:
        Globals.scheduler.prod()

def status_scheduler():
    return "up" if Globals.scheduler is not None else "down"
