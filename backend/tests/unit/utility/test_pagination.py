# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for PaginationSpec, focusing on extract_and_shift."""

import pytest

from forecastbox.utility.pagination import PaginationSpec, PaginationSpecRemainder

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _spec(page: int, page_size: int) -> PaginationSpec:
    return PaginationSpec(page=page, page_size=page_size)


def _items(n: int) -> list[str]:
    """Return a predictable list of n items."""
    return [f"item{i}" for i in range(n)]


# ---------------------------------------------------------------------------
# PaginationSpec.start / total_pages (existing contract, regression guard)
# ---------------------------------------------------------------------------


def test_start_page1() -> None:
    assert _spec(1, 10).start() == 0


def test_start_page2() -> None:
    assert _spec(2, 10).start() == 10


def test_start_page3() -> None:
    assert _spec(3, 5).start() == 10


def test_total_pages_exact() -> None:
    assert _spec(1, 5).total_pages(10) == 2


def test_total_pages_remainder() -> None:
    assert _spec(1, 5).total_pages(11) == 3


def test_total_pages_zero() -> None:
    assert _spec(1, 5).total_pages(0) == 0


# ---------------------------------------------------------------------------
# extract_and_shift — basic mechanics
# ---------------------------------------------------------------------------


def test_extract_shift_empty_first_source() -> None:
    """When the first source is empty the second source carries the full page window."""
    spec = _spec(page=1, page_size=5)
    items, remainder = spec.extract_and_shift([])
    assert items == []
    assert remainder == PaginationSpecRemainder(offset_shifted=0, current_page_remaining=5)
    assert remainder.current_page_remaining > 0


def test_extract_shift_first_source_fills_page() -> None:
    """When the first source exactly fills the page no second-source query is needed."""
    spec = _spec(page=1, page_size=3)
    all_items = _items(3)
    items, remainder = spec.extract_and_shift(all_items)
    assert items == all_items
    assert remainder == PaginationSpecRemainder(offset_shifted=0, current_page_remaining=0)
    assert remainder.current_page_remaining == 0


def test_extract_shift_first_source_exceeds_page() -> None:
    """First source has more items than page_size; second source is not needed."""
    spec = _spec(page=1, page_size=2)
    all_items = _items(5)
    items, remainder = spec.extract_and_shift(all_items)
    assert items == ["item0", "item1"]
    assert remainder == PaginationSpecRemainder(offset_shifted=0, current_page_remaining=0)
    assert remainder.current_page_remaining == 0


def test_extract_shift_first_source_partial() -> None:
    """First source contributes some items; second source fills the rest."""
    spec = _spec(page=1, page_size=5)
    all_items = _items(2)  # only 2 intrinsic, page_size 5 -> 3 more from second
    items, remainder = spec.extract_and_shift(all_items)
    assert items == ["item0", "item1"]
    assert remainder == PaginationSpecRemainder(offset_shifted=0, current_page_remaining=3)
    assert remainder.current_page_remaining > 0


# ---------------------------------------------------------------------------
# extract_and_shift — pagination examples from the specification
# ---------------------------------------------------------------------------


def test_spec_example_page1_intrinsic_fits_and_global_fills() -> None:
    """2 intrinsic, page=1, page_size=5 -> both intrinsic items + 3 global."""
    spec = _spec(page=1, page_size=5)
    intrinsic = _items(2)
    items, remainder = spec.extract_and_shift(intrinsic)
    assert items == intrinsic
    assert remainder == PaginationSpecRemainder(offset_shifted=0, current_page_remaining=3)


def test_spec_example_page2_intrinsic_skipped() -> None:
    """2 intrinsic, 10 global, page=2, page_size=5 -> no intrinsic, global offset=3, limit=5."""
    spec = _spec(page=2, page_size=5)
    intrinsic = _items(2)
    items, remainder = spec.extract_and_shift(intrinsic)
    # page start = 5; 5 >= 2 (n_first) -> no intrinsic items
    assert items == []
    # shifted offset = 5 - 2 = 3
    assert remainder == PaginationSpecRemainder(offset_shifted=3, current_page_remaining=5)


def test_spec_example_page3_intrinsic_skipped_larger_offset() -> None:
    """2 intrinsic, page=3, page_size=5 -> no intrinsic, global offset=8, limit=5."""
    spec = _spec(page=3, page_size=5)
    intrinsic = _items(2)
    items, remainder = spec.extract_and_shift(intrinsic)
    # page start = 10; 10 >= 2 -> no intrinsic items
    assert items == []
    # shifted offset = 10 - 2 = 8
    assert remainder == PaginationSpecRemainder(offset_shifted=8, current_page_remaining=5)


def test_spec_example_exactly_at_boundary() -> None:
    """Page starts exactly at the count of intrinsic items: none included, offset shifts to zero."""
    # 3 intrinsic, page_size=3, page=2 -> start=3, n_first=3 -> start >= n_first
    spec = _spec(page=2, page_size=3)
    intrinsic = _items(3)
    items, remainder = spec.extract_and_shift(intrinsic)
    assert items == []
    # shifted offset = 3 - 3 = 0
    assert remainder == PaginationSpecRemainder(offset_shifted=0, current_page_remaining=3)


def test_spec_intrinsic_straddles_page_boundary() -> None:
    """First source has items on this page but also more beyond — only page slice returned."""
    # 5 intrinsic, page_size=3, page=2 -> start=3, slice [3:6] -> ['item3', 'item4']
    spec = _spec(page=2, page_size=3)
    intrinsic = _items(5)
    items, remainder = spec.extract_and_shift(intrinsic)
    assert items == ["item3", "item4"]
    # 2 intrinsic items, page capacity 3 -> 1 remaining
    assert remainder == PaginationSpecRemainder(offset_shifted=0, current_page_remaining=1)


def test_spec_page_starts_inside_first_source_and_fills_it() -> None:
    """Page starts inside first source, consumes up to page_size items from it."""
    # 6 intrinsic, page_size=3, page=2 -> start=3, slice [3:6] -> 3 items -> page full
    spec = _spec(page=2, page_size=3)
    intrinsic = _items(6)
    items, remainder = spec.extract_and_shift(intrinsic)
    assert items == ["item3", "item4", "item5"]
    assert remainder == PaginationSpecRemainder(offset_shifted=0, current_page_remaining=0)
    assert remainder.current_page_remaining == 0


def test_spec_page1_all_from_first_source_when_large() -> None:
    """When first source has more items than page_size and page=1, all page items come from it."""
    spec = _spec(page=1, page_size=4)
    intrinsic = _items(10)
    items, remainder = spec.extract_and_shift(intrinsic)
    assert items == ["item0", "item1", "item2", "item3"]
    assert remainder.current_page_remaining == 0


def test_spec_no_intrinsic_only_global() -> None:
    """No intrinsic items: offset for global is the raw page start."""
    spec = _spec(page=3, page_size=5)  # start = 10
    items, remainder = spec.extract_and_shift([])
    assert items == []
    assert remainder == PaginationSpecRemainder(offset_shifted=10, current_page_remaining=5)


def test_spec_page_deep_beyond_both_sources() -> None:
    """Very large page number; second source offset is simply start - n_first."""
    spec = _spec(page=100, page_size=10)  # start = 990
    intrinsic = _items(4)
    items, remainder = spec.extract_and_shift(intrinsic)
    assert items == []
    assert remainder == PaginationSpecRemainder(offset_shifted=986, current_page_remaining=10)
