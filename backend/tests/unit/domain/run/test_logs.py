import io
import zipfile
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch

import orjson
import pytest
from cascade.low.func import Either

from forecastbox.domain.run import logs
from forecastbox.domain.run.exceptions import OutputPathNotFound
from forecastbox.utility.concurrency.manager import execution_manager
from forecastbox.utility.config import ConcurrentPools


def test_fetch_gateway_job_state_timeout() -> None:
    with (
        patch.object(logs.client, "request_response", side_effect=TimeoutError()),
        patch.object(logs, "get_gateway_url", return_value="tcp://gw"),
    ):
        assert logs.fetch_gateway_job_state("j1") == {"progresses": {}, "datasets": {}, "error": "TimeoutError"}


def test_fetch_gateway_job_state_generic_error() -> None:
    with (
        patch.object(logs.client, "request_response", side_effect=ValueError("boom")),
        patch.object(logs, "get_gateway_url", return_value="tcp://gw"),
    ):
        state = logs.fetch_gateway_job_state("j1")
    assert state["error"] == repr(ValueError("boom"))


def test_build_logs_archive_contents(tmp_path: Path) -> None:
    for name in ("backend.logs.txt", "gateway.log", "job_j1.log", "job_j2.log", "other.txt"):
        (tmp_path / name).write_text(name)
    with patch.object(logs, "get_logs_directory", return_value=Either.ok(SimpleNamespace(name=str(tmp_path)))):
        data = logs.build_logs_archive("j1", b"{}", {"a": 1})
    names = set(zipfile.ZipFile(io.BytesIO(data)).namelist())
    assert names == {"db_entity.json", "gw_state.json", "backend.logs.txt", "gateway.log", "job_j1.log"}


def test_build_logs_archive_missing_directory() -> None:
    with patch.object(logs, "get_logs_directory", return_value=Either.error("nope")):
        data = logs.build_logs_archive("j1", b"{}", {})
    assert zipfile.ZipFile(io.BytesIO(data)).read("logs_directory.error.txt") == b"logs directory missing: nope"


@pytest.mark.asyncio
async def test_get_run_logs_archive_pools(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[Any, str]] = []

    async def fake(pool: Any, name: Any, task: Any) -> Any:
        calls.append((pool, str(name)))
        return task()

    monkeypatch.setattr(execution_manager, "awaitable_submit", fake)
    monkeypatch.setattr(logs, "fetch_gateway_job_state", MagicMock(return_value={"x": 1}))
    monkeypatch.setattr(logs, "build_logs_archive", MagicMock(return_value=b"zip"))
    run = SimpleNamespace(cascade_job_id="j1")
    with patch.object(logs, "asdict", return_value={"a": 1}):
        assert await logs.get_run_logs_archive(run) == b"zip"  # ty: ignore[invalid-argument-type]
    assert calls == [(ConcurrentPools.General, "run.logs.gateway-state"), (ConcurrentPools.Io, "run.logs.build-archive")]
    logs.build_logs_archive.assert_called_once_with("j1", orjson.dumps({"a": 1}), {"x": 1})  # ty: ignore[unresolved-attribute]


def test_build_output_archive_directory(tmp_path: Path) -> None:
    (tmp_path / "sub").mkdir()
    (tmp_path / "sub" / "a.txt").write_text("a")
    (tmp_path / "b.txt").write_text("b")
    data = logs.build_output_archive(tmp_path, "root")
    names = set(zipfile.ZipFile(io.BytesIO(data)).namelist())
    assert names == {"root/", "root/sub/", "root/sub/a.txt", "root/b.txt"}


@pytest.mark.asyncio
async def test_get_output_archive(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[Any, str]] = []

    async def fake(pool: Any, name: Any, task: Any) -> Any:
        calls.append((pool, str(name)))
        return task()

    monkeypatch.setattr(execution_manager, "awaitable_submit", fake)
    f = tmp_path / "x.txt"
    f.write_text("x")
    data, root = await logs.get_output_archive(f)
    assert root == "x.txt"
    assert zipfile.ZipFile(io.BytesIO(data)).namelist() == ["x.txt"]
    assert calls == [(ConcurrentPools.Io, "run.output.build-archive")]
    with pytest.raises(OutputPathNotFound):
        await logs.get_output_archive(tmp_path / "missing")
