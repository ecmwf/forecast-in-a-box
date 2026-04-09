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
from typing import cast

from cascade.low.func import Either

import forecastbox.domain.blueprint.db as blueprint_db
import forecastbox.domain.experiment.db as experiment_db
from forecastbox.domain.experiment.scheduling.dt_utils import calculate_next_run
from forecastbox.domain.glyphs.resolution import value_dt2str
from forecastbox.domain.run.db import CompilerRuntimeContext
from forecastbox.schemata.jobs import Blueprint


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
    compiler_runtime_context: CompilerRuntimeContext


async def experiment2runnable(experiment_id: str, exec_time: dt.datetime) -> Either[RunnableExperiment, str]:  # type: ignore[invalid-argument]
    """Convert an ExperimentDefinition into a RunnableExperiment for the given execution time.

    Loads the linked Blueprint and builds a CompilerRuntimeContext for the run.
    """
    exp = await experiment_db.get_experiment_definition(experiment_id)
    if exp is None:
        return Either.error(f"ExperimentDefinition {experiment_id!r} not found")

    exp_def = cast(dict, exp.experiment_definition) or {}
    cron_expr = str(exp_def.get("cron_expr", ""))
    max_acceptable_delay_hours = int(exp_def.get("max_acceptable_delay_hours", 24))

    job_def_id = str(exp.blueprint_id)  # ty:ignore[invalid-argument-type]
    job_def_version = cast(int, exp.blueprint_version)
    job_def = await blueprint_db.get_blueprint(job_def_id, job_def_version)
    if job_def is None:
        return Either.error(f"Blueprint {job_def_id!r} v{job_def_version} not found")

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
        compiler_runtime_context=CompilerRuntimeContext(glyphs={"submitDatetime": value_dt2str(exec_time)}),
    )
    return Either.ok(rv)
