import datetime as dt
from concurrent.futures import Future
from dataclasses import replace
from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock, MagicMock, call, patch

import pytest
from cascade.controller.report import JobId
from cascade.low.core import DatasetId, TaskId
from fiab_core.fable import BlockInstanceId

import forecastbox.domain.blueprint.db as blueprint_db
from forecastbox.domain.run import service
from forecastbox.domain.run.cascade import RunOutputCharacteristic, RunOutputs
from forecastbox.domain.run.db import CompilerRuntimeContext
from forecastbox.schemata.jobs import Run
from forecastbox.utility.auth import AuthContext
from forecastbox.utility.concurrency.manager import SubmissionRejected, TaskName
from forecastbox.utility.config import ConcurrentPools

_AUTH = AuthContext(user_id="user-1", is_admin=False)


def _make_run(outputs: RunOutputs | None, **kwargs: object) -> Run:
    data = {
        "run_id": "run-1",
        "attempt_count": 1,
        "status": "running",
        "created_at": dt.datetime(2026, 5, 12),
        "updated_at": dt.datetime(2026, 5, 12),
        "created_by": "user-1",
        "blueprint_id": "bp-1",
        "blueprint_version": 1,
        "experiment_id": None,
        "experiment_version": None,
        "compiler_runtime_context": {},
        "experiment_context": None,
        "error": None,
        "progress": None,
        "cascade_job_id": "job-1",
        "cascade_proc": None,
        "outputs": outputs.model_dump() if outputs is not None else None,
        "is_deleted": False,
    }
    data.update(kwargs)
    return cast(Run, SimpleNamespace(**data))


def _make_blueprint(builder: dict | None = None, **kwargs: object) -> blueprint_db.BlueprintRecord:
    payload = {
        "blueprint_id": "bp-1",
        "version": 1,
        "created_by": "user-1",
        "created_at": dt.datetime(2026, 5, 12),
        "source": "user_defined",
        "parent_id": None,
        "display_name": "Blueprint",
        "display_description": None,
        "tags": None,
        "builder": builder if builder is not None else {"blocks": [], "environment": None, "local_glyphs": {}},
        "fiabcore_major": 1,
        "is_deleted": False,
    }
    payload.update(kwargs)
    return blueprint_db.BlueprintRecord(**payload)


def _completed_future(value: object | None = None) -> Future[object]:
    future: Future[object] = Future()
    future.set_result(value)
    return future


def test_get_mime_of_output_returns_declared_mime() -> None:
    execution = _make_run(
        RunOutputs(
            outputs={
                TaskId("task-a"): RunOutputCharacteristic(
                    original_block=BlockInstanceId("block-a"),
                    mime_type="text/plain",
                )
            }
        )
    )

    result = service.get_mime_of_output(execution, DatasetId(task=TaskId("task-a"), output="0"))

    assert result.t == "text/plain"
    assert result.e is None


