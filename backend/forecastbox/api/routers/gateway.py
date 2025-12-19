# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import asyncio
import datetime as dt
import logging
import os
import select
import subprocess
from dataclasses import dataclass
from multiprocessing import Process
from tempfile import TemporaryDirectory

import cascade.executor.platform as cascade_platform
import cascade.gateway.api
import cascade.gateway.client
from fastapi import APIRouter, HTTPException, Request
from sse_starlette.sse import EventSourceResponse

from forecastbox.config import StatusMessage, config
from forecastbox.standalone.launchers import launch_cascade

logger = logging.getLogger(__name__)


@dataclass
class GatewayProcess:
    log_path: str | None
    process: Process

    def cleanup(self) -> None:
        pass

    def kill(self) -> None:
        logger.debug("gateway shutdown message")
        m = cascade.gateway.api.ShutdownRequest()
        cascade.gateway.client.request_response(m, config.cascade.cascade_url, 4_000)
        logger.debug("gateway terminate and join")
        self.process.terminate()
        self.process.join(1)
        if self.process.exitcode is None:
            logger.debug("gateway kill")
            self.process.kill()


class Globals:
    # NOTE we cant have them at top level due to imports from other modules
    # TODO refactor the above dataclass into classmethods here, its singletons anyway
    logs_directory: TemporaryDirectory | None = None
    gateway: GatewayProcess | None = None


async def shutdown_processes():
    """Terminate all running processes on shutdown."""
    logger.debug("initiating graceful gateway shutdown")
    if Globals.gateway is not None:
        if Globals.gateway.process.exitcode is None:
            Globals.gateway.kill()
        Globals.gateway.cleanup()
        Globals.gateway = None


router = APIRouter(
    tags=["gateway"],
    responses={404: {"description": "Not found"}},
)


@router.post("/start")
async def start_gateway() -> str:
    if Globals.logs_directory is None:
        Globals.logs_directory = TemporaryDirectory(prefix="fiabLogs")
        logger.debug(f"logging base is at {Globals.logs_directory.name}")
    if Globals.gateway is not None:
        if Globals.gateway.process.exitcode is None:
            # TODO add an explicit restart option
            raise HTTPException(400, "Process already running.")
        else:
            logger.warning(f"restarting gateway as it exited with {Globals.gateway.process.exitcode}")
            # TODO spawn as async task? This blocks... but we'd need to lock
            Globals.gateway.cleanup()
            Globals.gateway = None

    now = dt.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    log_path = None if os.getenv("FIAB_LOGSTDOUT", "nay") == "yea" else f"{Globals.logs_directory.name}/gateway.{now}.txt"
    logs_directory = None if os.getenv("FIAB_LOGSTDOUT", "nay") == "yea" else Globals.logs_directory.name
    max_concurrent_jobs = config.cascade.max_concurrent_jobs
    # TODO for some reason changes to os.environ were *not* visible by the child process! Investigate and re-enable:
    # export_recursive(config.model_dump(), config.model_config["env_nested_delimiter"], config.model_config["env_prefix"])
    process = cascade_platform.get_mp_ctx("gateway").Process(target=launch_cascade, args=(log_path, logs_directory, max_concurrent_jobs))  # type: ignore[unresolved-attribute] # context
    process.start()
    Globals.gateway = GatewayProcess(log_path=log_path, process=process)
    logger.debug(f"spawned new gateway process with pid {process.pid} and logs at {log_path}")
    return "started"


@router.get("/status")
async def get_status() -> str:
    """Get the status of the Cascade Gateway process."""
    if Globals.gateway is None:
        return "not started"
    elif Globals.gateway.process.exitcode is not None:
        return f"exited with {Globals.gateway.process.exitcode}"
    else:
        return StatusMessage.gateway_running


@router.get("/logs")
async def stream_logs(request: Request) -> EventSourceResponse:
    """Stream logs from the Cascade Gateway process."""

    if Globals.gateway is None:
        raise HTTPException(400, "Gateway not running")

    if Globals.gateway.log_path is None:
        raise HTTPException(400, "Gateway started with logs into stdout")

    async def event_generator():
        # NOTE consider rewriting to aiofile, eg https://github.com/kuralabs/logserver/blob/master/server/server.py

        pipe = subprocess.Popen(["tail", "-F", Globals.gateway.log_path], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)  # type: ignore[no-matching-overload] # Popen
        poller = select.poll()
        poller.register(pipe.stdout)  # type: ignore[invalid-argument-type] # pipe

        while Globals.gateway.process.is_alive() and not (await request.is_disconnected()):
            while poller.poll(5):
                yield pipe.stdout.readline()
            await asyncio.sleep(1)

    return EventSourceResponse(event_generator())


@router.post("/kill")
async def kill_gateway() -> str:
    if Globals.gateway is None or Globals.gateway.process.exitcode is not None:
        return "not running"
    else:
        # TODO spawn as async task? This blocks... but we'd need to lock
        Globals.gateway.kill()
        Globals.gateway.cleanup()
        Globals.gateway = None
        return "killed"
