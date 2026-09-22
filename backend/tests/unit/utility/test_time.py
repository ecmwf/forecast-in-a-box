import datetime

import pytest
from fiab_core.types import DatetimeType

from forecastbox.utility.time import current_time, get_sleepable_difference, value_dt2str


def test_get_sleepable_difference_preserves_subseconds() -> None:
    current = datetime.datetime(2025, 10, 20, 10, 0, 1, 250_000, tzinfo=datetime.UTC)
    target = datetime.datetime(2025, 10, 20, 10, 1, 0, 500_000, tzinfo=datetime.UTC)

    assert get_sleepable_difference(current, target) == 59.25


def test_fiabcore_compat() -> None:
    now = current_time("glyph_resolution").replace(microsecond=0)
    now_ser = value_dt2str(now)
    parsed_now = DatetimeType().validate_convert(now_ser)
    assert now == parsed_now
