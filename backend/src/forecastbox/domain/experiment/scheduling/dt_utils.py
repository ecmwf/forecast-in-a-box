# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Datetime-related utilities for scheduling."""

import re
from dataclasses import dataclass
from datetime import datetime, timedelta


def _validate_field(field: str, min_val: int, max_val: int, label: str) -> None:
    if field == "*":
        return

    if re.fullmatch(r"\*/\d+", field):
        step = int(field.split("/")[1])
        if step <= 0:
            raise ValueError(f"Step value must be positive: {step=}, {field=} of {label}.")
        else:
            return

    if re.fullmatch(r"\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*", field):
        parts = field.split(",")
        for part in parts:
            if "-" in part:
                start_str, end_str = part.split("-")
                start = int(start_str)
                end = int(end_str)
                if not (min_val <= start <= max_val and min_val <= end <= max_val and start <= end):
                    raise ValueError(f"Range {part} is out of bounds or invalid (expected {min_val}-{max_val}). {field=} of {label}.")
            else:
                val = int(part)
                if not (min_val <= val <= max_val):
                    raise ValueError(f"Value {val} is out of bounds (expected {min_val}-{max_val}). {field=} of {label}")
        return
    else:
        raise ValueError(f"Invalid cron field format: {field} of {label}")


def _get_field_values(field: str, min_val: int, max_val: int, label: str) -> list[int]:
    _validate_field(field, min_val, max_val, label)
    values = set()

    if field == "*":
        return list(range(min_val, max_val + 1))

    if re.fullmatch(r"\*/\d+", field):
        step = int(field.split("/")[1])
        return list(range(min_val, max_val + 1, step))

    parts = field.split(",")
    for part in parts:
        if "-" in part:
            start_str, end_str = part.split("-")
            start = int(start_str)
            end = int(end_str)
            values.update(range(start, end + 1))
        elif re.fullmatch(r"\d+", part):
            values.add(int(part))
        else:
            raise ValueError(f"failed to generate range for {field}")

    sorted_values = sorted(list(values))
    if all(min_val <= v <= max_val for v in sorted_values):
        return sorted_values
    else:
        raise ValueError(f"failed to generate range for {field}")


@dataclass(frozen=True, eq=True, slots=True)
class Crontab:
    minutes: list[int]
    hours: list[int]
    days_of_month: list[int]
    months: list[int]
    days_of_week: list[int]


def calculate_next_run(after: datetime, crontab: str) -> datetime:
    """Calculates the next run datetime according to the crontab expression."""
    crontab_values = parse_crontab(crontab)

    # TODO naive search, optimize!
    current_time = after + timedelta(minutes=1)
    for year in (current_time.year, current_time.year + 1):
        for month in crontab_values.months:
            if month < current_time.month and year == current_time.year:
                continue
            for day_of_month in crontab_values.days_of_month:
                try:
                    test_date = datetime(year, month, day_of_month)
                except ValueError:  # NOTE february issues etc
                    continue

                if test_date.weekday() not in crontab_values.days_of_week:
                    continue

                for hour in crontab_values.hours:
                    for minute in crontab_values.minutes:
                        candidate_run = datetime(year, month, day_of_month, hour, minute)
                        if candidate_run > after:
                            return candidate_run
    raise ValueError(f"cron next run failure for {after} and {crontab}")


def parse_crontab(crontab: str) -> Crontab:
    """Parses a crontab expression into field ranges. If invalid, raises ValueError"""
    fields = crontab.strip().split()
    if len(fields) != 5:
        raise ValueError(f"Crontab expression must have 5 fields (minute, hour, day of month, month, day of week). {crontab=}")

    minutes = _get_field_values(fields[0], 0, 59, "minute")
    hours = _get_field_values(fields[1], 0, 23, "hour")
    days_of_month = _get_field_values(fields[2], 1, 31, "day of month")
    months = _get_field_values(fields[3], 1, 12, "month")
    days_of_week = _get_field_values(fields[4], 0, 7, "day of week")

    return Crontab(minutes=minutes, hours=hours, days_of_month=days_of_month, months=months, days_of_week=days_of_week)
