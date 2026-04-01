# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Canonical gateway lifecycle routes — /gateway/*"""

PREFIX = "/api/v1/gateway"
import asyncio
import logging
import os
import select
import subprocess
from dataclasses import dataclass
from multiprocessing.process import BaseProcess
from tempfile import TemporaryDirectory

import cascade.executor.platform as cascade_platform
import cascade.gateway.api
import cascade.gateway.client
from fastapi import APIRouter, HTTPException, Request
from sse_starlette.sse import EventSourceResponse

from forecastbox.entrypoint.bootstrap.launchers import launch_cascade
from forecastbox.utility.config import StatusMessage, config

logger = logging.getLogger(__name__)


@dataclass
class GatewayProcess:
    process: BaseProcess

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


async def shutdown_processes() -> None:
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

    logs_directory = None if os.getenv("FIAB_LOGSTDOUT", "nay") == "yea" else Globals.logs_directory.name + os.sep
    max_concurrent_jobs = config.cascade.max_concurrent_jobs
    # TODO for some reason changes to os.environ were *not* visible by the child process! Investigate and re-enable:
    # export_recursive(config.model_dump(), config.model_config["env_nested_delimiter"], config.model_config["env_prefix"])
    process = cascade_platform.get_mp_ctx("gateway").Process(target=launch_cascade, args=(logs_directory, max_concurrent_jobs))  # type: ignore[unresolved-attribute] # context
    process.start()
    Globals.gateway = GatewayProcess(process=process)
    logger.debug(f"spawned new gateway process with pid {process.pid}")
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
