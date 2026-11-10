# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.


import logging
from collections.abc import Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, cast

from .extent import LatLonBox, box_from_preset, boxes_from_geometry, union_boxes

if TYPE_CHECKING:
    import earthkit.data as ekd

LOG = logging.getLogger(__name__)


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
    which may cross the 180 degree line. A domain of None or an empty list leaves the area untouched.
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
        bbox = list(_get_bbox_from_names(names).format("nwse"))
    elif corners:
        assert fmt_if_list is not None
        bbox = list(BBox(corners, fmt=fmt_if_list).format("nwse"))
    else:
        bbox = None

    return mir_regrid(data, grid=grid, area=bbox)
