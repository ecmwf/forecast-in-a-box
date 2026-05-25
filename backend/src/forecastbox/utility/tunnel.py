# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Helpers for SSH multiplexing tunnels."""

import os
import random
import shlex
import socket
import subprocess
import tempfile
import threading
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

_CONTROL_ROOT = Path(tempfile.gettempdir()) / f"forecastbox-ssh-{os.getpid()}"
_REMOTE_PORT_MIN = 20_000
_REMOTE_PORT_MAX = 60_000
_SETUP_ATTEMPTS = 8

RemoteCommand = str | Sequence[str]


def _ensure_control_root() -> None:
    _CONTROL_ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)


def claim_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _claim_remote_port() -> int:
    return random.randint(_REMOTE_PORT_MIN, _REMOTE_PORT_MAX)


def _validate_port(port: int, name: str) -> None:
    if port < 1 or port > 65535:
        raise ValueError(f"{name} must be a valid TCP port: {port}")


def _new_control_path() -> str:
    _ensure_control_root()
    return str(_CONTROL_ROOT / f"{uuid.uuid4().hex[:12]}.sock")


def _ssh_base_args(control_path: str) -> list[str]:
    return [
        "ssh",
        "-S",
        control_path,
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=10",
    ]


def _ssh_run(
    args: Sequence[str],
    *,
    check: bool = True,
    start_new_session: bool = False,
) -> subprocess.CompletedProcess[str]:
    """The start_new_session prevents interrupt / Ctrl-C stopping the command
    too early -- we use this when we setup a long running ssh tunnel, because
    those we want to explicitly exit ourselves, after we have sent a gateway
    termination command over it."""
    return subprocess.run(list(args), check=check, capture_output=True, text=True, start_new_session=start_new_session)


def _is_bind_failure(exc: subprocess.CalledProcessError) -> bool:
    stderr = (exc.stderr or "").lower()
    return "cannot listen to port" in stderr or "address already in use" in stderr


def _render_remote_command(command: RemoteCommand, output_path: str = "/dev/null") -> str:
    if isinstance(command, str):
        rendered = command
    else:
        rendered = shlex.join(command)
    return f"nohup bash --login -c '{rendered}' > {output_path} 2>&1 < /dev/null &"


@dataclass(frozen=True, slots=True)
class ConnectionHandle:
    """A persisted SSH tunnel connection."""

    host: str
    control_path: str
    local_port: int
    remote_port: int

    def as_local_url(self) -> str:
        """Return the local URL for the service forwarded through the tunnel."""

        return f"tcp://localhost:{self.local_port}"


@dataclass(frozen=True, slots=True)
class CommandHandle:
    """A persistent SSH master connection for running remote commands (no port forwarding)."""

    host: str
    control_path: str


class TunnelRegistry:
    """Track live tunnel handles so the app can shut them down on exit."""

    def __init__(self) -> None:
        self._handles: set[ConnectionHandle] = set()
        self._command_handles: set[CommandHandle] = set()
        self._lock = threading.Lock()

    def register(self, handle: ConnectionHandle) -> None:
        with self._lock:
            self._handles.add(handle)

    def discard(self, handle: ConnectionHandle) -> None:
        with self._lock:
            self._handles.discard(handle)

    def register_command(self, handle: CommandHandle) -> None:
        with self._lock:
            self._command_handles.add(handle)

    def discard_command(self, handle: CommandHandle) -> None:
        with self._lock:
            self._command_handles.discard(handle)

    def shutdown(self) -> None:
        with self._lock:
            handles = tuple(self._handles)
            command_handles = tuple(self._command_handles)
        for handle in handles:
            stop(handle)
        for handle in command_handles:
            disconnect(handle)


registry = TunnelRegistry()


