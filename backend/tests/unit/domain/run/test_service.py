import datetime as dt
from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock, MagicMock, call, patch

import pytest
from cascade.controller.report import JobId
from cascade.low.core import DatasetId, TaskId
from fiab_core.fable import BlockInstanceId

from forecastbox.domain.run import service
from forecastbox.domain.run.cascade import RunOutputCharacteristic, RunOutputs
from forecastbox.domain.run.db import RunRecord


def test_get_mime_of_output_returns_declared_mime() -> None:
    execution = cast(
        RunRecord,
        SimpleNamespace(
            run_id="run-1",
            outputs=RunOutputs(
                outputs={
                    TaskId("task-a"): RunOutputCharacteristic(
                        original_block=BlockInstanceId("block-a"),
                        mime_type="text/plain",
                    )
                }
            ).model_dump(),
        ),
    )

    result = service.get_mime_of_output(execution, DatasetId(task=TaskId("task-a"), output="0"))

    assert result.t == "text/plain"
    assert result.e is None


def test_get_mime_of_output_rejects_unknown_task() -> None:
    execution = cast(
        RunRecord,
        SimpleNamespace(
            run_id="run-1",
            outputs=RunOutputs(
                outputs={
                    TaskId("task-a"): RunOutputCharacteristic(
                        original_block=BlockInstanceId("block-a"),
                        mime_type="text/plain",
                    )
                }
            ).model_dump(),
        ),
    )

    result = service.get_mime_of_output(execution, DatasetId(task=TaskId("task-b"), output="0"))

    assert result.t is None
    assert result.e is not None
    assert "not found" in result.e


# ---------------------------------------------------------------------------
# poll_and_update — textual output value fetching
# ---------------------------------------------------------------------------


def _make_running_execution(outputs: RunOutputs | None) -> SimpleNamespace:
    return SimpleNamespace(
        run_id="run-1",
        attempt_count=1,
        status="running",
        created_at=dt.datetime(2026, 5, 12),
        updated_at=dt.datetime(2026, 5, 12),
        created_by="user-1",
        blueprint_id="bp-1",
        blueprint_version=1,
        error=None,
        progress=None,
        cascade_job_id="job-1",
        outputs=outputs.model_dump() if outputs is not None else None,
        compiler_runtime_context={},
    )


def _make_cascade_response(
    available_task_ids: list[TaskId],
    completed: bool = False,
    pct: str = "50.00",
) -> SimpleNamespace:
    return SimpleNamespace(
        progresses={JobId("job-1"): SimpleNamespace(completed=completed, pct=pct, failure=None)},
        datasets={JobId("job-1"): [DatasetId(task=tid, output="0") for tid in available_task_ids]},
        error=None,
        completed_task_ids=None,
        planned_task_ids=None,
    )


def _make_fetch_response(content: bytes) -> SimpleNamespace:
    resp = SimpleNamespace(error=None)
    resp._content = content
    return resp


@pytest.mark.asyncio
async def test_poll_and_update_fetches_textual_value_for_newly_available_task() -> None:
    outputs = RunOutputs(
        outputs={TaskId("task-text"): RunOutputCharacteristic(original_block=BlockInstanceId("sink"), mime_type="text/plain", value=None)}
    )
    execution = _make_running_execution(outputs)
    cascade_response = _make_cascade_response([TaskId("task-text")], pct="100.00", completed=True)
    text_bytes = b"hello world"

    call_count = 0

    def _fake_request_response(request: object, url: str) -> object:
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            # First call: JobProgressRequest
            return cascade_response
        # Second call: ResultRetrievalRequest
        return SimpleNamespace(error=None)

    update_mock = AsyncMock()

    with (
        patch("forecastbox.domain.run.service.client.request_response", side_effect=_fake_request_response),
        patch("forecastbox.domain.run.service.get_gateway_url", return_value="tcp://gw"),
        patch("forecastbox.domain.run.service.run_db.update_run_runtime", new=update_mock),
        patch("forecastbox.domain.run.service.api.decoded_result", return_value=text_bytes),
    ):
        detail = await service.poll_and_update(cast(RunRecord, execution))

    assert detail.status == "completed"
    # The outputs kwarg passed to update_run_runtime must include the fetched value
    update_kwargs = update_mock.call_args.kwargs
    stored = RunOutputs.model_validate(update_kwargs["outputs"])
    assert stored.outputs[TaskId("task-text")].value == "hello world"


