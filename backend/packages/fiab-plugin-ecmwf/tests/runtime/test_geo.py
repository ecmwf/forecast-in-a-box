# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import pytest

from fiab_plugin_ecmwf.runtime.geo import is_numeric_bbox, parse_geodomain


class TestParseGeodomain:
    @pytest.mark.parametrize("domain", [None, [], ["auto"], ["Auto"], ["global"], ["Global"], ["DataDefined"]])
    def test_auto_global_and_empty_resolve_to_none(self, domain: list[str] | None) -> None:
        assert parse_geodomain(domain) is None

    def test_names_pass_through(self) -> None:
        assert parse_geodomain(["Germany", "France"]) == ["Germany", "France"]

    def test_numeric_bbox_reorders_wire_wsen_to_earthkit_wesn(self) -> None:
        # wire [west, south, east, north] -> earthkit [west, east, south, north]
        assert parse_geodomain(["-10", "35", "30", "60"]) == [-10, 30, 35, 60]

    @pytest.mark.parametrize(
        "domain,expected",
        [
            (["1", "2", "3", "4"], True),
            (["-10.5", "30", "35", "60"], False),  # whole degrees only
            (["Germany"], False),
            (["1", "2", "3"], False),
            (["a", "2", "3", "4"], False),
            ([], False),
        ],
    )
    def test_is_numeric_bbox(self, domain: list[str], expected: bool) -> None:
        assert is_numeric_bbox(domain) is expected
