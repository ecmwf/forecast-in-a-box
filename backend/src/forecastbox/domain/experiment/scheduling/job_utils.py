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

from cascade.low.func import Either

import forecastbox.domain.blueprint.db as blueprint_db
import forecastbox.domain.experiment.db as experiment_db
from forecastbox.domain.experiment.scheduling.dt_utils import calculate_next_run
from forecastbox.ecpyutil import deep_union
from forecastbox.schemas.jobs import Blueprint


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
class RunnableExperiment:
    """Carries the Blueprint and all metadata needed to submit and track a scheduled run."""

    blueprint: Blueprint
    created_by: str | None
    next_run_at: dt.datetime | None
    scheduled_at: dt.datetime
    experiment_id: str
    blueprint_id: str
    blueprint_version: int
    max_acceptable_delay_hours: int
    compiler_runtime_context: dict[str, Any]


async def experiment2runnable(experiment_id: str, exec_time: dt.datetime) -> Either[RunnableExperiment, str]:  # type: ignore[invalid-argument]
    """Convert an ExperimentDefinition into a RunnableExperiment for the given execution time.

    Loads the linked Blueprint and evaluates any dynamic expressions from
    experiment_definition against exec_time. The evaluated result is stored as
    compiler_runtime_context so execute() can apply it via deep_union after compilation.
    """
    exp = await experiment_db.get_experiment_definition(experiment_id)
    if exp is None:
        return Either.error(f"ExperimentDefinition {experiment_id!r} not found")

    exp_def = cast(dict, exp.experiment_definition) or {}
    cron_expr = str(exp_def.get("cron_expr", ""))
    dynamic_expr = cast(dict, exp_def.get("dynamic_expr", {}))
    max_acceptable_delay_hours = int(exp_def.get("max_acceptable_delay_hours", 24))

    job_def_id = str(exp.blueprint_id)  # ty:ignore[invalid-argument-type]
    job_def_version = cast(int, exp.blueprint_version)
    job_def = await blueprint_db.get_blueprint(job_def_id, job_def_version)
    if job_def is None:
        return Either.error(f"Blueprint {job_def_id!r} v{job_def_version} not found")

    dynamic_evaluated = eval_dynamic_expression(dynamic_expr, exec_time) if dynamic_expr else {}

    next_run_at = calculate_next_run(exec_time, cron_expr) if cron_expr else None

    rv = RunnableExperiment(
        blueprint=job_def,
        created_by=cast(str | None, exp.created_by),
        next_run_at=next_run_at,
        scheduled_at=exec_time,
        experiment_id=experiment_id,
        blueprint_id=job_def_id,
        blueprint_version=job_def_version,
        max_acceptable_delay_hours=max_acceptable_delay_hours,
        compiler_runtime_context=dynamic_evaluated,
    )
    return Either.ok(rv)
