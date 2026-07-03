# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Runtime geodomain parsing for the Map Plot sink.

A ``geodomain`` config value is a list of strings that is either:

- region/country names (e.g. ``["Europe"]`` or ``["Germany", "France", "Italy"]`` to union), or
- an integer bounding box of four items ``["west", "south", "east", "north"]`` in whole
  degrees (a drawn box; same order and units as core's ``bbox`` type, same layout as a
  GeoJSON/OpenLayers extent).

``parse_geodomain`` disambiguates the two (4 numeric items -> bbox, else names) and is the
single point where the wire order is converted to earthkit-plots' bbox order ``[W, E, S, N]``.
"""

from typing import Any

# Single-token domain values meaning "no restriction" -- the data's own extent (case-insensitive).
_NO_RESTRICTION = frozenset({"auto", "global", "datadefined"})


def _is_no_restriction(domain: list[Any]) -> bool:
    return len(domain) == 1 and str(domain[0]).lower() in _NO_RESTRICTION


def is_numeric_bbox(domain: Any) -> bool:
    """True if *domain* is exactly four items that all parse as ints (a ``[W, S, E, N]`` box)."""
    if not domain or len(domain) != 4:
        return False
    try:
        [int(x) for x in domain]
    except (TypeError, ValueError):
        return False
    return True


def parse_geodomain(domain: list[str] | None) -> None | list[int] | list[str]:
    """Normalise a ``geodomain`` value.

    Returns ``None`` for auto/global/empty, the list of names, or -- for a drawn bbox -- four
    ints reordered from the wire's ``[W, S, E, N]`` to earthkit-plots' bbox order
    ``[W, E, S, N]``. The int list lets ``add_map`` treat it as a bounding box (rather than
    mis-reading numeric strings as country names).
    """
    if not domain or _is_no_restriction(list(domain)):
        return None
    if is_numeric_bbox(domain):
        west, south, east, north = (int(x) for x in domain)
        return [west, east, south, north]
    return list(domain)
