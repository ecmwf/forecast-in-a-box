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
import uuid
from dataclasses import dataclass
from multiprocessing.process import BaseProcess
from tempfile import TemporaryDirectory

from cascade.deployment.logging import LoggingConfig
from cascade.executor import platform
from cascade.gateway import api, client
from cascade.gateway.server import serve
from cascade.low.func import Either, assert_never

from forecastbox.domain.gateway.exceptions import (
    GatewayAlreadyRunning,
    GatewayExited,
    GatewayNotRunning,
    GatewayNotStarted,
)
from forecastbox.utility import tunnel
from forecastbox.utility.config import LocalGateway, RemoteGateway, StatusMessage, UnmanagedGateway, config

logger = logging.getLogger(__name__)


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


def _initial_connection() -> GatewayConnection | None:
    if isinstance(config.cascade.gateway, UnmanagedGateway):
        return RemoteUrl()
    return None


class GatewayConnectionManager:
    lock: threading.Lock = threading.Lock()
    gateway_connection: GatewayConnection | None = _initial_connection()


def _remote_tunnel_target() -> tuple[str, int | None]:
    if not isinstance(config.cascade.gateway, RemoteGateway):
        raise ValueError("_remote_tunnel_target called but gateway is not RemoteGateway")
    parsed_url = urllib.parse.urlparse(config.cascade.gateway.cascade_url)
    if parsed_url.hostname is None:
        raise ValueError(f"Invalid cascade_url for remote tunnel mode: {config.cascade.gateway.cascade_url!r}")
    host = f"{parsed_url.username}@{parsed_url.hostname}" if parsed_url.username else parsed_url.hostname
    return host, parsed_url.port


def _local_process_entrypoint(cascade_url: str, log_base: str | None, max_concurrent_jobs: int | None, shared_path: str | None) -> None:
    loggingConfigSer = LoggingConfig(path_base=log_base, formatter="line").ser_cliparam()
    try:
        serve(
            url=cascade_url,
            loggingConfigSer=loggingConfigSer,
            max_concurrent_jobs=max_concurrent_jobs,
            shared_path=shared_path,
        )
    except KeyboardInterrupt:
        pass


def launch_gateway() -> None:
    with GatewayConnectionManager.lock:
        if GatewayConnectionManager.gateway_connection is not None:
            raise GatewayAlreadyRunning("Process already running.")
        gateway = config.cascade.gateway
        if isinstance(gateway, LocalGateway):
            startup_params = gateway.startup_params
            max_concurrent_jobs = startup_params.max_concurrent_jobs
            cascade_logging_base = startup_params.cascade_logging_base
            shared_path = startup_params.shared_path
            logs_directory = TemporaryDirectory(prefix="fiabLogs", dir=cascade_logging_base)
            logger.debug(f"logging base is at {logs_directory.name}")
            logs_base = None if os.getenv("FIAB_LOGSTDOUT", "nay") == "yea" else logs_directory.name + os.sep
            gateway_url = f"tcp://localhost:{tunnel.claim_free_port()}"
            process = platform.get_mp_ctx("gateway").Process(
                target=_local_process_entrypoint,
                args=(gateway_url, logs_base, max_concurrent_jobs, shared_path),
            )  # type: ignore[unresolved-attribute] # context
            process.start()
            logger.debug(f"spawned new gateway process with pid {process.pid}")
            GatewayConnectionManager.gateway_connection = LocalProcess(
                logs_directory=logs_directory,
                process=process,
                gateway_url=gateway_url,
            )
        elif isinstance(gateway, RemoteGateway):
            startup_params = gateway.startup_params
            max_concurrent_jobs = startup_params.max_concurrent_jobs
            cascade_logging_base = startup_params.cascade_logging_base
            shared_path = startup_params.shared_path
            host, remote_port = _remote_tunnel_target()
            handle = tunnel.setup(host=host, remote_port=remote_port)
            log_base = f"{cascade_logging_base or '/tmp/'}fiabLogs{uuid.uuid4()}."
            logger.debug(f"logging base for tunnel gateway is {log_base}")
            remote_gateway_url = f"tcp://localhost:{handle.remote_port}"
            logging_config = LoggingConfig(path_base=log_base, formatter="line")
            cmd = [
                "uv",
                "run",
                "--with",
                "earthkit.workflows",
                "python",
                "-m",
                "cascade.gateway",
                "--url",
                remote_gateway_url,
                "--loggingConfigSer",
                logging_config.ser_cliparam(),
            ]
            if max_concurrent_jobs is not None:
                cmd.extend(["--max_concurrent_jobs", str(max_concurrent_jobs)])
            if shared_path is not None:
                cmd.extend(["--shared_path", shared_path])
            tunnel.execute(handle, ["mkdir", "-p", log_base])
            tunnel.execute(handle, cmd, output_path=log_base + "gwstdouterr")
            GatewayConnectionManager.gateway_connection = RemoteTunnel(handle=handle)
        elif isinstance(gateway, UnmanagedGateway):
            raise NotImplementedError("RemoteUrl gateway cannot be launched by backend")
        else:
            assert_never(gateway)


