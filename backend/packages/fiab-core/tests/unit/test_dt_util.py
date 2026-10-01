# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for fiab_core.types.dt_util."""

from datetime import timedelta

import pytest

from fiab_core.types.dt_util import format_timedelta, parse_timedelta, try_parse_timedelta


class TestFormatTimedelta:
    """Tests for format_timedelta"""

    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            (timedelta(days=1), "P1D"),
            (timedelta(hours=1), "PT1H"),
            (timedelta(hours=3), "PT3H"),
            (timedelta(minutes=30), "PT30M"),
            (timedelta(seconds=45), "PT45S"),
            (timedelta(days=2, hours=3), "P2DT3H"),
            (timedelta(0), "P0D"),
        ],
    )
    def test_format_round_trips_through_parse(self, value: timedelta, expected: str) -> None:
        assert format_timedelta(value) == expected
        assert parse_timedelta(expected) == value


class TestTryParseTimedelta:
    """Tests for try_parse_timedelta"""

    def test_valid_duration(self) -> None:
        assert try_parse_timedelta("P1D") == timedelta(days=1)

    def test_invalid_duration_returns_none(self) -> None:
        assert try_parse_timedelta("not_a_duration") is None
        assert try_parse_timedelta("3") is None
