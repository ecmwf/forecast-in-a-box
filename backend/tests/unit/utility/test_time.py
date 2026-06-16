import datetime

import pytest
from fiab_core.types import DatetimeType

from forecastbox.utility.time import current_time, value_dt2str


def test_fiabcore_compat() -> None:
    now = current_time("glyph_resolution").replace(microsecond=0)
    now_ser = value_dt2str(now)
    parsed_now = DatetimeType().validate_convert(now_ser)
    assert now == parsed_now
