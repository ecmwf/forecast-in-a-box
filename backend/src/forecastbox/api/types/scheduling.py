# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Related to scheduling endpoints"""

from typing import Any

import orjson
from pydantic import BaseModel, PositiveInt

from forecastbox.api.types.jobs import ExecutionSpecification


class ScheduleSpecificationV2(BaseModel):
    """Create request for a v2 cron schedule backed by a persisted JobDefinition."""

    job_definition_id: str
    """ID of an existing JobDefinition to execute on each tick."""
    job_definition_version: int | None = None
    """Specific version to pin; omit to use the latest version."""
    cron_expr: str
    """Cron expression for time scheduling."""
    dynamic_expr: dict[str, str] = {}
    """Evaluated at each invocation; keys are paths in the job spec, values are dynamic expressions."""
    max_acceptable_delay_hours: PositiveInt = 24
    """Maximum acceptable delay in hours. Runs missed beyond this window are skipped."""
    display_name: str | None = None
    display_description: str | None = None
    tags: list[str] | None = None


class ScheduleUpdateV2(BaseModel):
    """Update request for a v2 cron schedule. All fields are optional."""

    cron_expr: str | None = None
    enabled: bool | None = None
    dynamic_expr: dict[str, str] | None = None
    max_acceptable_delay_hours: PositiveInt | None = None


class ScheduleSpecification(BaseModel):
    exec_spec: ExecutionSpecification
    """The static part of the job, ie, what remains constant across executions"""
    dynamic_expr: dict[str, str]
    """Evaluated at each invocation, with keys pointing to paths in the job_spec,
    and values being dynamic expressions to be injected. Supported expressions:
    - `$schedule_datetime` -- like '20241012T00'
    """  # TODO support smth like argo expression language here
    cron_expr: str
    """Cron expression for time scheduling"""
    max_acceptable_delay_hours: PositiveInt
    """Maximum acceptable delay in hours for a scheduled run. If the scheduler is down for longer than this, the run will be skipped."""


class ScheduleUpdate(BaseModel):
    exec_spec: ExecutionSpecification | None = None
    dynamic_expr: dict[str, str] | None = None
    enabled: bool | None = None
    cron_expr: str | None = None
    max_acceptable_delay_hours: PositiveInt | None = None


def schedule2db(schedule_obj: ScheduleSpecification | ScheduleUpdate) -> dict[str, Any]:
    data = {}
    if schedule_obj.exec_spec is not None:
        data["exec_spec"] = schedule_obj.exec_spec.model_dump_json()
    if schedule_obj.dynamic_expr is not None:
        data["dynamic_expr"] = orjson.dumps(schedule_obj.dynamic_expr).decode("ascii")
    if schedule_obj.cron_expr is not None:
        data["cron_expr"] = schedule_obj.cron_expr
    if hasattr(schedule_obj, "enabled") and schedule_obj.enabled is not None:
        data["enabled"] = schedule_obj.enabled
    if hasattr(schedule_obj, "max_acceptable_delay_hours") and schedule_obj.max_acceptable_delay_hours is not None:
        data["max_acceptable_delay_hours"] = schedule_obj.max_acceptable_delay_hours
    return data
