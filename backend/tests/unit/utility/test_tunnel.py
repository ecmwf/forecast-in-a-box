from __future__ import annotations

import subprocess

import pytest

import forecastbox.utility.tunnel as tunnel
from forecastbox.utility.tunnel import ConnectionHandle, TunnelRegistry


@pytest.fixture
def fresh_registry(monkeypatch: pytest.MonkeyPatch) -> TunnelRegistry:
    registry = TunnelRegistry()
    monkeypatch.setattr(tunnel, "registry", registry)
    return registry


@pytest.fixture
def ssh_calls(monkeypatch: pytest.MonkeyPatch) -> list[tuple[list[str], bool, bool]]:
    calls: list[tuple[list[str], bool, bool]] = []

    def fake_run(args: list[str], *, check: bool = True, start_new_session: bool = False) -> subprocess.CompletedProcess[str]:
        calls.append((args, check, start_new_session))
        return subprocess.CompletedProcess(args=args, returncode=0, stdout="", stderr="")

    monkeypatch.setattr(tunnel, "_ssh_run", fake_run)
    return calls


def test_setup_registers_tunnel_and_builds_master_command(
    fresh_registry: TunnelRegistry,
    monkeypatch: pytest.MonkeyPatch,
    ssh_calls: list[tuple[list[str], bool, bool]],
) -> None:
    monkeypatch.setattr(tunnel, "claim_free_port", lambda: 21001)
    monkeypatch.setattr(tunnel, "_claim_remote_port", lambda: 31001)
    monkeypatch.setattr(tunnel, "_new_control_path", lambda: "/tmp/forecastbox-ssh/test.sock")

    handle = tunnel.setup("fiabServer")

    assert handle == ConnectionHandle(
        host="fiabServer",
        control_path="/tmp/forecastbox-ssh/test.sock",
        local_port=21001,
        remote_port=31001,
    )
    assert handle.as_local_url() == "tcp://localhost:21001"
    assert handle in fresh_registry._handles
    assert ssh_calls == [
        (
            [
                "ssh",
                "-M",
                "-f",
                "-N",
                "-L",
                "21001:localhost:31001",
                "-o",
                "BatchMode=yes",
                "-o",
                "ConnectTimeout=10",
                "-o",
                "ControlMaster=auto",
                "-o",
                "ControlPath=/tmp/forecastbox-ssh/test.sock",
                "-o",
                "ControlPersist=10m",
                "-o",
                "ExitOnForwardFailure=yes",
                "fiabServer",
            ],
            True,
            True,
        )
    ]


def test_setup_retries_on_bind_failure(
    fresh_registry: TunnelRegistry,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    local_ports = iter([21001, 21001])
    remote_ports = iter([31001, 31002])
    control_paths = iter(["/tmp/forecastbox-ssh/a.sock", "/tmp/forecastbox-ssh/b.sock"])
    ssh_calls: list[tuple[list[str], bool, bool]] = []

    monkeypatch.setattr(tunnel, "claim_free_port", lambda: next(local_ports))
    monkeypatch.setattr(tunnel, "_claim_remote_port", lambda: next(remote_ports))
    monkeypatch.setattr(tunnel, "_new_control_path", lambda: next(control_paths))

    def fake_run(args: list[str], *, check: bool = True, start_new_session: bool = False) -> subprocess.CompletedProcess[str]:
        ssh_calls.append((args, check, start_new_session))
        if len(ssh_calls) == 1:
            raise subprocess.CalledProcessError(
                returncode=255,
                cmd=args,
                stderr="channel_setup_fwd_listener_tcpip: cannot listen to port: Address already in use",
            )
        return subprocess.CompletedProcess(args=args, returncode=0, stdout="", stderr="")

    monkeypatch.setattr(tunnel, "_ssh_run", fake_run)

    handle = tunnel.setup("fiabServer")

    assert handle.remote_port == 31002
    assert handle in fresh_registry._handles
    assert ssh_calls == [
        (
            [
                "ssh",
                "-M",
                "-f",
                "-N",
                "-L",
                "21001:localhost:31001",
                "-o",
                "BatchMode=yes",
                "-o",
                "ConnectTimeout=10",
                "-o",
                "ControlMaster=auto",
                "-o",
                "ControlPath=/tmp/forecastbox-ssh/a.sock",
                "-o",
                "ControlPersist=10m",
                "-o",
                "ExitOnForwardFailure=yes",
                "fiabServer",
            ],
            True,
            True,
        ),
        (
            [
                "ssh",
                "-M",
                "-f",
                "-N",
                "-L",
                "21001:localhost:31002",
                "-o",
                "BatchMode=yes",
                "-o",
                "ConnectTimeout=10",
                "-o",
                "ControlMaster=auto",
                "-o",
                "ControlPath=/tmp/forecastbox-ssh/b.sock",
                "-o",
                "ControlPersist=10m",
                "-o",
                "ExitOnForwardFailure=yes",
                "fiabServer",
            ],
            True,
            True,
        ),
    ]


def test_status_execute_and_stop_use_existing_control_socket(
    fresh_registry: TunnelRegistry,
    ssh_calls: list[tuple[list[str], bool, bool]],
) -> None:
    handle = ConnectionHandle(
        host="user@fiabServer",
        control_path="/tmp/forecastbox-ssh/test.sock",
        local_port=21001,
        remote_port=22001,
    )
    fresh_registry.register(handle)

    assert tunnel.status(handle) is True
    tunnel.execute(handle, ["uv", "run", "python", "-m", "cascade.gateway", "--port", "22001"])
    tunnel.stop(handle)

    assert handle not in fresh_registry._handles
    assert ssh_calls == [
        (
            [
                "ssh",
                "-S",
                "/tmp/forecastbox-ssh/test.sock",
                "-o",
                "BatchMode=yes",
                "-o",
                "ConnectTimeout=10",
                "-O",
                "check",
                "user@fiabServer",
            ],
            False,
            False,
        ),
        (
            [
                "ssh",
                "-S",
                "/tmp/forecastbox-ssh/test.sock",
                "-o",
                "BatchMode=yes",
                "-o",
                "ConnectTimeout=10",
                "user@fiabServer",
                "nohup bash --login -c 'uv run python -m cascade.gateway --port 22001' > /dev/null 2>&1 < /dev/null &",
            ],
            True,
            False,
        ),
        (
            [
                "ssh",
                "-S",
                "/tmp/forecastbox-ssh/test.sock",
                "-o",
                "BatchMode=yes",
                "-o",
                "ConnectTimeout=10",
                "-O",
                "exit",
                "user@fiabServer",
            ],
            True,
            False,
        ),
    ]


def test_shutdown_stops_all_tracked_handles(
    fresh_registry: TunnelRegistry,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handles = [
        ConnectionHandle("host-a", "/tmp/forecastbox-ssh/a.sock", 21001, 22001),
        ConnectionHandle("host-b", "/tmp/forecastbox-ssh/b.sock", 21002, 22002),
    ]
    for handle in handles:
        fresh_registry.register(handle)

    seen: list[ConnectionHandle] = []

    def fake_stop(handle: ConnectionHandle) -> None:
        seen.append(handle)
        fresh_registry.discard(handle)

    monkeypatch.setattr(tunnel, "stop", fake_stop)

    tunnel.shutdown()

    assert set(seen) == set(handles)
    assert len(fresh_registry._handles) == 0
