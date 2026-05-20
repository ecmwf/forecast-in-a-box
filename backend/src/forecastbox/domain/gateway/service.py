# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Gateway lifecycle and URL management for the backend."""

import logging
import os
import threading
from dataclasses import dataclass
from multiprocessing.process import BaseProcess
from tempfile import TemporaryDirectory

from cascade.deployment.logging import LoggingConfig
from cascade.executor import platform
from cascade.gateway import api, client
from cascade.gateway.server import main_enp

from forecastbox.domain.gateway.exceptions import (
    GatewayAlreadyRunning,
    GatewayExited,
    GatewayNotRunning,
    GatewayNotStarted,
)
from forecastbox.utility.config import StatusMessage, config

logger = logging.getLogger(__name__)


@dataclass(frozen=True, eq=True, slots=True)
class GatewayProcess:
    logs_directory: TemporaryDirectory
    process: BaseProcess


class GatewayConnectionManager:
    lock: threading.Lock = threading.Lock()
    gateway_process: GatewayProcess | None = None


def launch_cascade(cascade_url: str, log_base: str | None, max_concurrent_jobs: int | None) -> None:
    logging_config = LoggingConfig(path_base=log_base, formatter="line")
    try:
        main_enp(url=cascade_url, loggingConfig=logging_config, max_concurrent_jobs=max_concurrent_jobs)
    except KeyboardInterrupt:
        pass


def launch_gateway() -> None:
    with GatewayConnectionManager.lock:
        if GatewayConnectionManager.gateway_process is not None:
            raise GatewayAlreadyRunning("Process already running.")
        logs_directory = TemporaryDirectory(prefix="fiabLogs")
        logger.debug(f"logging base is at {logs_directory.name}")
        logs_base = None if os.getenv("FIAB_LOGSTDOUT", "nay") == "yea" else logs_directory.name + os.sep
        max_concurrent_jobs = config.cascade.max_concurrent_jobs
        process = platform.get_mp_ctx("gateway").Process(
            target=launch_cascade,
            args=(config.cascade.cascade_url, logs_base, max_concurrent_jobs),
        )  # type: ignore[unresolved-attribute] # context
        process.start()
        logger.debug(f"spawned new gateway process with pid {process.pid}")
        GatewayConnectionManager.gateway_process = GatewayProcess(logs_directory=logs_directory, process=process)


def get_gateway_url() -> str:
    if GatewayConnectionManager.gateway_process is None:
        raise GatewayNotRunning("Gateway is not running")
    return config.cascade.cascade_url


def get_logs_directory() -> TemporaryDirectory | None:
    gateway_process = GatewayConnectionManager.gateway_process
    if gateway_process is None:
        return None
    return gateway_process.logs_directory


def status_gateway() -> str:
    gateway_process = GatewayConnectionManager.gateway_process
    if gateway_process is None:
        raise GatewayNotStarted("Gateway was not started")
    if gateway_process.process.exitcode is not None:
        raise GatewayExited(gateway_process.process.exitcode)
    return StatusMessage.gateway_running


def stop_gateway() -> None:
    with GatewayConnectionManager.lock:
        gateway_process = GatewayConnectionManager.gateway_process
        if gateway_process is None or gateway_process.process.exitcode is not None:
            raise GatewayNotRunning("Gateway is not running")

        logger.debug("gateway shutdown message")
        m = api.ShutdownRequest()
        client.request_response(m, get_gateway_url(), 4_000)
        logger.debug("gateway terminate and join")

        process = gateway_process.process
        process.terminate()
        process.join(1)
        if process.exitcode is None:
            logger.debug("gateway kill")
            process.kill()
        GatewayConnectionManager.gateway_process = None


async def shutdown_processes() -> None:
    """Terminate all running gateway processes on app shutdown."""
    logger.debug("initiating graceful gateway shutdown")
    gateway_process = GatewayConnectionManager.gateway_process
    if gateway_process is None:
        return
    if gateway_process.process.exitcode is None:
        try:
            stop_gateway()
        except GatewayNotRunning:
            pass
    else:
        GatewayConnectionManager.gateway_process = None