def get_gateway_url() -> str:
    gateway_connection = GatewayConnectionManager.gateway_connection
    if gateway_connection is None:
        raise GatewayNotRunning("Gateway is not running")
    if isinstance(gateway_connection, LocalProcess):
        return gateway_connection.gateway_url
    elif isinstance(gateway_connection, RemoteTunnel):
        return gateway_connection.handle.as_local_url()
    elif isinstance(gateway_connection, RemoteUrl):
        if isinstance(config.cascade.gateway, UnmanagedGateway):
            return config.cascade.gateway.cascade_url
        else:
            raise ValueError("RemoteUrl gateway connection but gateway is not UnmanagedGateway")
    else:
        assert_never(gateway_connection)


def get_logs_directory() -> Either[TemporaryDirectory, str]:  # ty: ignore[invalid-type-arguments]
    gateway_connection = GatewayConnectionManager.gateway_connection
    if gateway_connection is None:
        return Either.error("gateway connection not initialized")
    if isinstance(gateway_connection, LocalProcess):
        return Either.ok(gateway_connection.logs_directory)
    elif isinstance(gateway_connection, RemoteTunnel):
        return Either.error("Logs directory is available only for local gateway process")
    elif isinstance(gateway_connection, RemoteUrl):
        return Either.error("Logs directory is available only for local gateway process")
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


def get_current_cascade_proc() -> int | str:
    """Return an id of the currently active and connected gateway process."""
    gateway_connection = GatewayConnectionManager.gateway_connection
    if gateway_connection is None:
        raise GatewayNotStarted("Gateway was not started")
    if isinstance(gateway_connection, LocalProcess):
        if gateway_connection.process.exitcode is not None:
            raise GatewayExited(gateway_connection.process.exitcode)
        if gateway_connection.process.pid is None:
            raise GatewayNotStarted("Gateway process has no pid")
        return gateway_connection.process.pid
    elif isinstance(gateway_connection, RemoteTunnel):
        if tunnel.status(gateway_connection.handle):
            return uuid.uuid5(uuid.NAMESPACE_OID, repr(gateway_connection.handle)).hex[:8]
        raise GatewayExited(255)
    elif isinstance(gateway_connection, RemoteUrl):
        # TODO put something better here
        return "unmanaged"
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
        elif isinstance(gateway_connection, RemoteTunnel):
            logger.debug("remote gateway shutdown message")
            m = api.ShutdownRequest()
            client.request_response(m, gateway_connection.handle.as_local_url(), 4_000)
            # TODO -- if shutdown via gateway API fails, the nohup-launched process may outlive the tunnel.
            tunnel.stop(gateway_connection.handle)
            GatewayConnectionManager.gateway_connection = None
        elif isinstance(gateway_connection, RemoteUrl):
            raise NotImplementedError("RemoteUrl gateway cannot be stopped by backend")
        else:
            assert_never(gateway_connection)


async def shutdown_processes() -> None:
    """Terminate all running gateway processes on app shutdown."""
    gateway_connection = GatewayConnectionManager.gateway_connection
    logger.debug(f"initiating graceful gateway shutdown of {gateway_connection}")
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
    elif isinstance(gateway_connection, RemoteTunnel):
        if tunnel.status(gateway_connection.handle):
            try:
                stop_gateway()
            except GatewayNotRunning:
                pass
        else:
            with GatewayConnectionManager.lock:
                GatewayConnectionManager.gateway_connection = None
    elif isinstance(gateway_connection, RemoteUrl):
        pass
    else:
        assert_never(gateway_connection)
