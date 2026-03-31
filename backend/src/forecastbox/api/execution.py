# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Backwards-compatibility shim for ``forecastbox.api.execution``.

The canonical implementation has moved to ``forecastbox.domain.job_execution.service``.
This module re-exports everything so that existing import sites continue to work.
"""

from forecastbox.domain.job_execution.service import (
    ProductToOutputId,
    execute,
    execution_to_detail,
    get_job_definition_for_execution,
    get_job_execution_specification,
    poll_and_update_execution,
    restart_job_execution,
)

__all__ = [
    "ProductToOutputId",
    "execute",
    "execution_to_detail",
    "get_job_definition_for_execution",
    "get_job_execution_specification",
    "poll_and_update_execution",
    "restart_job_execution",
]
