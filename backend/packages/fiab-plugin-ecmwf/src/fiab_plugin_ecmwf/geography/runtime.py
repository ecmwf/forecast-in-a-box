# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.


import logging
import math
import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, cast

from .extent import LatLonBox, box_from_preset, boxes_from_geometry, pad_box, union_boxes

if TYPE_CHECKING:
    import earthkit.data as ekd

LOG = logging.getLogger(__name__)

PADDING_MARGIN_DEGREES = 0.5
"""The fixed margin in degrees added on each side of an area cut out by named regions, on top of one spacing of the target grid."""

_GAUSSIAN_GRID = re.compile(r"([OoNnFf])(\d+)")


GridRuntimeType = str | int | float | list[int | float]
"""A grid: a Gaussian grid name, a single resolution in degrees, or a [west_east, south_north] pair of resolutions."""

GeoDomainRuntimeType = str | list[str] | list[float]
"""An area: a named region, a list of named regions, or a bounding box list whose order is given by the format string."""


def _is_bbox_format(fmt: str) -> bool:
    return len(fmt) == 4 and set(fmt) == {"n", "w", "s", "e"}


@dataclass
class BBox:
    value: Sequence[float]
    fmt: str

    def __post_init__(self) -> None:
        if not _is_bbox_format(self.fmt):
            raise ValueError(f"Expected format string to be a permutation of 'nwse', not {self.fmt}.")
        if not len(self.value) == 4:
            raise ValueError(f"Expected value to contain 4 float's not: {self.value}")

    def format(self, fmt: str) -> tuple[float, float, float, float]:
        if not _is_bbox_format(fmt):
            raise ValueError(f"Expected format string to be a permutation of 'nwse', not {fmt}.")
        current = {c: v for c, v in zip(self.fmt, self.value)}
        new = tuple(current[c] for c in fmt)

        typed_new = cast(tuple[float, float, float, float], new)
        return typed_new


def _latlon_boxes_for_name(identifier: str) -> list[LatLonBox]:
    """Get the latitude and longitude boxes covering a named domain, using `earthkit-plots`.

    A preset domain given in plain latitude and longitude gives its configured box, and a country or region gives the box of each
    part of its Natural Earth shape. Any other domain gives the latitude and longitude box of its projected bounding box.
    """
    # NOTE: These Domain classes will be migrated to earthkit-geo soon (tm)
    # NOTE: Update to .plots.geography.* if upgrading to earthkit-plots > 1.0
    try:
        from earthkit.plots.geo.domains import Domain  # type: ignore[unresolved-import]
    except ImportError as e:
        raise RuntimeError("Cannot import `earthkit-plots") from e

    domain = Domain.from_string(identifier)
    if not domain.can_bbox:
        raise RuntimeError(f"Domain created from {identifier=} cannot be used as a bounding box.")

    try:
        boxes = _tight_boxes_for_name(identifier)
    except (ImportError, AttributeError, KeyError, TypeError) as e:
        LOG.warning(f"Cannot read the latitude and longitude extent of {identifier!r} from earthkit-plots: {e!r}.")
        boxes = []
    if boxes:
        return boxes

    bbox = domain.bbox.to_latlon_bbox()
    return [(float(bbox.north), float(bbox.west), float(bbox.south), float(bbox.east))]


def _tight_boxes_for_name(identifier: str) -> list[LatLonBox]:
    """Get the boxes of a named domain from the `earthkit-plots` presets and Natural Earth shapes, or none if the domain has no
    plain latitude and longitude extent."""
    # these are internals of earthkit-plots that may be unavailable or change, so they are imported apart from Domain
    from earthkit.plots.ancillary import load  # type: ignore[unresolved-import]
    from earthkit.plots.geo.domains import format_name  # type: ignore[unresolved-import]
    from earthkit.plots.geo.natural_earth import NaturalEarthDomain  # type: ignore[unresolved-import]

    canonical = format_name(identifier)
    presets = load("domains", data_type="geo")["domains"]
    if canonical in presets:
        preset_box = box_from_preset(presets[canonical])
        return [] if preset_box is None else [preset_box]
    return boxes_from_geometry(NaturalEarthDomain(canonical or identifier).geometry)


def _get_bbox_from_names(identifiers: Sequence[str]) -> BBox:
    """Get the smallest latitude and longitude box containing all the named domains, which may cross the 180 degree line."""
    boxes = [box for identifier in identifiers for box in _latlon_boxes_for_name(identifier)]
    return BBox(union_boxes(boxes), fmt="nwse")