@pytest.mark.asyncio
async def test_poll_and_update_skips_non_textual_output() -> None:
    outputs = RunOutputs(
        outputs={TaskId("task-bin"): RunOutputCharacteristic(original_block=BlockInstanceId("sink"), mime_type="image/png", value=None)}
    )
    execution = _make_running_execution(outputs)
    cascade_response = _make_cascade_response([TaskId("task-bin")], pct="50.00")

    call_count = 0

    def _fake_request_response(request: object, url: str) -> object:
        nonlocal call_count
        call_count += 1
        return cascade_response  # only the progress request should be made

    update_mock = AsyncMock()

    with (
        patch("forecastbox.domain.run.service.client.request_response", side_effect=_fake_request_response),
        patch("forecastbox.domain.run.service.get_gateway_url", return_value="tcp://gw"),
        patch("forecastbox.domain.run.service.run_db.update_run_runtime", new=update_mock),
    ):
        await service.poll_and_update(cast(RunRecord, execution))

    # Only the JobProgressRequest was made — no ResultRetrievalRequest
    assert call_count == 1
    # outputs kwarg not passed since nothing was fetched
    assert "outputs" not in update_mock.call_args.kwargs


@pytest.mark.asyncio
async def test_poll_and_update_does_not_refetch_already_cached_value() -> None:
    outputs = RunOutputs(
        outputs={
            TaskId("task-text"): RunOutputCharacteristic(
                original_block=BlockInstanceId("sink"), mime_type="text/plain", value="already cached"
            )
        }
    )
    execution = _make_running_execution(outputs)
    cascade_response = _make_cascade_response([TaskId("task-text")], pct="50.00")

    call_count = 0

    def _fake_request_response(request: object, url: str) -> object:
        nonlocal call_count
        call_count += 1
        return cascade_response

    update_mock = AsyncMock()

    with (
        patch("forecastbox.domain.run.service.client.request_response", side_effect=_fake_request_response),
        patch("forecastbox.domain.run.service.get_gateway_url", return_value="tcp://gw"),
        patch("forecastbox.domain.run.service.run_db.update_run_runtime", new=update_mock),
    ):
        await service.poll_and_update(cast(RunRecord, execution))

    # Only the JobProgressRequest, no ResultRetrievalRequest
    assert call_count == 1
    assert "outputs" not in update_mock.call_args.kwargs


@pytest.mark.asyncio
async def test_poll_and_update_handles_fetch_failure_gracefully() -> None:
    outputs = RunOutputs(
        outputs={TaskId("task-text"): RunOutputCharacteristic(original_block=BlockInstanceId("sink"), mime_type="text/plain", value=None)}
    )
    execution = _make_running_execution(outputs)
    cascade_response = _make_cascade_response([TaskId("task-text")], pct="50.00")

    call_count = 0

    def _fake_request_response(request: object, url: str) -> object:
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return cascade_response
        raise TimeoutError("cascade unreachable")

    update_mock = AsyncMock()

    with (
        patch("forecastbox.domain.run.service.client.request_response", side_effect=_fake_request_response),
        patch("forecastbox.domain.run.service.get_gateway_url", return_value="tcp://gw"),
        patch("forecastbox.domain.run.service.run_db.update_run_runtime", new=update_mock),
    ):
        detail = await service.poll_and_update(cast(RunRecord, execution))

    # Polling itself must succeed — the fetch failure is non-fatal
    assert detail.status == "running"
    # No outputs update since nothing was successfully fetched
    assert "outputs" not in update_mock.call_args.kwargs


@pytest.mark.asyncio
async def test_poll_and_update_failed_job_exposes_cached_values_as_available() -> None:
    outputs = RunOutputs(
        outputs={
            TaskId("task-text"): RunOutputCharacteristic(
                original_block=BlockInstanceId("sink"), mime_type="text/plain", value="cached output"
            ),
            TaskId("task-bin"): RunOutputCharacteristic(original_block=BlockInstanceId("sink2"), mime_type="image/png", value=None),
        }
    )
    execution = cast(
        RunRecord,
        SimpleNamespace(
            run_id="run-1",
            attempt_count=1,
            status="failed",
            created_at=dt.datetime(2026, 5, 12),
            updated_at=dt.datetime(2026, 5, 12),
            created_by="user-1",
            blueprint_id="bp-1",
            blueprint_version=1,
            error="evicted from gateway",
            progress=None,
            cascade_job_id="job-1",
            outputs=outputs.model_dump(),
            compiler_runtime_context={},
        ),
    )

    detail = await service.poll_and_update(execution)

    assert detail.status == "failed"
    # Only the task with a locally cached value is available
    assert detail.available_task_ids == [TaskId("task-text")]


