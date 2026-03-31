# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Shared pagination contract used across routes and service layers."""

from pydantic import BaseModel, ConfigDict, Field


class PaginationSpec(BaseModel):
    """Query-parameter group for paginated list endpoints.

    Use with ``Depends()`` in FastAPI route signatures to accept ``page`` and
    ``page_size`` as individual query parameters while keeping handlers clean.
    FastAPI converts validation errors (e.g. page < 1) into 422 responses.
    """

    model_config = ConfigDict(frozen=True)

    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=10, ge=1)

    def start(self) -> int:
        """Return the zero-based row offset for this page."""
        return (self.page - 1) * self.page_size

    def total_pages(self, total_rows: int) -> int:
        """Return the total number of pages given the full result count."""
        return (total_rows + self.page_size - 1) // self.page_size if total_rows > 0 else 0
