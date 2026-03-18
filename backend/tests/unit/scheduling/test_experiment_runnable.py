# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for experiment2runnable and rerun2runnable conversion helpers."""

import datetime as dt
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from forecastbox.api.scheduling.job_utils import RunnableExperiment, experiment2runnable, rerun2runnable
from forecastbox.api.types.jobs import ExecutionSpecification


def _make_experiment(experiment_id: str = "exp-1", job_def_id: str = "jd-1", job_def_version: int = 1) -> MagicMock:
    exp = MagicMock()
    exp.id = experiment_id
    exp.version = 1
    exp.created_by = "test@example.com"
    exp.job_definition_id = job_def_id
    exp.job_definition_version = job_def_version
    exp.experiment_definition = {
        "cron_expr": "0 0 * * *",
        "dynamic_expr": {},
        "max_acceptable_delay_hours": 24,
        "enabled": True,
    }
    return exp


def _make_job_definition(job_def_id: str = "jd-1", version: int = 1) -> MagicMock:
    jd = MagicMock()
    jd.id = job_def_id
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


def _make_exec_spec() -> ExecutionSpecification:
    from cascade.low.core import JobInstance

    from forecastbox.api.types.jobs import EnvironmentSpecification, RawCascadeJob

    job_instance = JobInstance(tasks={}, edges=[])
    return ExecutionSpecification(
        job=RawCascadeJob(job_type="raw_cascade_job", job_instance=job_instance),
        environment=EnvironmentSpecification(),
    )


@pytest.mark.asyncio
@patch("forecastbox.api.scheduling.job_utils.db_jobs.get_experiment_definition", new_callable=AsyncMock)
@patch("forecastbox.api.scheduling.job_utils.db_jobs.get_job_definition", new_callable=AsyncMock)
@patch("forecastbox.api.scheduling.job_utils.api_fable.compile")
async def test_experiment2runnable_success(mock_compile, mock_get_jd, mock_get_exp):
    exec_time = dt.datetime(2026, 1, 1, 0, 0)
    exp = _make_experiment()
    jd = _make_job_definition()
    exec_spec = _make_exec_spec()

    mock_get_exp.return_value = exp
    mock_get_jd.return_value = jd
    mock_compile.return_value = exec_spec

    result = await experiment2runnable("exp-1", exec_time)

    assert result.e is None
    assert result.t is not None
    runnable = result.t
    assert isinstance(runnable, RunnableExperiment)
    assert runnable.experiment_id == "exp-1"
    assert runnable.job_definition_id == "jd-1"
    assert runnable.job_definition_version == 1
    assert runnable.created_by == "test@example.com"
    assert runnable.max_acceptable_delay_hours == 24
    assert runnable.scheduled_at == exec_time
    assert runnable.next_run_at is not None  # cron_expr computes a next run
    assert runnable.compiler_runtime_context["trigger"] == "cron"
    assert runnable.compiler_runtime_context["scheduled_at"] == exec_time.isoformat()
    assert runnable.exec_spec is exec_spec


@pytest.mark.asyncio
@patch("forecastbox.api.scheduling.job_utils.db_jobs.get_experiment_definition", new_callable=AsyncMock)
async def test_experiment2runnable_not_found(mock_get_exp):
    mock_get_exp.return_value = None

    result = await experiment2runnable("does-not-exist", dt.datetime.now())

    assert result.t is None
    assert result.e is not None
    assert "not found" in result.e


@pytest.mark.asyncio
@patch("forecastbox.api.scheduling.job_utils.db_jobs.get_experiment_definition", new_callable=AsyncMock)
@patch("forecastbox.api.scheduling.job_utils.db_jobs.get_job_definition", new_callable=AsyncMock)
async def test_experiment2runnable_job_def_missing(mock_get_jd, mock_get_exp):
    mock_get_exp.return_value = _make_experiment()
    mock_get_jd.return_value = None

    result = await experiment2runnable("exp-1", dt.datetime.now())

    assert result.t is None
    assert result.e is not None
    assert "not found" in result.e


