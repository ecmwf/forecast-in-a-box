# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Job and graph utilities for scheduling."""

import datetime as dt
from dataclasses import dataclass
from typing import Any, cast

import orjson
from cascade.low.func import Either

import forecastbox.api.fable as api_fable
import forecastbox.db.jobs as db_jobs
from forecastbox.api.scheduling.dt_utils import calculate_next_run, current_scheduling_time
from forecastbox.api.types.fable import FableBuilder
from forecastbox.api.types.jobs import EnvironmentSpecification, ExecutionSpecification


def deep_union(dict1: dict[str, Any], dict2: dict[str, Any]) -> dict[str, Any]:
    """Recursively merges two dictionaries. In case of conflicts, values from dict2 are preferred. Copies the first."""
    merged = dict1.copy()
    for key, value in dict2.items():
        if key in merged and isinstance(merged[key], dict) and isinstance(value, dict):
            merged[key] = deep_union(merged[key], value)
        else:
            merged[key] = value
    return merged


def eval_dynamic_expression(data: dict[str, Any], execution_time: dt.datetime) -> dict[str, Any]:
    """Recursively evaluates '$execution_time' etc, returns a new copy of `data`."""
    processed_data = {}
    for key, value in data.items():
        if isinstance(value, dict):
            processed_data[key] = eval_dynamic_expression(value, execution_time)
        elif value == "$execution_time":
            processed_data[key] = execution_time.strftime("%Y%m%dT%H")
        else:
            processed_data[key] = value
    return processed_data


@dataclass(frozen=True, eq=True, slots=True)
class RunnableSchedule:
    exec_spec: ExecutionSpecification
    created_by: str | None
    next_run_at: dt.datetime | None
    scheduled_at: dt.datetime
    attempt_cnt: int
    max_acceptable_delay_hours: int
    schedule_id: str


@dataclass(frozen=True, eq=True, slots=True)
class RunnableExperiment:
    """Carries a compiled spec and all metadata needed to submit and track a scheduled run."""

    exec_spec: ExecutionSpecification
    created_by: str | None
    next_run_at: dt.datetime | None
    scheduled_at: dt.datetime
    experiment_id: str
    job_definition_id: str
    job_definition_version: int
    max_acceptable_delay_hours: int
    compiler_runtime_context: dict[str, Any]


async def experiment2runnable(experiment_id: str, exec_time: dt.datetime) -> Either[RunnableExperiment, str]:  # type: ignore[invalid-argument]
    """Convert an ExperimentDefinition into a RunnableExperiment for the given execution time.

    Loads the linked JobDefinition, applies any dynamic expressions from
    experiment_definition onto the blocks, compiles to an ExecutionSpecification,
    and computes the next cron tick.
    """
    exp = await db_jobs.get_experiment_definition(experiment_id)
    if exp is None:
        return Either.error(f"ExperimentDefinition {experiment_id!r} not found")

    exp_def = cast(dict, exp.experiment_definition) or {}
    cron_expr = str(exp_def.get("cron_expr", ""))
    dynamic_expr = cast(dict, exp_def.get("dynamic_expr", {}))
    max_acceptable_delay_hours = int(exp_def.get("max_acceptable_delay_hours", 24))

    job_def_id = str(exp.job_definition_id)  # ty:ignore[invalid-argument-type]
    job_def_version = cast(int, exp.job_definition_version)
    job_def = await db_jobs.get_job_definition(job_def_id, job_def_version)
    if job_def is None:
        return Either.error(f"JobDefinition {job_def_id!r} v{job_def_version} not found")

    try:
        blocks = cast(dict, job_def.blocks) or {}
        builder = FableBuilder(
            blocks=blocks,
            environment=EnvironmentSpecification.model_validate(job_def.environment_spec) if job_def.environment_spec else None,
        )
        compiled = api_fable.compile(builder)

        if dynamic_expr:
            dynamic_evaluated = eval_dynamic_expression(dynamic_expr, exec_time)
            merged = deep_union(compiled.model_dump(), dynamic_evaluated)
            exec_spec = ExecutionSpecification.model_validate(merged)
        else:
            exec_spec = compiled

        # TODO we should eagerly evaluate now and max_delay_hours, ie, dont generate
        # invalid execution times here
        next_run_at = calculate_next_run(exec_time, cron_expr) if cron_expr else None

        rv = RunnableExperiment(
            exec_spec=exec_spec,
            created_by=cast(str | None, exp.created_by),
            next_run_at=next_run_at,
            scheduled_at=exec_time,
            experiment_id=experiment_id,
            job_definition_id=job_def_id,
            job_definition_version=job_def_version,
            max_acceptable_delay_hours=max_acceptable_delay_hours,
            compiler_runtime_context={"trigger": "cron", "scheduled_at": exec_time.isoformat()},
        )
        return Either.ok(rv)
    except Exception as e:
        return Either.error(repr(e))


