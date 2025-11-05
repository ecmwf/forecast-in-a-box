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
from forecastbox.api.scheduling.dt_utils import calculate_next_run
from forecastbox.api.types import ExecutionSpecification
from forecastbox.db.schedule import get_schedules, max_attempt_cnt, run2date, run2schedule


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
    next_run_at: dt.datetime|None
    scheduled_at: dt.datetime
    attempt_cnt: int
    max_acceptable_delay_hours: int
    schedule_id: str

async def schedule2runnable(schedule_id: str, exec_time: dt.datetime) -> Either[RunnableSchedule, str]: # type: ignore[invalid-argument] # NOTE type checker issue
    """Converts a ScheduleDefinition into a RunnableSchedule by evaluating dynamic expressions and merging."""
    schedules = list(await get_schedules(schedule_id=schedule_id))
    if not schedules:
        return Either.error("not found")
    schedule_def = schedules[0]

    try:
        dynamic_expr = orjson.loads(schedule_def.dynamic_expr.encode('ascii'))
        exec_spec = orjson.loads(schedule_def.exec_spec.encode('ascii'))

        dynamic_evaluated = eval_dynamic_expression(dynamic_expr, exec_time)
        merged_spec = deep_union(exec_spec, dynamic_evaluated)
        next_run_at = calculate_next_run(exec_time, cast(str, schedule_def.cron_expr))
        rv = RunnableSchedule(
            exec_spec = ExecutionSpecification(**merged_spec),
            created_by = schedule_def.created_by,
            next_run_at = next_run_at,
            scheduled_at = exec_time,
            attempt_cnt = 0,
            max_acceptable_delay_hours = cast(int, schedule_def.max_acceptable_delay_hours),
            schedule_id = schedule_def.schedule_id,
        )
        return Either.ok(rv)
    except Exception as e:
        return Either.error(repr(e))

async def run2runnable(schedule_run_id: str) -> Either[RunnableSchedule, str]: # type: ignore[invalid-argument] # NOTE type checker issue
    """Converts a ScheduleRun into a RunnableSchedule, with all the original parameters. Intended for re-runs"""
    schedule_def = await run2schedule(schedule_run_id)
    if schedule_def is None:
        return Either.error(f"schedule corresponding to run {schedule_run_id} not found")

    attempt_cnt = await max_attempt_cnt(cast(str, schedule_def.schedule_id)) + 1

    scheduled_at = await run2date(schedule_run_id)
    if scheduled_at is None:
        return Either.error(f"schedule run {schedule_run_id} not found")

    try:
        dynamic_expr = orjson.loads(schedule_def.dynamic_expr.encode('ascii'))
        exec_spec = orjson.loads(schedule_def.exec_spec.encode('ascii'))

        dynamic_evaluated = eval_dynamic_expression(dynamic_expr, scheduled_at)
        merged_spec = deep_union(exec_spec, dynamic_evaluated)
        rv = RunnableSchedule(
            exec_spec = ExecutionSpecification(**merged_spec),
            created_by = cast(str|None, schedule_def.created_by),
            next_run_at = None,
            scheduled_at = scheduled_at,
            attempt_cnt = attempt_cnt,
            max_acceptable_delay_hours = cast(int, schedule_def.max_acceptable_delay_hours),
            schedule_id = cast(str, schedule_def.schedule_id),
        )
        return Either.ok(rv)
    except Exception as e:
        return Either.error(f"Failed to build a job because of {repr(e)}")
