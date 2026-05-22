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
import urllib.parse
from dataclasses import dataclass
from multiprocessing.process import BaseProcess
from tempfile import TemporaryDirectory

from cascade.deployment.logging import LoggingConfig
from cascade.executor import platform
from cascade.gateway import api, client
from cascade.gateway.server import main_enp
from cascade.low.func import assert_never

from forecastbox.domain.gateway.exceptions import (
    GatewayAlreadyRunning,
    GatewayExited,
    GatewayNotRunning,
    GatewayNotStarted,
)
from forecastbox.utility import tunnel
from forecastbox.utility.config import StatusMessage, config

logger = logging.getLogger(__name__)
_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


@dataclass(frozen=True, eq=True, slots=True)
class LocalProcess:
    logs_directory: TemporaryDirectory
    process: BaseProcess
    gateway_url: str


@dataclass(frozen=True, eq=True, slots=True)
class RemoteTunnel:
    handle: tunnel.ConnectionHandle


@dataclass(frozen=True, eq=True, slots=True)
class RemoteUrl:
    pass


GatewayConnection = LocalProcess | RemoteTunnel | RemoteUrl
GatewayConnectionType = type[LocalProcess] | type[RemoteTunnel] | type[RemoteUrl]


def config2gatewayMethod() -> GatewayConnectionType:
    parsed_url = urllib.parse.urlparse(config.cascade.cascade_url)
    if not config.cascade.spawn_gateway:
        return RemoteUrl
    if parsed_url.hostname in _LOCAL_HOSTS:
        return LocalProcess
    return RemoteTunnel


def _initial_connection() -> GatewayConnection | None:
    gateway_method = config2gatewayMethod()
    if gateway_method is RemoteUrl:
        return RemoteUrl()
    return None


class GatewayConnectionManager:
    lock: threading.Lock = threading.Lock()
    gateway_connection: GatewayConnection | None = _initial_connection()


def _remote_tunnel_target_and_port() -> tuple[str, int]:
    parsed_url = urllib.parse.urlparse(config.cascade.cascade_url)
    if parsed_url.hostname is None or parsed_url.port is None:
        raise ValueError(f"Invalid cascade_url for remote tunnel mode: {config.cascade.cascade_url!r}")
    host = f"{parsed_url.username}@{parsed_url.hostname}" if parsed_url.username else parsed_url.hostname
    return host, parsed_url.port


def _local_process_entrypoint(cascade_url: str, log_base: str | None, max_concurrent_jobs: int | None) -> None:
    logging_config = LoggingConfig(path_base=log_base, formatter="line")
    try:
        main_enp(url=cascade_url, loggingConfig=logging_config, max_concurrent_jobs=max_concurrent_jobs)
    except KeyboardInterrupt:
        pass


def launch_gateway() -> None:
    with GatewayConnectionManager.lock:
        if GatewayConnectionManager.gateway_connection is not None:
            raise GatewayAlreadyRunning("Process already running.")
        gateway_method = config2gatewayMethod()
        max_concurrent_jobs = config.cascade.max_concurrent_jobs
        if gateway_method is LocalProcess:
            logs_directory = TemporaryDirectory(prefix="fiabLogs")
            logger.debug(f"logging base is at {logs_directory.name}")
            logs_base = None if os.getenv("FIAB_LOGSTDOUT", "nay") == "yea" else logs_directory.name + os.sep
            gateway_url = f"tcp://localhost:{tunnel.claim_free_port()}"
            process = platform.get_mp_ctx("gateway").Process(
                target=_local_process_entrypoint,
                args=(gateway_url, logs_base, max_concurrent_jobs),
            )  # type: ignore[unresolved-attribute] # context
            process.start()
            logger.debug(f"spawned new gateway process with pid {process.pid}")
            GatewayConnectionManager.gateway_connection = LocalProcess(
                logs_directory=logs_directory,
                process=process,
                gateway_url=gateway_url,
            )
            return
        elif gateway_method is RemoteTunnel:
            host, remote_port = _remote_tunnel_target_and_port()
            handle = tunnel.setup(host=host, remote_port=remote_port)
            remote_gateway_url = f"tcp://localhost:{handle.remote_port}"
            cmd = ["uv", "run", "python", "-m", "cascade.gateway", "--url", remote_gateway_url]
            if max_concurrent_jobs is not None:
                cmd.extend(["--max_concurrent_jobs", str(max_concurrent_jobs)])
            tunnel.execute(handle, cmd)
            GatewayConnectionManager.gateway_connection = RemoteTunnel(handle=handle)
        elif gateway_method is RemoteUrl:
            raise NotImplementedError("RemoteUrl gateway cannot be launched by backend")
        else:
            assert_never(gateway_method)


