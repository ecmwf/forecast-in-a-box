import re
from datetime import datetime

import pytest

from forecastbox.api.scheduling.dt_utils import calculate_next_run, parse_crontab


def test_parse_crontab_valid():
    parse_crontab("0 0 * * *")
    parse_crontab("*/15 * * * *")
    parse_crontab("1,5,10-12 * * * *")
    parse_crontab("0 0 1 * *")
    parse_crontab("0 0 * 1 *")
    parse_crontab("0 0 * * 0")


def test_parse_crontab_invalid():
    def _test(crontab, expected):
        with pytest.raises(ValueError, match=re.escape(expected) + ".*"):
            parse_crontab(crontab)

    # Incorrect number of fields
    _test("invalid cron", "Crontab expression must have 5 fields (minute, hour, day of month, month, day of week).")
    _test("0 0 * * * *", "Crontab expression must have 5 fields (minute, hour, day of month, month, day of week).")
    _test("0 0 * * ", "Crontab expression must have 5 fields (minute, hour, day of month, month, day of week).")

    # Invalid minute field
    _test("60 0 * * *", "Value 60 is out of bounds (expected 0-59). field='60' of minute")
    _test("a 0 * * *", "Invalid cron field format: a of minute")
    _test("0-60 0 * * *", "Range 0-60 is out of bounds or invalid (expected 0-59). field='0-60' of minute.")
    # Invalid hour field
    _test("0 24 * * *", "Value 24 is out of bounds (expected 0-23). field='24' of hour")
    # Invalid day of month field
    _test("0 0 0 * *", "Value 0 is out of bounds (expected 1-31). field='0' of day of month")
    _test("0 0 32 * *", "Value 32 is out of bounds (expected 1-31). field='32' of day of month")
    # Invalid month field
    _test("0 0 * 0 *", "Value 0 is out of bounds (expected 1-12). field='0' of month")
    _test("0 0 * 13 *", "Value 13 is out of bounds (expected 1-12). field='13' of month")
    # Invalid day of week field
    _test("0 0 * * 8", "Value 8 is out of bounds (expected 0-7). field='8' of day of week")
    _test("0 0 * * A", "Invalid cron field format: A of day of week")
    # Invalid step value
    _test("*/0 * * * *", "Step value must be positive: step=0, field='*/0' of minute.")
    _test("*/a * * * *", "Invalid cron field format: */a of minute")


def test_next_run_every_minute():
    after = datetime(2025, 10, 20, 10, 0, 0)
    cron_tab = "* * * * *"
    expected = datetime(2025, 10, 20, 10, 1, 0)
    assert calculate_next_run(after, cron_tab) == expected


def test_next_run_specific_time():
    after = datetime(2025, 10, 20, 10, 0, 0)
    cron_tab = "30 11 * * *"
    expected = datetime(2025, 10, 20, 11, 30, 0)
    assert calculate_next_run(after, cron_tab) == expected


def test_next_run_next_day():
    after = datetime(2025, 10, 20, 23, 30, 0)
    cron_tab = "0 0 * * *"
    expected = datetime(2025, 10, 21, 0, 0, 0)
    assert calculate_next_run(after, cron_tab) == expected


def test_next_run_invalid_crontab():
    after = datetime(2025, 10, 20, 10, 0, 0)
    cron_tab = "invalid cron"
    with pytest.raises(ValueError):
        calculate_next_run(after, cron_tab)


def test_next_run_no_future_run():
    after = datetime(2025, 10, 20, 10, 0, 0)
    cron_tab = "0 0 1 1 1"
    with pytest.raises(ValueError):
        calculate_next_run(after, cron_tab)


def test_next_run_step_value():
    after = datetime(2025, 10, 20, 10, 0, 0)
    cron_tab = "*/15 * * * *"
    expected = datetime(2025, 10, 20, 10, 15, 0)
    assert calculate_next_run(after, cron_tab) == expected


def test_next_run_range_value():
    after = datetime(2025, 10, 20, 10, 0, 0)
    cron_tab = "0 10-12 * * *"
    expected = datetime(2025, 10, 20, 11, 0, 0)
    assert calculate_next_run(after, cron_tab) == expected


def test_next_run_list_value():
    after = datetime(2025, 10, 20, 10, 0, 0)
    cron_tab = "0 10,12 * * *"
    expected = datetime(2025, 10, 20, 12, 0, 0)
    assert calculate_next_run(after, cron_tab) == expected


def test_next_run_endofyear():
    after = datetime(2025, 12, 31, 23, 00)
    cron_tab = "0 0 * * *"
    expected = datetime(2026, 1, 1, 0, 0, 0)
    assert calculate_next_run(after, cron_tab) == expected