def _is_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _numeric_increments(grid: object) -> tuple[float, float] | None:
    """Return the (west_east, south_north) increments of a numeric grid, or None if the grid is not a valid numeric one."""
    values: list[object]
    if isinstance(grid, str):
        parts = grid.split("/")
        if len(parts) not in (1, 2):
            return None
        try:
            values = [float(part) for part in parts]
        except ValueError:
            return None
        if len(values) == 1:
            values = values * 2
    elif isinstance(grid, (list, tuple)):
        values = list(grid)
    else:
        values = [grid, grid]
    if len(values) != 2 or not all(_is_number(value) for value in values):
        return None
    west_east, south_north = (float(cast(float, value)) for value in values)
    if not (math.isfinite(west_east) and math.isfinite(south_north)) or west_east <= 0 or south_north <= 0:
        return None
    return west_east, south_north


def grid_spacing(grid: object, box: LatLonBox) -> tuple[float, float] | None:
    """Return the (latitude, longitude) spacing in degrees of the grid around the box, or None if it cannot be determined.

    A Gaussian grid O<N>, N<N> or F<N> has latitude spacing 90/N. The longitude spacing of F<N> is 90/N, and that of O<N> and N<N>
    is 360 divided by the points of the octahedral row nearest the pole of the box, 4*i + 16 points for the i-th row from the pole.
    A numeric grid, a single resolution or a [west_east, south_north] pair, uses its increments.
    """
    if isinstance(grid, str):
        match = _GAUSSIAN_GRID.fullmatch(grid.strip())
        if match is not None:
            number = int(match.group(2))
            if number <= 0:
                return None
            latitude_spacing = 90.0 / number
            if match.group(1).upper() == "F":
                return latitude_spacing, latitude_spacing
            poleward = min(90.0, max(abs(box[0]), abs(box[2])))
            row = max(1, math.ceil((90.0 - poleward) / latitude_spacing - 1e-9))
            return latitude_spacing, 360.0 / (4 * row + 16)
    increments = _numeric_increments(grid)
    if increments is None:
        return None
    return increments[1], increments[0]


def pad_named_box(box: LatLonBox, grid: object) -> LatLonBox:
    """Return the box widened by one spacing of the grid plus a fixed margin of PADDING_MARGIN_DEGREES.

    Without a known grid spacing only the fixed margin is added.
    """
    spacing = grid_spacing(grid, box)
    if spacing is None:
        LOG.info(f"Grid spacing of {grid!r} is unknown; padding the area by the fixed margin of {PADDING_MARGIN_DEGREES} degrees only.")
        spacing = (0.0, 0.0)
    return pad_box(box, spacing[0] + PADDING_MARGIN_DEGREES, spacing[1] + PADDING_MARGIN_DEGREES)


def _ensure_mir_installed() -> None:
    try:
        import mir  # type: ignore[unresolved-import]
    except ImportError as e:
        raise RuntimeError("Cannot import `mir`") from e


def regrid(
    data: "ekd.FieldList",
    grid: GridRuntimeType | None = None,
    domain: GeoDomainRuntimeType | None = None,
    fmt_if_list: str | None = None,
) -> "ekd.FieldList":
    """Regrid a fieldlist to the grid, and cut it out to the domain if one is given.

    The grid is a Gaussian grid name, a single resolution in degrees or a [west_east, south_north] pair of resolutions, and is
    passed to MIR unchanged. The domain is a named region, a list of named regions, or a bounding box list of numbers in the order
    given by `fmt_if_list`. Several named regions are cut out as the smallest latitude and longitude box containing all of them,
    which may cross the 180 degree line. The box of named regions is widened on every side by one spacing of the grid plus
    PADDING_MARGIN_DEGREES, using only the margin if the grid spacing is unknown, with the latitudes limited to the poles. A bounding
    box list is used exactly as given. A domain of None or an empty list leaves the area untouched.
    """
    _ensure_mir_installed()
    if domain is not None and not isinstance(domain, (str, list)):
        raise TypeError(f"`domain` must be a string, a list or None, not {type(domain).__name__}")
    names: list[str] = []
    corners: list[float] = []
    if isinstance(domain, str):
        names = [domain]
    elif isinstance(domain, list) and len(domain) > 0:
        if all(isinstance(item, str) for item in domain):
            names = cast(list[str], domain)
        elif all(_is_number(item) for item in domain):
            if fmt_if_list is None:
                raise ValueError("`fmt_if_list` must be set if `domain` is a list of numbers")
            corners = cast(list[float], domain)
        else:
            raise TypeError(f"`domain` list must hold only names or only numbers, not {domain!r}")

    # mir_backend imports earthkit-data, which is only present at runtime
    from .mir_backend import mir_regrid

    if names:
        bbox = list(pad_named_box(_get_bbox_from_names(names).format("nwse"), grid))
    elif corners:
        assert fmt_if_list is not None
        bbox = list(BBox(corners, fmt=fmt_if_list).format("nwse"))
    else:
        bbox = None

    return mir_regrid(data, grid=grid, area=bbox)
