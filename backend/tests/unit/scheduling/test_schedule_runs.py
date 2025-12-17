import datetime as dt
import uuid
from typing import cast
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from forecastbox.api.routers.schedule import GetScheduleRunsResponse, get_schedule_runs
from forecastbox.db.schedule import JobRecord, ScheduleRun
from forecastbox.schemas.user import UserRead


@pytest.fixture
def mock_schedule_run_row():
    return (
        ScheduleRun(
            schedule_run_id=str(uuid.uuid4()),
            schedule_id="test_schedule_id",
            job_id="test_job_id",
            attempt_cnt=1,
            scheduled_at=dt.datetime(2025, 10, 23, 10, 0, 0),
            trigger="cron",
        ),
        JobRecord(
            job_id="test_job_id",
            status="completed",
            created_at=dt.datetime(2025, 10, 23, 10, 0, 5),
            updated_at=dt.datetime(2025, 10, 23, 10, 0, 5),
            graph_specification="{}",
            created_by="test@example.com",
            outputs="{}",
            error=None,
            progress="100%",
        ),
    )


@pytest.fixture
def mock_user():
    return UserRead(id=str(uuid.uuid4()), email="test@example.com", is_active=True, is_superuser=False, is_verified=True)  # type: ignore[invalid-argument-type] # uuid-str


@pytest.mark.asyncio
async def test_get_schedule_runs_success(mock_schedule_run_row, mock_user):
    with (
        patch("forecastbox.api.routers.schedule.select_runs", AsyncMock(return_value=[mock_schedule_run_row])) as mock_select_runs,
        patch("forecastbox.api.routers.schedule.select_runs_count", AsyncMock(return_value=1)) as mock_select_runs_count,
    ):
        response = await get_schedule_runs(schedule_id="test_schedule_id", user=mock_user)

        mock_select_runs.assert_called_once_with(
            schedule_id="test_schedule_id", since_dt=None, before_dt=None, offset=0, limit=10, status=None
        )
        mock_select_runs_count.assert_called_once_with(schedule_id="test_schedule_id", since_dt=None, before_dt=None, status=None)

        assert isinstance(response, GetScheduleRunsResponse)
        assert len(response.runs) == 1
        run = list(response.runs.values())[0]
        assert run.schedule_id == "test_schedule_id"
        assert run.status == "completed"
        assert response.total == 1
        assert response.page == 1
        assert response.page_size == 10
        assert response.total_pages == 1
        assert response.error is None


@pytest.mark.asyncio
async def test_get_schedule_runs_pagination(mock_schedule_run_row, mock_user):
    with (
        patch("forecastbox.api.routers.schedule.select_runs", AsyncMock(return_value=[mock_schedule_run_row])) as mock_select_runs,
        patch("forecastbox.api.routers.schedule.select_runs_count", AsyncMock(return_value=1)) as mock_select_runs_count,
    ):
        response = await get_schedule_runs(schedule_id="test_schedule_id", user=mock_user, page=1, page_size=1)

        mock_select_runs.assert_called_once_with(
            schedule_id="test_schedule_id", since_dt=None, before_dt=None, offset=0, limit=1, status=None
        )
        mock_select_runs_count.assert_called_once_with(schedule_id="test_schedule_id", since_dt=None, before_dt=None, status=None)
        assert isinstance(response, GetScheduleRunsResponse)
        assert len(response.runs) == 1
        assert response.total == 1
        assert response.page == 1
        assert response.page_size == 1
        assert response.total_pages == 1


@pytest.mark.asyncio
async def test_get_schedule_runs_no_runs(mock_user):
    with (
        patch("forecastbox.api.routers.schedule.select_runs", AsyncMock(return_value=[])) as mock_select_runs,
        patch("forecastbox.api.routers.schedule.select_runs_count", AsyncMock(return_value=0)) as mock_select_runs_count,
    ):
        response = await get_schedule_runs(schedule_id="test_schedule_id", user=mock_user)

        mock_select_runs.assert_called_once_with(
            schedule_id="test_schedule_id", since_dt=None, before_dt=None, offset=0, limit=10, status=None
        )
        mock_select_runs_count.assert_called_once_with(schedule_id="test_schedule_id", since_dt=None, before_dt=None, status=None)
        assert isinstance(response, GetScheduleRunsResponse)
        assert len(response.runs) == 0
        assert response.total == 0
        assert response.page == 1
        assert response.page_size == 10
        assert response.total_pages == 0
        assert response.error is None


@pytest.mark.asyncio
async def test_get_schedule_runs_invalid_page_params(mock_user):
    with pytest.raises(HTTPException) as exc_info:
        await get_schedule_runs(schedule_id="test_schedule_id", user=mock_user, page=0)
    assert "Page and page_size must be greater than 0." in exc_info.value.detail

    with pytest.raises(HTTPException) as exc_info:
        await get_schedule_runs(schedule_id="test_schedule_id", user=mock_user, page_size=0)
    assert "Page and page_size must be greater than 0." in exc_info.value.detail


@pytest.mark.asyncio
async def test_get_schedule_runs_page_out_of_range(mock_schedule_run_row, mock_user):
    with (
        patch("forecastbox.api.routers.schedule.select_runs", AsyncMock(return_value=[])),
        patch("forecastbox.api.routers.schedule.select_runs_count", AsyncMock(return_value=1)),
    ):
        with pytest.raises(HTTPException) as exc_info:
            await get_schedule_runs(schedule_id="test_schedule_id", user=mock_user, page=2, page_size=1)
        assert "Page number out of range." in exc_info.value.detail
