# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.


from collections.abc import Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, cast

if TYPE_CHECKING:
    import earthkit.data as ekd


GridRuntimeType = str | int | float | list[int | float]
"""A grid: a Gaussian grid name, a single resolution in degrees, or a [west_east, south_north] pair of resolutions."""

GeoDomainRuntimeType = str | list[float]
"""An area: a named region, or a bounding box list whose order is given by the format string."""


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


def _get_bbox_from_string(identifier: str) -> BBox:
    """Get a bounding box from a string identifier using `earthkit-plots."""
    # NOTE: These Domain classes will be migrated to earthkit-geo soon (tm)
    # NOTE: Update to .plots.geography.* if upgrading to earthkit-plots > 1.0
    try:
        from earthkit.plots.geo.domains import Domain  # type: ignore[unresolved-import]
    except ImportError as e:
        raise RuntimeError("Cannot import `earthkit-plots") from e

    domain = Domain.from_string(identifier)
    if not domain.can_bbox:
        raise RuntimeError(f"Domain created from {identifier=} cannot be used as a bounding box.")
    bbox = domain.bbox.to_latlon_bbox()
    return BBox((bbox.north, bbox.west, bbox.south, bbox.east), fmt="nwse")


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
    passed to MIR unchanged. The domain is a named region, or a bounding box list in the order given by `fmt_if_list`. A domain
    of None or an empty list leaves the area untouched.
    """
    _ensure_mir_installed()
    if domain is not None and not isinstance(domain, (str, list)):
        raise TypeError(f"`domain` must be a string, a list or None, not {type(domain).__name__}")
    if isinstance(domain, list) and len(domain) > 0 and fmt_if_list is None:
        raise ValueError("`fmt_if_list` must be set if `domain` is a list")

    # mir_backend imports earthkit-data, which is only present at runtime
    from .mir_backend import mir_regrid

    if isinstance(domain, str):
        bbox = list(_get_bbox_from_string(domain).format("nwse"))
    elif isinstance(domain, list) and len(domain) > 0:
        assert fmt_if_list is not None
        bbox = list(BBox(domain, fmt=fmt_if_list).format("nwse"))
    else:
        bbox = None

    return mir_regrid(data, grid=grid, area=bbox)