async def rerun2runnable(execution_id: str) -> Either[RunnableExperiment, str]:  # type: ignore[invalid-argument]
    """Build a RunnableExperiment for a re-run of an existing scheduled JobExecution.

    Retrieves the original execution's runtime context to preserve the scheduled_at
    date. The trigger is set to 'rerun' in compiler_runtime_context.
    """
    execution = await db_jobs.get_job_execution(execution_id)
    if execution is None:
        return Either.error(f"JobExecution {execution_id!r} not found")

    experiment_id = cast(str | None, execution.experiment_id)
    if experiment_id is None:
        return Either.error(f"JobExecution {execution_id!r} is not linked to an experiment")

    runtime_ctx = cast(dict, execution.compiler_runtime_context) or {}
    original_scheduled_at_str = runtime_ctx.get("scheduled_at")
    if original_scheduled_at_str:
        try:
            scheduled_at = dt.datetime.fromisoformat(original_scheduled_at_str)
        except ValueError:
            scheduled_at = current_scheduling_time()
    else:
        scheduled_at = current_scheduling_time()

    exp = await db_jobs.get_experiment_definition(experiment_id)
    if exp is None:
        return Either.error(f"ExperimentDefinition {experiment_id!r} not found")

    exp_def = cast(dict, exp.experiment_definition) or {}
    dynamic_expr = cast(dict, exp_def.get("dynamic_expr", {}))
    max_acceptable_delay_hours = int(exp_def.get("max_acceptable_delay_hours", 24))

    job_def_id = str(execution.job_definition_id)  # ty:ignore[invalid-argument-type]
    job_def_version = cast(int, execution.job_definition_version)
    job_def = await db_jobs.get_job_definition(job_def_id, job_def_version)
    if job_def is None:
        return Either.error(f"JobDefinition {job_def_id!r} v{job_def_version} not found")

    try:
        blocks = cast(dict, job_def.blocks) or {}
        builder = FableBuilder(
            blocks=blocks,
            environment=EnvironmentSpecification.model_validate(job_def.environment_spec) if job_def.environment_spec else None,
        )
        compiled = api_fable.compile(builder)

        if dynamic_expr:
            dynamic_evaluated = eval_dynamic_expression(dynamic_expr, scheduled_at)
            merged = deep_union(compiled.model_dump(), dynamic_evaluated)
            exec_spec = ExecutionSpecification.model_validate(merged)
        else:
            exec_spec = compiled

        rv = RunnableExperiment(
            exec_spec=exec_spec,
            created_by=cast(str | None, execution.created_by),
            next_run_at=None,
            scheduled_at=scheduled_at,
            experiment_id=experiment_id,
            job_definition_id=job_def_id,
            job_definition_version=job_def_version,
            max_acceptable_delay_hours=max_acceptable_delay_hours,
            compiler_runtime_context={
                "trigger": "rerun",
                "scheduled_at": scheduled_at.isoformat(),
                "original_execution_id": execution_id,
            },
        )
        return Either.ok(rv)
    except Exception as e:
        return Either.error(repr(e))
