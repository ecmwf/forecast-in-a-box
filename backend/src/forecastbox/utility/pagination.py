# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Shared pagination contract used across routes and service layers."""

from dataclasses import dataclass, field


@dataclass(frozen=True, eq=True, slots=True)
class PaginationSpec:
    """Query-parameter group for paginated list endpoints.

    Use with ``Depends()`` in FastAPI route signatures to accept ``page`` and
    ``page_size`` as individual query parameters while keeping handlers clean.
    """

    page: int = field(default=1)
    page_size: int = field(default=10)
