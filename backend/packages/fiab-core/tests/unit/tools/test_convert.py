# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import pytest

from fiab_core.tools.convert import GeoDomainWrapper
from fiab_core.types import GeoDomainType

# We use GeoDomainType.validate_convert to produce valid initial values,
# matching exactly what the runtime will pass into GeoDomainWrapper.
_geo = GeoDomainType()


class TestGeoDomainWrapperWithBbox:
    """GeoDomainWrapper: bbox (list[int]) input in WSEN order."""

    def _wrap(self, wsen_str: str) -> GeoDomainWrapper:
        return GeoDomainWrapper(_geo.validate_convert(wsen_str))

    def test_initial_value_preserved(self) -> None:
        w = self._wrap("-10,35,30,60")
        assert w.value == [-10, 35, 30, 60]

    def test_with_bbox_earthkitplots_reorders_to_wesn(self) -> None:
        # Input WSEN: [W=-10, S=35, E=30, N=60]
        # Expected WESN: [W=-10, E=30, S=35, N=60]
        w = self._wrap("-10,35,30,60").with_bbox_earthkitplots()
        assert w.value == [-10, 30, 35, 60]

    def test_with_bbox_mars_reorders_to_nwse(self) -> None:
        # Input WSEN: [W=-10, S=35, E=30, N=60]
        # Expected NWSE: [N=60, W=-10, S=35, E=30]
        w = self._wrap("-10,35,30,60").with_bbox_mars()
        assert w.value == [60, -10, 35, 30]

    def test_with_bbox_dwarrowsmap_reorders_to_wnse(self) -> None:
        # Input WSEN: [W=-10, S=35, E=30, N=60]
        # Expected WNSE: [W=-10, N=60, S=35, E=30]
        w = self._wrap("-10,35,30,60").with_bbox_dwarrowsmap()
        assert w.value == [-10, 60, 35, 30]

    def test_with_bbox_ordering_is_idempotent_when_same_fmt(self) -> None:
        w = self._wrap("-10,35,30,60").with_bbox_ordering("wsen")
        assert w.value == [-10, 35, 30, 60]

    def test_chained_reorderings_are_correct(self) -> None:
        # Convert WSEN -> WESN -> WSEN should round-trip
        w = self._wrap("-10,35,30,60").with_bbox_earthkitplots().with_bbox_ordering("wsen")
        assert w.value == [-10, 35, 30, 60]

    def test_antimeridian_crossing_bbox_also_reorders(self) -> None:
        # west > east crossing antimeridian: still valid WSEN
        # WSEN: [W=170, S=-10, E=-170, N=10]
        # WESN: [W=170, E=-170, S=-10, N=10]
        w = self._wrap("170,-10,-170,10").with_bbox_earthkitplots()
        assert w.value == [170, -170, -10, 10]

    def test_with_bbox_ordering_invalid_fmt_raises(self) -> None:
        w = self._wrap("-10,35,30,60")
        with pytest.raises(ValueError, match="permutation of 'wsen'"):
            w.with_bbox_ordering("wnsx")  # 'x' is not in {w, s, e, n}

    def test_with_bbox_ordering_duplicate_chars_raises(self) -> None:
        w = self._wrap("-10,35,30,60")
        with pytest.raises(ValueError, match="permutation of 'wsen'"):
            w.with_bbox_ordering("wwww")


class TestGeoDomainWrapperWithRegionNames:
    """GeoDomainWrapper: list[str] (region name list) is passed through unchanged."""

    def _wrap(self, region_str: str) -> GeoDomainWrapper:
        return GeoDomainWrapper(_geo.validate_convert(region_str))

    def test_initial_value_preserved(self) -> None:
        w = self._wrap("Germany,France,Italy")
        assert w.value == ["Germany", "France", "Italy"]

    def test_with_bbox_earthkitplots_is_passthrough(self) -> None:
        w = self._wrap("Germany,France")
        assert w.with_bbox_earthkitplots().value == ["Germany", "France"]

    def test_with_bbox_mars_is_passthrough(self) -> None:
        w = self._wrap("Germany,France")
        assert w.with_bbox_mars().value == ["Germany", "France"]

    def test_with_bbox_dwarrowsmap_is_passthrough(self) -> None:
        w = self._wrap("Germany,France")
        assert w.with_bbox_dwarrowsmap().value == ["Germany", "France"]

    def test_single_region_is_passthrough(self) -> None:
        w = self._wrap("Europe")
        assert w.with_bbox_earthkitplots().value == ["Europe"]


class TestGeoDomainWrapperWithUnrestrictedGeo:
    """GeoDomainWrapper: str sentinel values (auto/global/datadefined) are passed through unchanged."""

    @pytest.mark.parametrize("sentinel", ["auto", "global", "datadefined"])
    def test_with_bbox_earthkitplots_is_passthrough(self, sentinel: str) -> None:
        value = _geo.validate_convert(sentinel)
        w = GeoDomainWrapper(value).with_bbox_earthkitplots()
        assert w.value == sentinel

    @pytest.mark.parametrize("sentinel", ["auto", "global", "datadefined"])
    def test_with_bbox_mars_is_passthrough(self, sentinel: str) -> None:
        value = _geo.validate_convert(sentinel)
        assert GeoDomainWrapper(value).with_bbox_mars().value == sentinel

    @pytest.mark.parametrize("sentinel", ["auto", "global", "datadefined"])
    def test_with_bbox_ordering_is_passthrough(self, sentinel: str) -> None:
        value = _geo.validate_convert(sentinel)
        assert GeoDomainWrapper(value).with_bbox_ordering("nwse").value == sentinel