@pytest.mark.asyncio
@patch("forecastbox.api.scheduling.job_utils.db_jobs.get_experiment_definition", new_callable=AsyncMock)
@patch("forecastbox.api.scheduling.job_utils.db_jobs.get_job_definition", new_callable=AsyncMock)
@patch("forecastbox.api.scheduling.job_utils.api_fable.compile")
async def test_experiment2runnable_dynamic_expr_applied(mock_compile, mock_get_jd, mock_get_exp):
    exec_time = dt.datetime(2026, 3, 15, 12, 0)
    exp = _make_experiment()
    # dynamic_expr overrides the environment section of the compiled ExecutionSpecification
    exp.experiment_definition = {
        "cron_expr": "0 12 * * *",
        "dynamic_expr": {"environment": {"environment_variables": {"date": "$execution_time"}}},
        "max_acceptable_delay_hours": 48,
        "enabled": True,
    }
    jd = _make_job_definition()
    compiled_spec = _make_exec_spec()

    mock_get_exp.return_value = exp
    mock_get_jd.return_value = jd
    mock_compile.return_value = compiled_spec

    result = await experiment2runnable("exp-1", exec_time)

    assert result.t is not None
    runnable = result.t
    # Dynamic expression "$execution_time" should be evaluated and merged into the spec
    assert runnable.exec_spec.environment.environment_variables.get("date") == "20260315T12"
    assert runnable.max_acceptable_delay_hours == 48


@pytest.mark.asyncio
@patch("forecastbox.api.scheduling.job_utils.db_jobs.get_job_execution", new_callable=AsyncMock)
async def test_rerun2runnable_execution_not_found(mock_get_exec):
    mock_get_exec.return_value = None

    result = await rerun2runnable("exec-99")

    assert result.t is None
    assert result.e is not None
    assert "not found" in result.e


@pytest.mark.asyncio
@patch("forecastbox.api.scheduling.job_utils.db_jobs.get_job_execution", new_callable=AsyncMock)
async def test_rerun2runnable_no_experiment_link(mock_get_exec):
    execution = MagicMock()
    execution.experiment_id = None
    mock_get_exec.return_value = execution

    result = await rerun2runnable("exec-1")

    assert result.t is None
    assert result.e is not None
    assert "not linked to an experiment" in result.e


@pytest.mark.asyncio
@patch("forecastbox.api.scheduling.job_utils.db_jobs.get_job_execution", new_callable=AsyncMock)
@patch("forecastbox.api.scheduling.job_utils.db_jobs.get_experiment_definition", new_callable=AsyncMock)
@patch("forecastbox.api.scheduling.job_utils.db_jobs.get_job_definition", new_callable=AsyncMock)
@patch("forecastbox.api.scheduling.job_utils.api_fable.compile")
async def test_rerun2runnable_success(mock_compile, mock_get_jd, mock_get_exp, mock_get_exec):
    original_time = dt.datetime(2026, 1, 1, 6, 0)
    execution = MagicMock()
    execution.experiment_id = "exp-1"
    execution.job_definition_id = "jd-1"
    execution.job_definition_version = 1
    execution.created_by = "user@example.com"
    execution.compiler_runtime_context = {"trigger": "cron", "scheduled_at": original_time.isoformat()}
    mock_get_exec.return_value = execution

    exp = _make_experiment()
    mock_get_exp.return_value = exp

    jd = _make_job_definition()
    mock_get_jd.return_value = jd

    exec_spec = _make_exec_spec()
    mock_compile.return_value = exec_spec

    result = await rerun2runnable("exec-1")

    assert result.e is None
    assert result.t is not None
    runnable = result.t
    assert runnable.compiler_runtime_context["trigger"] == "rerun"
    assert runnable.compiler_runtime_context["original_execution_id"] == "exec-1"
    assert runnable.scheduled_at == original_time
    assert runnable.next_run_at is None
    assert runnable.experiment_id == "exp-1"
