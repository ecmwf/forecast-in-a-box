# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.


from dataclasses import dataclass
from typing import TYPE_CHECKING, cast

if TYPE_CHECKING:
    import earthkit.data as ekd


GeoDomainRuntimeType = str | tuple[float, float, float, float]


@dataclass
class BBox:
    value: tuple[float, float, float, float]
    fmt: str

    def __post_init__(self) -> None:
        if set(self.fmt) != {"n", "w", "s", "e"}:
            raise ValueError(f"Expected format string of 'nwse'-ish, not {self.fmt}.")
        if not len(self.value) == 4:
            raise ValueError(f"Expected value to contain 4 float's not: {self.value}")

    def format(self, fmt: str) -> tuple[float, float, float, float]:
        if set(fmt) != {"n", "w", "s", "e"}:
            raise ValueError(f"Expected format string of 'nwse'-ish, not {fmt}.")
        current = {c: v for c, v in zip(self.fmt, self.value)}
        new = tuple(current[c] for c in fmt)

        typed_new = cast(tuple[float, float, float, float], new)
        return typed_new


def _get_bbox_from_string(identifier: str) -> BBox:
    """Get a bounding box from a string identifier using `earthkit-plots."""
    # NOTE: These Domain classes will be migrated to earthkit-geo soon (tm)
    # NOTE: Update to .plots.geography.* if upgrading to earthkit-plots > 1.0
    try:
        from earthkit.plots.geo.domains import Domain
    except ImportError as e:
        raise RuntimeError("Cannot import `earthkit-plots") from e

    domain = Domain.from_string(identifier)
    if not domain.can_bbox:
        raise RuntimeError(f"Domain created from {identifier=} cannot be used as a bounding box.")
    bbox = domain.bbox.to_latlon_bbox()
    return BBox((bbox.north, bbox.west, bbox.south, bbox.east), fmt="nwse")


def _ensure_mir_installed() -> None:
    try:
        import mir
    except ImportError as e:
        raise RuntimeError("Cannot import `mir`") from e


def regrid(
    data: "ekd.FieldList",
    grid: str | list[int | float] | None = None,
    domain: GeoDomainRuntimeType | None = None,
    fmt_if_list: str | None = None,
) -> "ekd.FieldList":
    """Regrid a fieldlist"""
    _ensure_mir_installed()
    if domain is not None and isinstance(domain, list) and fmt_if_list is None:
        raise ValueError("`fmt_if_list` must be set if `domain` is a list")

    from .mir_backend import mir_regrid

    if isinstance(domain, str):
        bbox = list(_get_bbox_from_string(domain).format("nwse"))
    elif isinstance(domain, list):
        assert fmt_if_list is not None
        bbox = list(BBox(domain, fmt=fmt_if_list).format("nwse"))
    else:
        bbox = None

    return mir_regrid(data, grid=grid, area=bbox)
