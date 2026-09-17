from __future__ import annotations

from dataclasses import dataclass
from typing import Any, cast

import pytest

import forecastbox.domain.gateway.service as gateway_service
from forecastbox.domain.gateway.exceptions import GatewayExited, GatewayNotRunning, GatewayNotStarted
from forecastbox.utility.config import GatewayStartupParams, LocalGateway, RemoteGateway, StatusMessage, UnmanagedGateway, config


def test_local_process_entrypoint_passes_shared_path(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    def _fake_serve(**kwargs: Any) -> None:
        captured.update(kwargs)

    monkeypatch.setattr(gateway_service, "serve", _fake_serve)

    gateway_service._local_process_entrypoint("tcp://localhost:1234", "/tmp/logs", 2, "/mnt/shared")

    assert captured["url"] == "tcp://localhost:1234"
    assert captured["shared_path"] == "/mnt/shared"
    assert captured["max_concurrent_jobs"] == 2


@dataclass(frozen=True, slots=True)
class _FakeHandle:
    remote_port: int

    def as_local_url(self) -> str:
        return "tcp://localhost:7777"


def test_launch_gateway_local_forwards_shared_path_to_process_args(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    class _FakeProcess:
        def __init__(self, target: Any, args: tuple[Any, ...]) -> None:
            captured["target"] = target
            captured["args"] = args
            self.pid = 42
            self.exitcode = None

        def start(self) -> None:
            return None

    class _FakeCtx:
        def Process(self, target: Any, args: tuple[Any, ...]) -> _FakeProcess:  # noqa: N802
            return _FakeProcess(target=target, args=args)

    monkeypatch.setattr(
        config.cascade,
        "gateway",
        LocalGateway(
            gateway_type="local",
            startup_params=GatewayStartupParams(shared_path="/mnt/shared"),
        ),
    )
    monkeypatch.setenv("FIAB_BACKEND_LOG_DIRECTORY", "/tmp/fiab")
    monkeypatch.setattr(gateway_service.tunnel, "claim_free_port", lambda: 45678)
    monkeypatch.setattr(gateway_service.platform, "get_mp_ctx", lambda _: _FakeCtx())
    monkeypatch.setattr(gateway_service.GatewayConnectionManager, "gateway_connection", None)

    gateway_service.launch_gateway()

    assert captured["target"] is gateway_service._local_process_entrypoint
    assert captured["args"][3] == "/mnt/shared"
    gateway_service.GatewayConnectionManager.gateway_connection = None


def test_launch_gateway_unmanaged_is_a_no_op(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture) -> None:
    monkeypatch.setattr(config.cascade, "gateway", UnmanagedGateway(gateway_type="unmanaged", cascade_url="tcp://remote:1234"))
    monkeypatch.setattr(gateway_service.GatewayConnectionManager, "gateway_connection", None)

    def _fail_get_mp_ctx(*args: Any, **kwargs: Any) -> Any:
        raise AssertionError("local gateway process must not be spawned for an unmanaged gateway")

    def _fail_tunnel_setup(*args: Any, **kwargs: Any) -> Any:
        raise AssertionError("remote tunnel must not be set up for an unmanaged gateway")

    monkeypatch.setattr(gateway_service.platform, "get_mp_ctx", _fail_get_mp_ctx)
    monkeypatch.setattr(gateway_service.tunnel, "setup", _fail_tunnel_setup)

    with caplog.at_level("WARNING"):
        gateway_service.launch_gateway()

    assert gateway_service.GatewayConnectionManager.gateway_connection is None
    assert any("no-op" in record.message for record in caplog.records)


def test_ensure_gateway_returns_once_status_reports_running(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(gateway_service, "status_gateway", lambda: StatusMessage.gateway_running)
    sleeps: list[float] = []
    monkeypatch.setattr(gateway_service.time, "sleep", sleeps.append)

    gateway_service.ensure_gateway()

    assert sleeps == []


def test_ensure_gateway_retries_on_not_started_then_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = {"count": 0}

    def _status_gateway() -> str:
        calls["count"] += 1
        if calls["count"] < 3:
            raise GatewayNotStarted("not yet")
        return StatusMessage.gateway_running

    monkeypatch.setattr(gateway_service, "status_gateway", _status_gateway)
    sleeps: list[float] = []
    monkeypatch.setattr(gateway_service.time, "sleep", sleeps.append)

    gateway_service.ensure_gateway(attempts=5, interval_seconds=0.1)

    assert calls["count"] == 3
    assert sleeps == [0.1, 0.1]


def test_ensure_gateway_raises_immediately_on_exited(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = {"count": 0}

    def _status_gateway() -> str:
        calls["count"] += 1
        raise GatewayExited(1)

    monkeypatch.setattr(gateway_service, "status_gateway", _status_gateway)
    monkeypatch.setattr(gateway_service.time, "sleep", lambda _: pytest.fail("must not retry after GatewayExited"))

    with pytest.raises(GatewayExited):
        gateway_service.ensure_gateway(attempts=5, interval_seconds=0.1)

    assert calls["count"] == 1


def test_ensure_gateway_raises_gateway_not_running_after_exhausting_attempts(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(gateway_service, "status_gateway", lambda: (_ for _ in ()).throw(GatewayNotStarted("still not started")))
    sleeps: list[float] = []
    monkeypatch.setattr(gateway_service.time, "sleep", sleeps.append)

    with pytest.raises(GatewayNotRunning):
        gateway_service.ensure_gateway(attempts=3, interval_seconds=0.1)

    assert sleeps == [0.1, 0.1, 0.1]


def test_get_current_cascade_proc_returns_local_pid(monkeypatch: pytest.MonkeyPatch) -> None:
    process = type("Process", (), {"pid": 42, "exitcode": None})()
    connection = gateway_service.LocalProcess(
        logs_directory=cast(Any, object()),
        process=process,
        gateway_url="tcp://localhost:1234",
    )
    monkeypatch.setattr(gateway_service.GatewayConnectionManager, "gateway_connection", connection)

    assert gateway_service.get_current_cascade_proc() == 42


def test_get_current_cascade_proc_returns_unmanaged_for_remote_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(gateway_service.GatewayConnectionManager, "gateway_connection", gateway_service.RemoteUrl())

    assert gateway_service.get_current_cascade_proc() == "unmanaged"


def test_get_current_cascade_proc_identifies_remote_tunnel(monkeypatch: pytest.MonkeyPatch) -> None:
    handle = gateway_service.tunnel.ConnectionHandle(
        host="gateway.example",
        control_path="/tmp/control",
        local_port=1234,
        remote_port=5678,
    )
    connection = gateway_service.RemoteTunnel(handle=handle)
    monkeypatch.setattr(gateway_service.GatewayConnectionManager, "gateway_connection", connection)
    monkeypatch.setattr(gateway_service.tunnel, "status", lambda _: True)

    process_id = gateway_service.get_current_cascade_proc()

    assert isinstance(process_id, str)
    assert len(process_id) == 8
    assert process_id == gateway_service.get_current_cascade_proc()
