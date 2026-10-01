# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Utilities for parsing ISO 8601 duration strings into datetime.timedelta, shared between
TimeDeltaType and traits that need to opportunistically interpret an argument as a duration."""

import re
from datetime import timedelta

from fiab_core.types.exceptions import WrongType

# NOTE deliberately no support for calendar-dependent components (years, months) since
# they do not correspond to a fixed duration and would make the conversion ambiguous.
# The leading 'P' designator is checked for and stripped separately, so it is not part
# of this pattern. All groups are optional; at least one must actually be present for a
# match to be considered meaningful (checked by the caller, since an all-absent match
# still satisfies this regex, e.g. for a bare 'T').
_TIMEDELTA_PATTERN = re.compile(
    r"^"
    r"(?:(?P<weeks>\d+)W)?"
    r"(?:(?P<days>\d+)D)?"
    r"(?:T"
    r"(?:(?P<hours>\d+)H)?"
    r"(?:(?P<minutes>\d+)M)?"
    r"(?:(?P<seconds>\d+(?:\.\d+)?)S)?"
    r")?"
    r"$"
)


def parse_timedelta(value: str) -> timedelta:
    """Parse an ISO 8601 duration string into a datetime.timedelta.

    Supports the fixed-length components weeks (W), days (D), hours (H), minutes (M) and
    seconds (S, may be fractional), the latter three following a literal 'T' designator,
    e.g. 'P3DT12H30M', 'PT30M', 'P1W'. Calendar-dependent components (years, months) are
    not supported, since a fixed number of days cannot represent them unambiguously.

    The leading 'P' designator is optional on input for convenience, so e.g. 'T12H' or
    '3DT1M' are accepted too. Raises WrongType if the string cannot be parsed.
    """
    raw = value.strip()
    body = raw[1:] if raw.startswith("P") else raw
    if not body:
        raise WrongType(f"Cannot parse {value!r} as timedelta (expected ISO 8601 duration format)")

    match = _TIMEDELTA_PATTERN.match(body)
    if match is None or not any(match.groupdict().values()):
        raise WrongType(f"Cannot parse {value!r} as timedelta (expected ISO 8601 duration format)")

    groups = match.groupdict()
    return timedelta(
        weeks=int(groups["weeks"] or 0),
        days=int(groups["days"] or 0),
        hours=int(groups["hours"] or 0),
        minutes=int(groups["minutes"] or 0),
        seconds=float(groups["seconds"] or 0),
    )


def try_parse_timedelta(value: str) -> timedelta | None:
    """Parse an ISO 8601 duration string into a datetime.timedelta, returning None instead
    of raising when the string cannot be parsed. Meant for opportunistic parsing of an
    argument whose surrounding type is not known."""
    try:
        return parse_timedelta(value)
    except WrongType:
        return None