@pytest.mark.asyncio
async def test_poll_and_update_completed_job_with_changed_gateway_exposes_cached_values_and_lost_tasks() -> None:
    outputs = RunOutputs(
        outputs={
            TaskId("task-text"): RunOutputCharacteristic(
                original_block=BlockInstanceId("sink"), mime_type="text/plain", value="cached output"
            ),
            TaskId("task-image"): RunOutputCharacteristic(original_block=BlockInstanceId("sink2"), mime_type="image/png", value=None),
        }
    )
    execution = _make_running_execution(outputs)
    execution.status = "completed"
    execution.cascade_proc = 41

    with patch("forecastbox.domain.run.service.get_current_cascade_proc", return_value=42):
        detail = await service.poll_and_update(cast(RunRecord, execution))

    assert detail.status == "completed"
    assert detail.available_task_ids == [TaskId("task-text")]
    assert detail.lost_task_ids == {TaskId("task-image"): "Gateway Proc changed"}


def _stopping_execution() -> SimpleNamespace:
    execution = _make_running_execution(None)
    execution.status = "stopping"
    return execution


@pytest.mark.asyncio
async def test_poll_and_update_stopping_still_running_reissues_stop() -> None:
    response = _make_cascade_response([], pct="50.00")
    update_mock = MagicMock(return_value=True)
    submit_mock = MagicMock()
    with (
        patch("forecastbox.domain.run.service.client.request_response", return_value=response),
        patch("forecastbox.domain.run.service.get_gateway_url", return_value="tcp://gw"),
        patch("forecastbox.domain.run.service.run_db.update_run_runtime", new=update_mock),
        patch("forecastbox.domain.run.service.submit_stop_cascade", new=submit_mock),
    ):
        detail = await service.poll_and_update(cast(RunRecord, _stopping_execution()))
    assert detail.status == "stopping"
    submit_mock.assert_called_once_with("run-1", 1, "job-1")
    update_mock.assert_not_called()


@pytest.mark.asyncio
async def test_poll_and_update_stopping_unknown_to_gateway_becomes_stopped() -> None:
    response = SimpleNamespace(progresses={}, datasets={}, error=None, completed_task_ids=None, planned_task_ids=None)
    update_mock = MagicMock(return_value=True)
    with (
        patch("forecastbox.domain.run.service.client.request_response", return_value=response),
        patch("forecastbox.domain.run.service.get_gateway_url", return_value="tcp://gw"),
        patch("forecastbox.domain.run.service.run_db.update_run_runtime", new=update_mock),
    ):
        detail = await service.poll_and_update(cast(RunRecord, _stopping_execution()))
    assert detail.status == "stopped"
    assert update_mock.call_args.kwargs["expected_status"] == "stopping"
    assert update_mock.call_args.kwargs["status"] == "stopped"


@pytest.mark.asyncio
async def test_poll_and_update_stopping_completed_overrides_stopping() -> None:
    response = _make_cascade_response([], completed=True, pct="100.00")
    update_mock = MagicMock(return_value=True)
    with (
        patch("forecastbox.domain.run.service.client.request_response", return_value=response),
        patch("forecastbox.domain.run.service.get_gateway_url", return_value="tcp://gw"),
        patch("forecastbox.domain.run.service.run_db.update_run_runtime", new=update_mock),
    ):
        detail = await service.poll_and_update(cast(RunRecord, _stopping_execution()))
    assert detail.status == "completed"
    assert update_mock.call_args.kwargs["expected_status"] == "stopping"


@pytest.mark.asyncio
async def test_poll_and_update_rereads_when_status_write_loses() -> None:
    """A lost compare-and-swap leads to re-reading the run and polling again on the fresh record."""
    response = _make_cascade_response([], pct="50.00")
    stale = _make_running_execution(None)
    fresh = _stopping_execution()
    update_mock = MagicMock(return_value=False)
    submit_mock = MagicMock()
    with (
        patch("forecastbox.domain.run.service.client.request_response", return_value=response),
        patch("forecastbox.domain.run.service.get_gateway_url", return_value="tcp://gw"),
        patch("forecastbox.domain.run.service.run_db.update_run_runtime", new=update_mock),
        patch("forecastbox.domain.run.service.run_db.get_run_unchecked", return_value=fresh),
        patch("forecastbox.domain.run.service.submit_stop_cascade", new=submit_mock),
    ):
        detail = await service.poll_and_update(cast(RunRecord, stale))
    assert detail.status == "stopping"
    assert update_mock.call_args.kwargs["expected_status"] == "running"
    submit_mock.assert_called_once()


@pytest.mark.asyncio
async def test_poll_and_update_stopped_makes_no_gateway_call() -> None:
    execution = _stopping_execution()
    execution.status = "stopped"
    with patch("forecastbox.domain.run.service.client.request_response") as rr:
        detail = await service.poll_and_update(cast(RunRecord, execution))
    assert detail.status == "stopped"
    rr.assert_not_called()
