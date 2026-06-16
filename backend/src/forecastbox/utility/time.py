# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Time and Date related utilities"""

from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from sqlalchemy import Column, DateTime
from sqlalchemy.types import TypeDecorator

TimeQueryReason = Literal[
    "liveness",  # for deciding whether a given long running thread is still alive
    "scheduling",  # for calculating next_run, and deciding whether a next_run should fire
    "glyph_resolution",  # eg when a cascade job starts executing
    "dbref",  # for db inserts and created_at/updated_at
    "pylock_save",  # for creating the pylock.toml.timestamp file utilized by the installer
]


def current_time(reason: TimeQueryReason) -> datetime:
    """Return the current time, for the given reason. Sets the proper time zone
    to ensure consistency and client compatibility"""
    # NOTE we dont use the reason atm, but in case we would ever need to its
    # more convenient than grepping around
    return datetime.now(UTC)


def from_timestamp(ts: float) -> datetime:
    """The `ts` is to come from like file stat ctime"""
    local_install_time = datetime.fromtimestamp(ts)
    utc_install_time = local_install_time.astimezone(UTC)
    return utc_install_time


class UTCDateTime(TypeDecorator[datetime]):
    """DateTime column that always returns UTC-aware datetimes.

    SQLite has no native timezone support, so SQLAlchemy's DateTime returns naive
    datetimes on read regardless of timezone=True. This decorator attaches UTC tzinfo
    to any naive datetime value read from the database, ensuring all in-process
    datetimes are consistently tz-aware.
    """

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_result_value(self, value: datetime | None, dialect: Any) -> datetime | None:
        if value is not None and value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value


canonical_output_format = "%Y-%m-%dT%H:%M:%S%:z"


def value_dt2str(value: datetime | Column) -> str:
    """Convert a datetime to the canonical string format used for all client-exposed serialization."""
    return value.strftime(canonical_output_format)
