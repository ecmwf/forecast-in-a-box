# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for experiment2runnable conversion helper."""

import datetime as dt
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from forecastbox.domain.blueprint.cascade import EnvironmentSpecification
from forecastbox.domain.experiment.scheduling.job_utils import RunnableExperiment, experiment2runnable
from forecastbox.domain.run.db import CompilerRuntimeContext


def _make_experiment(experiment_id: str = "exp-1", job_def_id: str = "jd-1", job_def_version: int = 1) -> MagicMock:
    exp = MagicMock()
    exp.experiment_definition_id = experiment_id
    exp.version = 1
    exp.created_by = "test@example.com"
    exp.blueprint_id = job_def_id
    exp.blueprint_version = job_def_version
    exp.experiment_definition = {
        "cron_expr": "0 0 * * *",
        "dynamic_expr": {"environment": {"environment_variables": {"date": "$execution_time"}}},
        "max_acceptable_delay_hours": 24,
        "enabled": True,
    }
    return exp


def _make_blueprint(job_def_id: str = "jd-1", version: int = 1) -> MagicMock:
    jd = MagicMock()
    jd.blueprint_id = job_def_id
    jd.version = version
    jd.blocks = {
        "source1": {
            "factory_id": {"plugin": {"store": "ecmwf", "local": "ecmwf-base"}, "factory": "ekdSource"},
            "configuration_values": {"source": "ecmwf-open-data", "date": "2026-01-01", "expver": "0001"},
            "input_ids": {},
        }
    }
    jd.environment_spec = None
    return jd


@pytest.mark.asyncio
@patch("forecastbox.domain.experiment.scheduling.job_utils.experiment_db.get_experiment_definition", new_callable=AsyncMock)
@patch("forecastbox.domain.experiment.scheduling.job_utils.blueprint_db.get_blueprint", new_callable=AsyncMock)
async def test_experiment2runnable_success(mock_get_jd: AsyncMock, mock_get_exp: AsyncMock) -> None:
    exec_time = dt.datetime(2026, 1, 1, 0, 0)
    exp = _make_experiment()
    jd = _make_blueprint()

    mock_get_exp.return_value = exp
    mock_get_jd.return_value = jd

    result = await experiment2runnable("exp-1", exec_time)

    assert result.e is None
    assert result.t is not None
    runnable = result.t
    assert isinstance(runnable, RunnableExperiment)
    assert runnable.experiment_id == "exp-1"
    assert runnable.blueprint_id == "jd-1"
    assert runnable.blueprint_version == 1
    assert runnable.created_by == "test@example.com"
    assert runnable.max_acceptable_delay_hours == 24
    assert runnable.scheduled_at == exec_time
    assert runnable.next_run_at is not None  # cron_expr computes a next run
    assert runnable.compiler_runtime_context == CompilerRuntimeContext(
        environment=EnvironmentSpecification(environment_variables={"date": "20260101T00"})
    )
    assert runnable.blueprint is jd


@pytest.mark.asyncio
@patch("forecastbox.domain.experiment.scheduling.job_utils.experiment_db.get_experiment_definition", new_callable=AsyncMock)
async def test_experiment2runnable_not_found(mock_get_exp: AsyncMock) -> None:
    mock_get_exp.return_value = None

    result = await experiment2runnable("does-not-exist", dt.datetime.now())

    assert result.t is None
    assert result.e is not None
    assert "not found" in result.e


@pytest.mark.asyncio
@patch("forecastbox.domain.experiment.scheduling.job_utils.experiment_db.get_experiment_definition", new_callable=AsyncMock)
@patch("forecastbox.domain.experiment.scheduling.job_utils.blueprint_db.get_blueprint", new_callable=AsyncMock)
async def test_experiment2runnable_job_def_missing(mock_get_jd: AsyncMock, mock_get_exp: AsyncMock) -> None:
    mock_get_exp.return_value = _make_experiment()
    mock_get_jd.return_value = None

    result = await experiment2runnable("exp-1", dt.datetime.now())

    assert result.t is None
    assert result.e is not None
    assert "not found" in result.e


@pytest.mark.asyncio
@patch("forecastbox.domain.experiment.scheduling.job_utils.experiment_db.get_experiment_definition", new_callable=AsyncMock)
@patch("forecastbox.domain.experiment.scheduling.job_utils.blueprint_db.get_blueprint", new_callable=AsyncMock)
async def test_experiment2runnable_dynamic_expr_applied(mock_get_jd: AsyncMock, mock_get_exp: AsyncMock) -> None:
    exec_time = dt.datetime(2026, 3, 15, 12, 0)
    exp = _make_experiment()
    exp.experiment_definition = {
        "cron_expr": "0 12 * * *",
        "dynamic_expr": {"environment": {"environment_variables": {"date": "$execution_time"}}},
        "max_acceptable_delay_hours": 48,
        "enabled": True,
    }
    jd = _make_blueprint()

    mock_get_exp.return_value = exp
    mock_get_jd.return_value = jd

    result = await experiment2runnable("exp-1", exec_time)

    assert result.t is not None
    runnable = result.t
    # Dynamic expression "$execution_time" should be evaluated and stored in compiler_runtime_context
    assert runnable.compiler_runtime_context == CompilerRuntimeContext(
        environment=EnvironmentSpecification(environment_variables={"date": "20260315T12"})
    )
    assert runnable.max_acceptable_delay_hours == 48
