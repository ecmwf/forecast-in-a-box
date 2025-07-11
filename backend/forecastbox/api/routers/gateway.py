# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

from dataclasses import dataclass
from sse_starlette.sse import EventSourceResponse
import subprocess
import select
import asyncio
import logging
import datetime as dt
from multiprocessing import Process, get_context
from tempfile import TemporaryDirectory

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
import cascade.gateway.api
import cascade.gateway.client

from forecastbox.config import config
from forecastbox.standalone.entrypoint import launch_cascade

logger = logging.getLogger(__name__)


@dataclass
class GatewayProcess:
    log_path: str
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


logs_directory: TemporaryDirectory | None = None
gateway: GatewayProcess | None = None


async def shutdown_processes():
    """Terminate all running processes on shutdown."""
    logger.debug("initiating graceful gateway shutdown")
    global gateway
    if gateway is not None:
        if gateway.process.exitcode is None:
            gateway.kill()
        gateway.cleanup()
        gateway = None


router = APIRouter(
    tags=["gateway"],
    responses={404: {"description": "Not found"}},
    on_shutdown=[shutdown_processes],
)


@router.post("/start")
async def start_gateway() -> str:
    global gateway
    global logs_directory
    if logs_directory is None:
        logs_directory = TemporaryDirectory(prefix="fiabLogs")
        logger.debug(f"logging base is at {logs_directory.name}")
    if gateway is not None:
        if gateway.process.exitcode is None:
            # TODO add an explicit restart option
            raise HTTPException(400, "Process already running.")
        else:
            logger.warning(f"restarting gateway as it exited with {gateway.process.exitcode}")
            # TODO spawn as async task? This blocks... but we'd need to lock
            gateway.cleanup()
            gateway = None

    now = dt.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    log_path = f"{logs_directory.name}/gateway.{now}.txt"
    # TODO for some reason changes to os.environ were *not* visible by the child process! Investigate and re-enable:
    # export_recursive(config.model_dump(), config.model_config["env_nested_delimiter"], config.model_config["env_prefix"])
    process = get_context("forkserver").Process(target=launch_cascade, args=(log_path, logs_directory.name))
    process.start()
    gateway = GatewayProcess(log_path=log_path, process=process)
    logger.debug(f"spawned new gateway process with pid {process.pid} and logs at {log_path}")
    return "started"


@router.get("/status")
async def get_status() -> str:
    """Get the status of the Cascade Gateway process."""
    if gateway is None:
        return "not started"
    elif gateway.process.exitcode is not None:
        return f"exited with {gateway.process.exitcode}"
    else:
        return "running"


@router.get("/logs")
async def stream_logs(request: Request) -> StreamingResponse:
    """Stream logs from the Cascade Gateway process."""

    if gateway is None:
        raise HTTPException(400, "Gateway not running")

    async def event_generator():
        # NOTE consider rewriting to aiofile, eg https://github.com/kuralabs/logserver/blob/master/server/server.py

        pipe = subprocess.Popen(["tail", "-F", gateway.log_path], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        poller = select.poll()
        poller.register(pipe.stdout)

        while gateway.process.is_alive() and not (await request.is_disconnected()):
            while poller.poll(5):
                yield pipe.stdout.readline()
            await asyncio.sleep(1)

    return EventSourceResponse(event_generator())


@router.post("/kill")
async def kill_gateway() -> str:
    global gateway
    if gateway is None or gateway.process.exitcode is not None:
        return "not running"
    else:
        # TODO spawn as async task? This blocks... but we'd need to lock
        gateway.kill()
        gateway.cleanup()
        gateway = None
        return "killed"
