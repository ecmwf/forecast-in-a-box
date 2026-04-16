# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""
Gateway operations routes — /gateway/*. Corresponds to no domain entity.

All routes are purely operational, no ids -- gateway start, status, kill."""

PREFIX = "/api/v1/gateway"
import asyncio
import logging
import os
import select
import subprocess
from dataclasses import dataclass
from multiprocessing.process import BaseProcess
from tempfile import TemporaryDirectory
from typing import NewType

from cascade.executor import platform
from cascade.gateway import api, client
from fastapi import APIRouter, HTTPException, Request
from sse_starlette.sse import EventSourceResponse

from forecastbox.entrypoint.bootstrap.launchers import launch_cascade
from forecastbox.utility.config import StatusMessage, config

logger = logging.getLogger(__name__)

GatewayProcess = NewType("GatewayProcess", BaseProcess)


def cleanup_gw(process: GatewayProcess) -> None:
    pass


def kill_gw(process: GatewayProcess) -> None:
    logger.debug("gateway shutdown message")
    m = api.ShutdownRequest()
    client.request_response(m, config.cascade.cascade_url, 4_000)
    logger.debug("gateway terminate and join")
    process.terminate()
    process.join(1)
    if process.exitcode is None:
        logger.debug("gateway kill")
        process.kill()


class Globals:
    # NOTE we cant have them at top level due to imports from other modules
    # TODO refactor the above dataclass into classmethods here, its singletons anyway
    logs_directory: TemporaryDirectory | None = None
    gateway: GatewayProcess | None = None


async def shutdown_processes() -> None:
    """Terminate all running processes on shutdown."""
    logger.debug("initiating graceful gateway shutdown")
    if Globals.gateway is not None:
        if Globals.gateway.exitcode is None:
            kill_gw(Globals.gateway)
        cleanup_gw(Globals.gateway)
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
        if Globals.gateway.exitcode is None:
            # TODO add an explicit restart option
            raise HTTPException(400, "Process already running.")
        else:
            logger.warning(f"restarting gateway as it exited with {Globals.gateway.exitcode}")
            # TODO spawn as async task? This blocks... but we'd need to lock
            cleanup_gw(Globals.gateway)
            Globals.gateway = None

    logs_directory = None if os.getenv("FIAB_LOGSTDOUT", "nay") == "yea" else Globals.logs_directory.name + os.sep
    max_concurrent_jobs = config.cascade.max_concurrent_jobs
    # TODO for some reason changes to os.environ were *not* visible by the child process! Investigate and re-enable:
    # export_recursive(config.model_dump(), config.model_config["env_nested_delimiter"], config.model_config["env_prefix"])
    process = platform.get_mp_ctx("gateway").Process(target=launch_cascade, args=(logs_directory, max_concurrent_jobs))  # type: ignore[unresolved-attribute] # context
    process.start()
    Globals.gateway = GatewayProcess(process)
    logger.debug(f"spawned new gateway process with pid {process.pid}")
    return "started"


@router.get("/status")
async def get_status() -> str:
    """Get the status of the Cascade Gateway process."""
    if Globals.gateway is None:
        return "not started"
    elif Globals.gateway.exitcode is not None:
        return f"exited with {Globals.gateway.exitcode}"
    else:
        return StatusMessage.gateway_running


@router.post("/kill")
async def kill_gateway() -> str:
    if Globals.gateway is None or Globals.gateway.exitcode is not None:
        return "not running"
    else:
        # TODO spawn as async task? This blocks... but we'd need to lock
        kill_gw(Globals.gateway)
        cleanup_gw(Globals.gateway)
        Globals.gateway = None
        return "killed"
