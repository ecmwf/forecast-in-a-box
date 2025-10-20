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
from typing import Any

import orjson
from cascade.low.func import Either
from forecastbox.api.scheduling.dt_utils import next_run
from forecastbox.api.types import ExecutionSpecification
from forecastbox.db.schedule import get_schedules


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

@dataclass
class RunnableSchedule:
    exec_spec: ExecutionSpecification
    created_by: str|None
    next_run_at: dt.datetime

async def schedule2spec(schedule_id: str, exec_time: dt.datetime) -> Either[RunnableSchedule, str]: # type: ignore[invalid-argument] # NOTE type checker issue
    """Converts a ScheduleDefinition into an ExecutionSpecification by evaluating dynamic expressions and merging."""
    schedules = list(await get_schedules(schedule_id=schedule_id))
    if not schedules:
        return Either.error("not found")
    schedule_def = schedules[0]

    try:
        dynamic_expr = orjson.loads(schedule_def.dynamic_expr.encode('ascii'))
        exec_spec = orjson.loads(schedule_def.exec_spec.encode('ascii'))

        dynamic_evaluated = eval_dynamic_expression(dynamic_expr, exec_time)
        merged_spec = deep_union(exec_spec, dynamic_evaluated)
        next_run_at = next_run(exec_time, schedule_def.cron_expr)
        rv = RunnableSchedule(
            exec_spec = ExecutionSpecification(**merged_spec),
            created_by = schedule_def.created_by,
            next_run_at = next_run_at,
        )
        return Either.ok(rv)
    except Exception as e:
        return Either.error(repr(e))