def get_gateway_url() -> str:
    gateway_connection = GatewayConnectionManager.gateway_connection
    if gateway_connection is None:
        raise GatewayNotRunning("Gateway is not running")
    if isinstance(gateway_connection, LocalProcess):
        return gateway_connection.gateway_url
    elif isinstance(gateway_connection, RemoteTunnel):
        return gateway_connection.handle.as_local_url()
    elif isinstance(gateway_connection, RemoteUrl):
        return config.cascade.cascade_url
    else:
        assert_never(gateway_connection)


def get_logs_directory() -> TemporaryDirectory | None:
    gateway_connection = GatewayConnectionManager.gateway_connection
    if gateway_connection is None:
        return None
    if isinstance(gateway_connection, LocalProcess):
        return gateway_connection.logs_directory
    elif isinstance(gateway_connection, RemoteTunnel):
        raise NotImplementedError("Logs directory is available only for local gateway process")
    elif isinstance(gateway_connection, RemoteUrl):
        raise NotImplementedError("Logs directory is available only for local gateway process")
    else:
        assert_never(gateway_connection)


def status_gateway() -> str:
    gateway_connection = GatewayConnectionManager.gateway_connection
    if gateway_connection is None:
        raise GatewayNotStarted("Gateway was not started")
    if isinstance(gateway_connection, LocalProcess):
        if gateway_connection.process.exitcode is not None:
            raise GatewayExited(gateway_connection.process.exitcode)
        return StatusMessage.gateway_running
    elif isinstance(gateway_connection, RemoteTunnel):
        # TODO -- call gw status api once available, on fallback run command to check the proc status?
        if tunnel.status(gateway_connection.handle):
            return StatusMessage.gateway_running
        raise GatewayExited(255)
    elif isinstance(gateway_connection, RemoteUrl):
        # TODO -- actually attempt resolving the url, then call gw status api once its available.
        return StatusMessage.gateway_running
    else:
        assert_never(gateway_connection)


def stop_gateway() -> None:
    with GatewayConnectionManager.lock:
        gateway_connection = GatewayConnectionManager.gateway_connection
        if gateway_connection is None:
            raise GatewayNotRunning("Gateway is not running")
        if isinstance(gateway_connection, LocalProcess):
            if gateway_connection.process.exitcode is not None:
                raise GatewayNotRunning("Gateway is not running")
            logger.debug("gateway shutdown message")
            m = api.ShutdownRequest()
            client.request_response(m, gateway_connection.gateway_url, 4_000)
            logger.debug("gateway terminate and join")

            process = gateway_connection.process
            process.terminate()
            process.join(1)
            if process.exitcode is None:
                logger.debug("gateway kill")
                process.kill()
            GatewayConnectionManager.gateway_connection = None
            return
        elif isinstance(gateway_connection, RemoteTunnel):
            logger.debug("remote gateway shutdown message")
            m = api.ShutdownRequest()
            client.request_response(m, gateway_connection.handle.as_local_url(), 4_000)
            # TODO -- if shutdown via gateway API fails, the nohup-launched process may outlive the tunnel.
            tunnel.stop(gateway_connection.handle)
            GatewayConnectionManager.gateway_connection = None
            return
        elif isinstance(gateway_connection, RemoteUrl):
            raise NotImplementedError("RemoteUrl gateway cannot be stopped by backend")
        else:
            assert_never(gateway_connection)


async def shutdown_processes() -> None:
    """Terminate all running gateway processes on app shutdown."""
    logger.debug("initiating graceful gateway shutdown")
    gateway_connection = GatewayConnectionManager.gateway_connection
    if gateway_connection is None:
        return
    if isinstance(gateway_connection, LocalProcess):
        if gateway_connection.process.exitcode is None:
            try:
                stop_gateway()
            except GatewayNotRunning:
                pass
        else:
            with GatewayConnectionManager.lock:
                GatewayConnectionManager.gateway_connection = None
        return
    elif isinstance(gateway_connection, RemoteTunnel):
        if tunnel.status(gateway_connection.handle):
            try:
                stop_gateway()
            except GatewayNotRunning:
                pass
        else:
            with GatewayConnectionManager.lock:
                GatewayConnectionManager.gateway_connection = None
        return
    elif isinstance(gateway_connection, RemoteUrl):
        return
    else:
        assert_never(gateway_connection)
