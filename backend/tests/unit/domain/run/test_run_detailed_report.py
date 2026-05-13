from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock, patch

import pytest
from cascade.controller.report import JobId
from cascade.low.core import TaskId
from fiab_core.fable import BlockInstanceId

from forecastbox.domain.blueprint.types import BlueprintId
from forecastbox.domain.run import service as run_service
from forecastbox.domain.run.service import RunDetail
from forecastbox.domain.run.types import RunId
from forecastbox.routes.run import RunLookup, get_run, list_runs
from forecastbox.schemata.jobs import Run
from forecastbox.utility.auth import AuthContext
from forecastbox.utility.pagination import PaginationSpec


def _run_detail(
    *,
    completed_task_ids: list[BlockInstanceId] | None = None,
    planned_task_ids: list[BlockInstanceId] | None = None,
) -> RunDetail:
    return RunDetail(
        run_id=RunId("run-1"),
        attempt_count=1,
        status="running",
        created_at="2026-05-12T00:00:00",
        updated_at="2026-05-12T00:00:00",
        blueprint_id=BlueprintId("bp-1"),
        blueprint_version=1,
        progress="12.50",
        cascade_job_id="job-1",
        outputs=None,
        completed_task_ids=completed_task_ids,
        planned_task_ids=planned_task_ids,
    )


@pytest.mark.asyncio
async def test_poll_and_update_requests_detailed_report_and_translates_to_block_ids() -> None:
    execution = SimpleNamespace(
        run_id="run-1",
        attempt_count=1,
        status="running",
        created_at="2026-05-12T00:00:00",
        updated_at="2026-05-12T00:00:00",
        blueprint_id="bp-1",
        blueprint_version=1,
        error=None,
        progress=None,
        cascade_job_id="job-1",
        outputs=None,
    )
    response = SimpleNamespace(
        progresses={JobId("job-1"): SimpleNamespace(completed=False, pct="12.50", failure=None)},
        datasets={},
        error=None,
        completed_task_ids={JobId("job-1"): [TaskId("task-a")]},
        planned_task_ids={JobId("job-1"): [TaskId("task-b")]},
    )
    task_to_block = {
        TaskId("task-a"): BlockInstanceId("block-a"),
        TaskId("task-b"): BlockInstanceId("block-b"),
    }

    with (
        patch("forecastbox.domain.run.service.client.request_response", return_value=response) as mock_request,
        patch("forecastbox.domain.run.service.get_memcache", return_value=task_to_block) as mock_get_memcache,
        patch("forecastbox.domain.run.service.run_db.update_run_runtime", new=AsyncMock()),
    ):
        detail = await run_service.poll_and_update(cast(Run, execution), detailed_report=True)

    request = mock_request.call_args.args[0]
    assert request.detailed_report is True
    assert mock_get_memcache.call_args.args[0] == RunId("run-1")
    assert detail.completed_task_ids == [BlockInstanceId("block-a")]
    assert detail.planned_task_ids == [BlockInstanceId("block-b")]


@pytest.mark.asyncio
async def test_poll_and_update_disables_detailed_report_when_cache_misses() -> None:
    execution = SimpleNamespace(
        run_id="run-1",
        attempt_count=1,
        status="running",
        created_at="2026-05-12T00:00:00",
        updated_at="2026-05-12T00:00:00",
        blueprint_id="bp-1",
        blueprint_version=1,
        error=None,
        progress=None,
        cascade_job_id="job-1",
        outputs=None,
    )
    response = SimpleNamespace(
        progresses={JobId("job-1"): SimpleNamespace(completed=False, pct="12.50", failure=None)},
        datasets={},
        error=None,
        completed_task_ids=None,
        planned_task_ids=None,
    )

    with (
        patch("forecastbox.domain.run.service.client.request_response", return_value=response) as mock_request,
        patch("forecastbox.domain.run.service.get_memcache", side_effect=KeyError("missing")) as mock_get_memcache,
        patch("forecastbox.domain.run.service.run_db.update_run_runtime", new=AsyncMock()),
    ):
        detail = await run_service.poll_and_update(cast(Run, execution), detailed_report=True)

    request = mock_request.call_args.args[0]
    assert request.detailed_report is False
    assert mock_get_memcache.call_args.args[0] == RunId("run-1")
    assert detail.error == "unable to provide completed/planned tasks"
    assert detail.completed_task_ids is None
    assert detail.planned_task_ids is None


@pytest.mark.asyncio
async def test_poll_and_update_returns_empty_detailed_fields_for_completed_runs() -> None:
    execution = SimpleNamespace(
        run_id="run-1",
        attempt_count=1,
        status="completed",
        created_at="2026-05-12T00:00:00",
        updated_at="2026-05-12T00:00:00",
        blueprint_id="bp-1",
        blueprint_version=1,
        error=None,
        progress="100.00",
        cascade_job_id="job-1",
        outputs={"outputs": {"task-a": {"mime_type": "application/json", "original_block": "block-a"}}},
    )

    detail = await run_service.poll_and_update(cast(Run, execution), detailed_report=True)

    assert detail.completed_task_ids == []
    assert detail.planned_task_ids == []


@pytest.mark.asyncio
async def test_get_run_asks_for_detailed_report_while_list_runs_does_not() -> None:
    execution = SimpleNamespace(
        run_id="run-1",
        attempt_count=1,
        status="running",
        created_at="2026-05-12T00:00:00",
        updated_at="2026-05-12T00:00:00",
        blueprint_id="bp-1",
        blueprint_version=1,
        error=None,
        progress=None,
        cascade_job_id="job-1",
        outputs=None,
    )
    detailed = _run_detail(
        completed_task_ids=[BlockInstanceId("block-a")],
        planned_task_ids=[BlockInstanceId("block-b")],
    )

    with (
        patch("forecastbox.routes.run.db.get_run", new=AsyncMock(return_value=execution)),
        patch("forecastbox.routes.run.service.poll_and_update", new=AsyncMock(side_effect=[detailed, detailed])) as mock_poll,
        patch("forecastbox.routes.run.db.count_runs", new=AsyncMock(return_value=1)),
        patch("forecastbox.routes.run.db.list_runs", new=AsyncMock(return_value=[execution])),
    ):
        response = await get_run(RunLookup(run_id=RunId("run-1")), AuthContext(user_id="user", is_admin=True))
        assert response.completed_task_ids == [BlockInstanceId("block-a")]
        assert response.planned_task_ids == [BlockInstanceId("block-b")]
        assert mock_poll.await_args_list[0].kwargs == {"detailed_report": True}

        await list_runs(PaginationSpec(page=1, page_size=10), AuthContext(user_id="user", is_admin=True))
        assert mock_poll.await_args_list[1].kwargs == {}
