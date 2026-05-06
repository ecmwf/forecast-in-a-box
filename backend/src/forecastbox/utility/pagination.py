# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Shared pagination contract used across routes and service layers."""

from dataclasses import dataclass
from typing import TypeVar

from pydantic import ConfigDict, Field

from forecastbox.utility.pydantic import FiabBaseModel

T = TypeVar("T")


@dataclass(frozen=True)
class PaginationSpecRemainder:
    """Shifted offset and remaining page capacity for the second data source.

    Returned by ``PaginationSpec.extract_and_shift`` after items from the first
    source have been accounted for within the current page window.
    ``offset_shifted`` is the zero-based row offset to pass to the second source
    query, and ``current_page_remaining`` is how many more items can still fit on
    the current page.
    """

    offset_shifted: int
    current_page_remaining: int


class PaginationSpec(FiabBaseModel):
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

    def extract_and_shift(self, first_source: list[T]) -> tuple[list[T], PaginationSpecRemainder]:
        """Split a two-source paginated result across this page window.

        Assumes the *first_source* list contains **all** items from the first
        data source that match the current filters (intrinsic glyphs are always
        cheap to compute in full).  The method picks whichever of those items
        fall within the current page and returns a ``PaginationSpecRemainder``
        describing how to query the second source to fill the rest of the page.

        ``first_source`` must be ordered stably so that slicing is deterministic
        across pages.  Returns a tuple of the slice of *first_source* that belongs
        on this page (may be empty) and the remainder spec for the second source.
        When the slice is non-empty, ``offset_shifted`` is always 0 because the
        page window starts inside the first source; when the slice is empty,
        ``offset_shifted`` is the global page start decremented by the total count
        of the first source.
        """
        n_first = len(first_source)
        start = self.start()

        if start >= n_first:
            # The page window starts beyond the end of the first source.
            # Shift the offset down by the number of first-source items.
            return [], PaginationSpecRemainder(offset_shifted=start - n_first, current_page_remaining=self.page_size)
        else:
            # The page window overlaps with the first source.
            items = first_source[start : start + self.page_size]
            return items, PaginationSpecRemainder(offset_shifted=0, current_page_remaining=self.page_size - len(items))
