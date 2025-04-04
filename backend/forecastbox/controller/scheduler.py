"""
Internal scheduler of maintenance tasks (heartbeats) from scheduler to workers
"""

import asyncio
from forecastbox.controller.comm import WorkerComm
import forecastbox.controller.db as db
import datetime as dt
import logging

logger = logging.getLogger(__name__)


class MaintenanceScheduler:
    def __init__(self, worker_comm: WorkerComm) -> None:
        self.worker_comm = worker_comm
        self.stop = False
        self.task = asyncio.create_task(self.heartbeat_workers())
        self.interval_sec = 60
        self.grace = dt.timedelta(minutes=2)

    async def close(self) -> None:
        self.stop = True
        self.task.cancel()

    async def heartbeat_workers(self):
        while not self.stop:
            logger.info("executing worker heartbeats")
            for worker_id, worker in db.worker_db.all():
                ref_time = dt.datetime.now()
                if ref_time - worker.last_seen < self.grace:
                    logger.info(f"{worker_id=} seen recently, skipping")
                else:
                    if await self.worker_comm.call_heartbeat(worker.url):
                        logger.info(f"{worker_id=} heartbeated, updating")
                        db.worker_heartbeat(worker_id, ref_time)
                    else:
                        logger.error(f"{worker_id=} failed to heartbeat!")
                        # TODO some counter/issue
            await asyncio.sleep(self.interval_sec)
