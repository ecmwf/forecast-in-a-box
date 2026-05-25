# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Intrinsic (system-provided) glyphs available for workflow configuration interpolation."""

import uuid
from datetime import datetime
from typing import Literal

from forecastbox.utility.time import current_time, value_dt2str

# fmt: off
AvailableIntrinsicGlyphs = Literal[
    "runId",        # Unique identifier for the run; stable across restarts.
    "submitDatetime", # Datetime when the run was first submitted; preserved on restart.
    "startDatetime",  # Datetime when the current attempt started; updated on every restart.
    "attemptCount",   # Attempt number for the current run; incremented on every restart.
]
# fmt: on


def get_values_and_examples() -> dict[AvailableIntrinsicGlyphs, str]:
    """Return all intrinsic glyph names paired with example values.

    Generated per call: the datetime examples must track the current time so
    pre-submit validation and the frontend "resolves to" preview reflect "now".
    Computing them once at import froze every preview at the backend's
    start-up time.
    """
    now = value_dt2str(current_time())
    return {
        "runId": str(uuid.uuid4()),
        "submitDatetime": now,
        "startDatetime": now,
        "attemptCount": "1",
    }
