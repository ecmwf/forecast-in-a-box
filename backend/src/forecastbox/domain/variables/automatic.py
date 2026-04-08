# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Automatic (system-provided) variables available for workflow configuration interpolation."""

import uuid
from datetime import datetime
from typing import Literal

from forecastbox.domain.variables.resolution import value_dt2str
from forecastbox.utility.time import current_time

# fmt: off
AvailableAutomaticVariables = Literal[
    "runId",        # Unique identifier for the run; stable across restarts.
    "submitDatetime", # Datetime when the run was first submitted; preserved on restart.
    "startDatetime",  # Datetime when the current attempt started; updated on every restart.
    "attemptCount",   # Attempt number for the current run; incremented on every restart.
]
# fmt: on

_current_time_example = value_dt2str(current_time())

# TODO: replace with frozendict once available so that we have immutability
_values_and_examples: dict[AvailableAutomaticVariables, str] = {
    "runId": str(uuid.uuid4()),
    "submitDatetime": _current_time_example,
    "startDatetime": _current_time_example,
    "attemptCount": "1",
}


def get_values_and_examples() -> dict[AvailableAutomaticVariables, str]:
    """Return all automatic variable names with example values generated at import time.

    Used for pre-submit validation and frontend display.
    """
    return _values_and_examples