def setup(
    host: str,
    local_port: int | None = None,
    remote_port: int | None = None,
) -> ConnectionHandle:
    """Start an SSH master connection with a localhost port forward."""

    if local_port is not None:
        _validate_port(local_port, "local_port")
    if remote_port is not None:
        _validate_port(remote_port, "remote_port")
    last_error: subprocess.CalledProcessError | None = None
    attempts = 1 if remote_port is not None else _SETUP_ATTEMPTS
    for _ in range(attempts):
        resolved_local_port = local_port if local_port is not None else claim_free_port()
        resolved_remote_port = remote_port if remote_port is not None else _claim_remote_port()
        handle = ConnectionHandle(
            host=host,
            control_path=_new_control_path(),
            local_port=resolved_local_port,
            remote_port=resolved_remote_port,
        )
        try:
            _ssh_run(
                [
                    "ssh",
                    "-M",
                    "-f",
                    "-N",
                    "-L",
                    f"{handle.local_port}:localhost:{handle.remote_port}",
                    "-o",
                    "BatchMode=yes",
                    "-o",
                    "ConnectTimeout=10",
                    "-o",
                    "ControlMaster=auto",
                    "-o",
                    f"ControlPath={handle.control_path}",
                    "-o",
                    "ControlPersist=10m",
                    "-o",
                    "ExitOnForwardFailure=yes",
                    host,
                ],
                start_new_session=True,  # NOTE detaching to prevent early interrupt
            )
        except subprocess.CalledProcessError as exc:
            last_error = exc
            if remote_port is not None or not _is_bind_failure(exc):
                raise
            continue
        registry.register(handle)
        return handle
    raise RuntimeError("failed to establish ssh tunnel after retries") from last_error


def status(handle: ConnectionHandle) -> bool:
    """Return whether the SSH master connection is alive."""

    result = _ssh_run([*_ssh_base_args(handle.control_path), "-O", "check", handle.host], check=False)
    return result.returncode == 0


def execute(handle: ConnectionHandle, command: RemoteCommand, output_path: str = "/dev/null") -> subprocess.CompletedProcess[str]:
    """Launch a remote command over the existing SSH control socket."""

    remote_command = _render_remote_command(command, output_path)
    return _ssh_run([*_ssh_base_args(handle.control_path), handle.host, remote_command])


def stop(handle: ConnectionHandle) -> subprocess.CompletedProcess[str]:
    """Terminate an SSH master connection and remove it from the registry."""

    rv = _ssh_run([*_ssh_base_args(handle.control_path), "-O", "exit", handle.host])
    registry.discard(handle)
    return rv


def shutdown() -> None:
    """Stop all tracked SSH tunnels."""

    registry.shutdown()


def connect(host: str) -> CommandHandle:
    """Start a persistent SSH master connection without port forwarding, for running remote commands."""

    handle = CommandHandle(host=host, control_path=_new_control_path())
    _ssh_run(
        [
            "ssh",
            "-M",
            "-f",
            "-N",
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=10",
            "-o",
            "ControlMaster=auto",
            "-o",
            f"ControlPath={handle.control_path}",
            "-o",
            "ControlPersist=10m",
            host,
        ],
        start_new_session=True,
    )
    registry.register_command(handle)
    return handle


def run(handle: CommandHandle, command: RemoteCommand) -> subprocess.CompletedProcess[str]:
    """Run a command synchronously over the SSH control socket, returning stdout/stderr."""

    cmd = command if isinstance(command, str) else shlex.join(command)
    return _ssh_run([*_ssh_base_args(handle.control_path), handle.host, cmd])


def status_cmd(handle: CommandHandle) -> bool:
    """Return whether the command SSH master connection is alive."""

    result = _ssh_run([*_ssh_base_args(handle.control_path), "-O", "check", handle.host], check=False)
    return result.returncode == 0


def disconnect(handle: CommandHandle) -> subprocess.CompletedProcess[str]:
    """Terminate a command SSH master connection and remove it from the registry."""

    rv = _ssh_run([*_ssh_base_args(handle.control_path), "-O", "exit", handle.host], check=False)
    registry.discard_command(handle)
    return rv
