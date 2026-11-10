# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Union of latitude and longitude boxes on the sphere, without any third-party dependency."""

from collections.abc import Sequence
from typing import Any

LatLonBox = tuple[float, float, float, float]
"""A box as (north, west, south, east) in degrees. The longitudes span eastwards from west to east, so east may exceed 180."""

GLOBE = 360.0
TOLERANCE = 1e-9
LONGITUDE_DECIMALS = 9


def _arc(west: float, east: float) -> tuple[float, float]:
    """Return the start in [0, 360) and the width in [0, 360] of the longitude arc running eastwards from west to east."""
    width = east - west
    if width < 0:
        width += GLOBE
    return west % GLOBE, min(width, GLOBE)


def _covered_intervals(arcs: Sequence[tuple[float, float]]) -> list[tuple[float, float]]:
    """Return the sorted, merged intervals of [0, 360] covered by the arcs."""
    intervals: list[tuple[float, float]] = []
    for start, width in arcs:
        end = start + width
        if end <= GLOBE:
            intervals.append((start, end))
        else:
            intervals.extend([(start, GLOBE), (0.0, end - GLOBE)])
    merged: list[tuple[float, float]] = []
    for start, end in sorted(intervals):
        if merged and start <= merged[-1][1] + TOLERANCE:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def union_boxes(boxes: Sequence[LatLonBox]) -> LatLonBox:
    """Return the smallest box containing all the boxes.

    The latitudes are the minimum south and maximum north. Each box is a longitude arc running eastwards from its west to its
    east, and the result is the shortest arc covering all of them, found by leaving out the largest gap between the arcs, so it
    can cross the 180 degree line. West is in [-180, 180) and east is west plus the width of the arc. The covering of the whole
    circle is returned as -180 to 180. The result does not depend on the order of the boxes.
    """
    if len(boxes) == 0:
        raise ValueError("Cannot take the union of no boxes.")
    north = max(box[0] for box in boxes)
    south = min(box[2] for box in boxes)

    arcs = [_arc(box[1], box[3]) for box in boxes]
    if any(width >= GLOBE - TOLERANCE for _, width in arcs):
        return (north, -180.0, south, 180.0)

    merged = _covered_intervals(arcs)
    # each gap runs from the end of one covered interval to the start of the next, the last one wrapping round the circle
    gaps = [(merged[index][1], merged[index + 1][0]) for index in range(len(merged) - 1)]
    gaps.append((merged[-1][1], merged[0][0] + GLOBE))
    gap_start, gap_end = max(gaps, key=lambda gap: (gap[1] - gap[0], -gap[0]))
    if gap_end - gap_start <= TOLERANCE:
        return (north, -180.0, south, 180.0)

    width = GLOBE - (gap_end - gap_start)
    west = (gap_end + 180.0) % GLOBE - 180.0
    return (north, round(west, LONGITUDE_DECIMALS), south, round(west + width, LONGITUDE_DECIMALS))


def box_from_preset(config: Any) -> LatLonBox | None:
    """Return the box of an earthkit-plots preset domain configured in plain latitude and longitude, or None for any other preset.

    A preset is either a list of [west, east, south, north], or a dictionary with such a list as its bounds and a coordinate
    reference system, which is plain latitude and longitude only if it is a PlateCarree without further options.
    """
    bounds = config
    if isinstance(config, dict):
        if config.get("crs") != {"name": "PlateCarree"}:
            return None
        bounds = config.get("bounds")
    if not isinstance(bounds, (list, tuple)) or len(bounds) != 4:
        return None
    west, east, south, north = (float(value) for value in bounds)
    return (max(south, north), west, min(south, north), east)


def boxes_from_geometry(geometry: Any) -> list[LatLonBox]:
    """Return the box of each part of a longitude and latitude geometry, which only has a bounds property per part."""
    return [(part.bounds[3], part.bounds[0], part.bounds[1], part.bounds[2]) for part in getattr(geometry, "geoms", [geometry])]
