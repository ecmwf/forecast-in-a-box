# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Related to scheduling endpoints"""

from datetime import datetime
from typing import Any

import orjson
from pydantic import BaseModel, PositiveInt


class ScheduleSpecification(BaseModel):
    """Create request for a cron schedule backed by a persisted JobDefinition."""

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
    first_run_override: datetime | None = None
    """If provided and not older than max_acceptable_delay_hours, used as the first scheduled run time instead of the next cron tick."""
    display_name: str | None = None
    display_description: str | None = None
    tags: list[str] | None = None


class ScheduleUpdate(BaseModel):
    """Update request for a cron schedule. All fields are optional."""

    cron_expr: str | None = None
    enabled: bool | None = None
    dynamic_expr: dict[str, str] | None = None
    max_acceptable_delay_hours: PositiveInt | None = None
    first_run_override: datetime | None = None
    """If provided and not older than max_acceptable_delay_hours, used as the next scheduled run time instead of the next cron tick."""
