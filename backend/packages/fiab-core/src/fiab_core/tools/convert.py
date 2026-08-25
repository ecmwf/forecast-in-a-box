# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Utilities for converting between various representations"""

from dataclasses import dataclass, field, replace
from typing import Literal, NewType, Self

from fiab_core.types import UnrestrictedGeoDomainLiteral

GeoDomainRuntimeType = list[str] | UnrestrictedGeoDomainLiteral | list[float]


@dataclass
class GeoDomainWrapper:
    value: GeoDomainRuntimeType
    fmt: str = field(default="wsen")

    def with_bbox_ordering(self, fmt: str) -> Self:
        """Give some permutation of 'wsen' to reorder the bbox inside. If geo domain is inside instead,
        passthrough"""
        if set(fmt) != {"w", "s", "e", "n"}:
            raise ValueError(f"expected some permutation of 'wsen', but got {fmt} instead")
        if isinstance(self.value, list) and len(self.value) > 0 and isinstance(self.value[0], (int, float)):
            current = {v: i for i, v in enumerate(self.fmt)}
            l = []
            for v in fmt:
                l.append(self.value[current[v]])
            return replace(self, value=l, fmt=fmt)
        else:
            return self

    def with_bbox_earthkitplots(self) -> Self:
        """WESN order, used eg by earthkit.plots.Figure / domain"""
        return self.with_bbox_ordering("wesn")

    def with_bbox_mars(self) -> Self:
        """NWSE order, as used by MARS/MIR"""
        return self.with_bbox_ordering("nwse")

    def with_bbox_dwarrowsmap(self) -> Self:
        """WNSE order, as used by dwarrows when drawing their maps, clockwise from the top"""
        return self.with_bbox_ordering("wnse")


GridRuntimeType = str | list[float]


@dataclass
class GridWrapper:
    value: GridRuntimeType

    def as_grid_spec(self) -> dict[Literal["grid"], str | list[float]]:
        """Return a dict suitable for passing to earthkit.plots.Figure / domain"""
        if isinstance(self.value, str):
            return {"grid": self.value}
        elif isinstance(self.value, float) or isinstance(self.value, int):
            return {"grid": str(self.value)}
        elif isinstance(self.value, list) and len(self.value) == 2:
            return {"grid": "/".join(str(v) for v in self.value)}
        else:
            raise ValueError(f"expected grid to be a string or a list of two floats, but got {self.value!r} instead")
