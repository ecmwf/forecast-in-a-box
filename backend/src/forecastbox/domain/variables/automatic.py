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

AvailableAutomaticVariables = Literal["runId", "submitDatetime"]

# TODO: replace with frozendict once available so that we have immutability
_values_and_examples: dict[AvailableAutomaticVariables, str] = {
    "runId": str(uuid.uuid4()),
    "submitDatetime": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
}


def get_values_and_examples() -> dict[AvailableAutomaticVariables, str]:
    """Return all automatic variable names with example values generated at import time.

    Used for pre-submit validation and frontend display.
    """
    return _values_and_examples
