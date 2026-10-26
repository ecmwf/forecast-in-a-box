from datetime import datetime
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest
from cascade.low.func import Either

from forecastbox.domain.artifact.manager import ArtifactDownloadStatus
from forecastbox.domain.run import background as bg

_wait: Any = bg._await_runtime_artifacts
_execute: Any = bg.execute_background
AVAILABLE = ArtifactDownloadStatus("available")
DOWNLOADING = ArtifactDownloadStatus("downloading", progress=1)


class _Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def monotonic(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.now += seconds


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> _Clock:
    c = _Clock()
    monkeypatch.setattr(bg.time, "monotonic", c.monotonic)
    monkeypatch.setattr(bg.time, "sleep", c.sleep)
    return c


def _patch_status(monkeypatch: pytest.MonkeyPatch, fn: Any) -> None:
    monkeypatch.setattr(bg, "get_download_status", fn)


def test_wait_returns_ok_when_available(monkeypatch: pytest.MonkeyPatch, clock: _Clock) -> None:
    calls = {"n": 0}

    def status(_a: Any) -> ArtifactDownloadStatus:
        calls["n"] += 1
        return DOWNLOADING if calls["n"] < 4 else AVAILABLE

    _patch_status(monkeypatch, status)
    submit = MagicMock(return_value=Either.ok(0))
    monkeypatch.setattr(bg, "submit_artifact_download", submit)
    monkeypatch.setattr(bg, "_abort_if_not_proceeding", lambda *a, **k: False)
    assert _wait("r", 1, ["a"]) == bg._ArtifactWait()
    submit.assert_called_once_with("a", retry=False)


def test_wait_skips_available_artifacts(monkeypatch: pytest.MonkeyPatch, clock: _Clock) -> None:
    _patch_status(monkeypatch, lambda a: AVAILABLE)
    submit = MagicMock()
    monkeypatch.setattr(bg, "submit_artifact_download", submit)
    assert _wait("r", 1, ["a", "b"]) == bg._ArtifactWait()
    submit.assert_not_called()


def test_wait_fails_promptly_on_failed_download(monkeypatch: pytest.MonkeyPatch, clock: _Clock) -> None:
    seq = iter([DOWNLOADING, ArtifactDownloadStatus("failed", error="boom")])
    _patch_status(monkeypatch, lambda a: DOWNLOADING if a == "a" else next(seq))
    monkeypatch.setattr(bg, "submit_artifact_download", lambda *a, **k: Either.ok(0))
    monkeypatch.setattr(bg, "_abort_if_not_proceeding", lambda *a, **k: False)
    out = _wait("r", 1, ["b"])
    assert out.error is not None and "failed to download: boom" in out.error
    assert clock.now < 5


def test_wait_times_out(monkeypatch: pytest.MonkeyPatch, clock: _Clock) -> None:
    _patch_status(monkeypatch, lambda a: DOWNLOADING)
    monkeypatch.setattr(bg, "submit_artifact_download", lambda *a, **k: Either.ok(0))
    monkeypatch.setattr(bg, "_abort_if_not_proceeding", lambda *a, **k: False)
    out = _wait("r", 1, ["a"])
    assert out.error == "Timeout waiting for runtime artifacts to download"


def test_wait_aborts_on_stop(monkeypatch: pytest.MonkeyPatch, clock: _Clock) -> None:
    _patch_status(monkeypatch, lambda a: DOWNLOADING)
    monkeypatch.setattr(bg, "submit_artifact_download", lambda *a, **k: Either.ok(0))
    monkeypatch.setattr(bg, "_abort_if_not_proceeding", lambda *a, **k: True)
    assert _wait("r", 1, ["a"]) == bg._ArtifactWait(aborted=True)
    assert clock.now >= bg.RUN_STATUS_CHECK_INTERVAL_SECONDS


def test_wait_fails_when_earlier_download_failed(monkeypatch: pytest.MonkeyPatch, clock: _Clock) -> None:
    _patch_status(monkeypatch, lambda a: ArtifactDownloadStatus("failed", error="old"))
    submit = MagicMock(return_value=Either.error("old"))
    monkeypatch.setattr(bg, "submit_artifact_download", submit)
    out = _wait("r", 1, ["a"])
    assert out.error == "Failed to submit download for a: old"
    submit.assert_called_once_with("a", retry=False)


def _run_background(
    monkeypatch: pytest.MonkeyPatch, artifacts: list[str], wait: Any, cascade_response: Any = None, cascade_exc: Any = None
) -> dict[str, Any]:
    spec = SimpleNamespace(environment=SimpleNamespace(runtime_artifacts=artifacts))
    compilation = SimpleNamespace(execution_spec=spec, resolved_configuration_options={}, compilation_detail=None, run_outputs=MagicMock())
    builder = SimpleNamespace(local_glyphs={}, blocks=[])
    monkeypatch.setattr(bg, "resolve_intrinsic_glyph_values", lambda *a: {})
    monkeypatch.setattr(
        bg.global_db, "get_glyphs_for_resolution", lambda a: SimpleNamespace(public_overriddable={}, user_own={}, public_nonoverridable={})
    )
    monkeypatch.setattr(bg.BlueprintBuilder, "model_validate", lambda b: builder)
    monkeypatch.setattr(bg, "merge_glyph_values", lambda *a: {})
    monkeypatch.setattr(bg, "expand_glyph_values", lambda *a, **k: {})
    monkeypatch.setattr(bg, "compile_builder", lambda *a: compilation)
    db = MagicMock()
    db.update_run_runtime.return_value = True
    monkeypatch.setattr(bg, "db", db)
    abort = MagicMock(return_value=False)
    monkeypatch.setattr(bg, "_abort_if_not_proceeding", abort)
    monkeypatch.setattr(bg, "_await_runtime_artifacts", lambda *a: wait)
    cascade = MagicMock(return_value=cascade_response, side_effect=cascade_exc)
    monkeypatch.setattr(bg, "execute_cascade", cascade)
    ctx = MagicMock()
    ctx.model_copy.return_value.model_dump.return_value = {}
    ctx.glyphs = {}
    _execute("r", 1, datetime.now(), SimpleNamespace(builder={}), ctx, MagicMock())
    return {"db": db, "cascade": cascade}


def _failed_writes(db: MagicMock) -> list[Any]:
    return [c for c in db.update_run_runtime.call_args_list if c.kwargs.get("status") == "failed"]


def test_background_failed_wait_marks_failed(monkeypatch: pytest.MonkeyPatch) -> None:
    r = _run_background(monkeypatch, ["a"], bg._ArtifactWait(error="nope"))
    failed = _failed_writes(r["db"])
    assert len(failed) == 1 and failed[0].kwargs["error"] == "nope"
    assert failed[0].kwargs["expected_status"] == "preparing"
    r["cascade"].assert_not_called()


def test_background_stop_during_wait(monkeypatch: pytest.MonkeyPatch) -> None:
    r = _run_background(monkeypatch, ["a"], bg._ArtifactWait(aborted=True))
    assert _failed_writes(r["db"]) == []
    r["cascade"].assert_not_called()


def test_background_gateway_error_marks_failed(monkeypatch: pytest.MonkeyPatch) -> None:
    r = _run_background(monkeypatch, [], bg._ArtifactWait(), cascade_response=SimpleNamespace(job_id=None, error="gw"))
    failed = _failed_writes(r["db"])
    assert len(failed) == 1 and failed[0].kwargs["error"] == "gw"


def test_background_exception_marks_failed(monkeypatch: pytest.MonkeyPatch) -> None:
    r = _run_background(monkeypatch, [], bg._ArtifactWait(), cascade_exc=RuntimeError("x"))
    failed = _failed_writes(r["db"])
    assert len(failed) == 1 and "RuntimeError" in failed[0].kwargs["error"]
