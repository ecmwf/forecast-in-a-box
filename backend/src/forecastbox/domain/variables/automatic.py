# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Automatic (system-provided) variables available for workflow configuration interpolation."""

from typing import Literal

AvailableAutomaticVariables = Literal["runId", "submitDatetime"]


def get_values_and_examples() -> dict[AvailableAutomaticVariables, str]:
    """Return all automatic variable names with hardcoded example values.

    Used for pre-submit validation and frontend display. The examples are stable
    representative values, not generated at runtime.
    """
    return {
        "runId": "run-abc123-def456",
        "submitDatetime": "2025-10-11 12:00:00",
    }