def test_get_mime_of_output_rejects_unknown_task() -> None:
    execution = _make_run(
        RunOutputs(
            outputs={
                TaskId("task-a"): RunOutputCharacteristic(
                    original_block=BlockInstanceId("block-a"),
                    mime_type="text/plain",
                )
            }
        )
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


def _run_jobs_task(task_name: str, task: object) -> object:
    del task_name
    return task()


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

    update_mock = MagicMock()

    with (
        patch("forecastbox.domain.run.service.client.request_response", side_effect=_fake_request_response),
        patch("forecastbox.domain.run.service.get_gateway_url", return_value="tcp://gw"),
        patch("forecastbox.domain.run.service._await_jobs_db", new=AsyncMock(side_effect=_run_jobs_task)),
        patch("forecastbox.domain.run.service.run_db.update_run_runtime", new=update_mock),
        patch("forecastbox.domain.run.service.api.decoded_result", return_value=text_bytes),
    ):
        detail = await service.poll_and_update(cast(Run, execution))

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

    update_mock = MagicMock()

    with (
        patch("forecastbox.domain.run.service.client.request_response", side_effect=_fake_request_response),
        patch("forecastbox.domain.run.service.get_gateway_url", return_value="tcp://gw"),
        patch("forecastbox.domain.run.service._await_jobs_db", new=AsyncMock(side_effect=_run_jobs_task)),
        patch("forecastbox.domain.run.service.run_db.update_run_runtime", new=update_mock),
    ):
        await service.poll_and_update(cast(Run, execution))

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

    update_mock = MagicMock()

    with (
        patch("forecastbox.domain.run.service.client.request_response", side_effect=_fake_request_response),
        patch("forecastbox.domain.run.service.get_gateway_url", return_value="tcp://gw"),
        patch("forecastbox.domain.run.service._await_jobs_db", new=AsyncMock(side_effect=_run_jobs_task)),
        patch("forecastbox.domain.run.service.run_db.update_run_runtime", new=update_mock),
    ):
        await service.poll_and_update(cast(Run, execution))

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

    update_mock = MagicMock()

    with (
        patch("forecastbox.domain.run.service.client.request_response", side_effect=_fake_request_response),
        patch("forecastbox.domain.run.service.get_gateway_url", return_value="tcp://gw"),
        patch("forecastbox.domain.run.service._await_jobs_db", new=AsyncMock(side_effect=_run_jobs_task)),
        patch("forecastbox.domain.run.service.run_db.update_run_runtime", new=update_mock),
    ):
        detail = await service.poll_and_update(cast(Run, execution))

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
        Run,
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
        detail = await service.poll_and_update(cast(Run, execution))

    assert detail.status == "completed"
    assert detail.available_task_ids == [TaskId("task-text")]
    assert detail.lost_task_ids == {TaskId("task-image"): "Gateway Proc changed"}


def test_submit_run_sync_creates_row_and_enqueues_background_work() -> None:
    blueprint = _make_blueprint()
    created_at = dt.datetime(2026, 5, 12)

    with (
        patch("forecastbox.domain.run.service._jobs_db_result", return_value=("run-2", 3, created_at)) as mock_jobs_db,
        patch("forecastbox.domain.run.service.execution_manager.submit_unmonitored", return_value=_completed_future()) as mock_submit,
    ):
        result = service.submit_run_sync(blueprint, _AUTH, compiler_runtime_context=CompilerRuntimeContext(glyphs={"a": "b"}))

    assert result.t is not None
    assert result.t.run_id == "run-2"
    assert result.t.attempt_count == 3
    assert mock_jobs_db.call_args.args[0] == "run.upsert"
    pool_name, task_name, task = mock_submit.call_args.args
    assert pool_name == ConcurrentPools.RunSubmission
    assert task_name == TaskName("run.execute-background")
    assert callable(task)


def test_submit_run_sync_rejects_blueprint_without_builder() -> None:
    blueprint = replace(_make_blueprint(), builder=None)

    with patch("forecastbox.domain.run.service.execution_manager.submit_unmonitored") as mock_submit:
        result = service.submit_run_sync(blueprint, _AUTH)

    assert result.t is None
    assert "no compilable blocks" in cast(str, result.e)
    mock_submit.assert_not_called()


@pytest.mark.asyncio
async def test_execute_submits_submit_run_sync_to_general_pool() -> None:
    blueprint = _make_blueprint()
    expected = object()
    seen: dict[str, object] = {}

    async def fake_awaitable_submit(pool_name: object, task_name: object, task: object) -> object:
        seen["pool_name"] = pool_name
        seen["task_name"] = task_name
        return task()

    with (
        patch("forecastbox.domain.run.service.execution_manager.awaitable_submit", new=AsyncMock(side_effect=fake_awaitable_submit)),
        patch("forecastbox.domain.run.service.submit_run_sync", return_value=expected) as mock_submit_run_sync,
    ):
        result = await service.execute(blueprint, _AUTH)

    assert result is expected
    assert seen["pool_name"] == ConcurrentPools.General
    assert seen["task_name"] == TaskName("run.submit")
    mock_submit_run_sync.assert_called_once()


@pytest.mark.asyncio
async def test_execute_propagates_submission_rejected() -> None:
    blueprint = _make_blueprint()

    with patch(
        "forecastbox.domain.run.service.execution_manager.awaitable_submit",
        new=AsyncMock(side_effect=SubmissionRejected("pool capacity exhausted: general")),
    ):
        with pytest.raises(SubmissionRejected):
            await service.execute(blueprint, _AUTH)
