# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Runtime tests for the geography regrid task, executing MIR on small in-memory GRIB fields.

The input fields are generated with ecCodes samples, so no network access is needed. The tests
require the `runtime` extra (earthkit-data and mir-python).
"""

from collections.abc import Sequence
from typing import Any

import earthkit.data as ekd
import eccodes
import numpy as np
import pytest

from fiab_plugin_ecmwf.geography import runtime
from fiab_plugin_ecmwf.geography.mir_backend import mir_regrid
from fiab_plugin_ecmwf.geography.runtime import BBox, regrid

INPUT_NI = 180
INPUT_NJ = 91

# (paramId, offset) of the generated fields
PARAMS = ((167, 280.0), (151, 1000.0))

# The field is linear in the Cartesian coordinates of the point on the unit sphere, so it is smooth everywhere including the poles.
# Its second derivative along any direction is at most the amplitude A = sqrt(6^2 + 4^2 + 8^2) of about 10.8 K per radian squared,
# so linear interpolation from the 2 degree source (h = 0.0349 rad) errs by at most h^2 / 8 * A = 1.6e-3 K in each of the two
# directions, 3.3e-3 K in all. Packing the 22 K range in 16 bits adds at most 3.4e-4 K at the source and again at the target. The
# largest error seen over all the targets is 3.0e-3 K, and the tolerance of 0.01 K is a factor 3 above that and about 2000 times
# below the range of the field.
ATOL = 0.01


def _regrid(fields: ekd.FieldList, grid: Any = None, domain: Any = None, fmt_if_list: str | None = None) -> ekd.FieldList:
    """Call regrid with the argument types the compiled block passes (floats and lists)."""
    return regrid(fields, grid=grid, domain=domain, fmt_if_list=fmt_if_list)


def _analytic(lat: np.ndarray, lon: np.ndarray, offset: float) -> np.ndarray:
    """A field linear in the Cartesian components x, y and z of the point on the unit sphere."""
    lat_rad, lon_rad = np.radians(lat), np.radians(lon)
    x = np.cos(lat_rad) * np.cos(lon_rad)
    y = np.cos(lat_rad) * np.sin(lon_rad)
    z = np.sin(lat_rad)
    return offset + 6.0 * x + 4.0 * y + 8.0 * z


def _global_latlon_message(param_id: int, offset: float) -> bytes:
    """Encode a global 2 degree regular lat/lon GRIB2 message holding the analytic field."""
    handle = eccodes.codes_grib_new_from_samples("regular_ll_sfc_grib2")
    try:
        eccodes.codes_set(handle, "Ni", INPUT_NI)
        eccodes.codes_set(handle, "Nj", INPUT_NJ)
        eccodes.codes_set(handle, "latitudeOfFirstGridPointInDegrees", 90.0)
        eccodes.codes_set(handle, "latitudeOfLastGridPointInDegrees", -90.0)
        eccodes.codes_set(handle, "longitudeOfFirstGridPointInDegrees", 0.0)
        eccodes.codes_set(handle, "longitudeOfLastGridPointInDegrees", 360.0 - 360.0 / INPUT_NI)
        eccodes.codes_set(handle, "iDirectionIncrementInDegrees", 360.0 / INPUT_NI)
        eccodes.codes_set(handle, "jDirectionIncrementInDegrees", 180.0 / (INPUT_NJ - 1))
        eccodes.codes_set(handle, "paramId", param_id)
        eccodes.codes_set(handle, "dataDate", 20240101)
        lat = np.linspace(90.0, -90.0, INPUT_NJ)[:, None] * np.ones((1, INPUT_NI))
        lon = np.linspace(0.0, 360.0, INPUT_NI, endpoint=False)[None, :] * np.ones((INPUT_NJ, 1))
        eccodes.codes_set_values(handle, _analytic(lat, lon, offset).ravel())
        return eccodes.codes_get_message(handle)
    finally:
        eccodes.codes_release(handle)


@pytest.fixture
def input_fields() -> ekd.FieldList:
    messages = b"".join(_global_latlon_message(param_id, offset) for param_id, offset in PARAMS)
    return ekd.from_source("memory", messages)  # type: ignore[unresolved-attribute]


def _assert_values_match_analytic(fields: ekd.FieldList) -> None:
    for index, (_, offset) in enumerate(PARAMS):
        field = fields[index]
        latlon = field.to_latlon()
        lat = np.asarray(latlon["lat"]).ravel()
        lon = np.asarray(latlon["lon"]).ravel()
        values = np.asarray(field.to_numpy()).ravel()
        assert np.isfinite(values).all()
        np.testing.assert_allclose(values, _analytic(lat, lon, offset), rtol=0, atol=ATOL)


def _assert_identity_preserved(fields: ekd.FieldList) -> None:
    assert fields.metadata("paramId") == [param_id for param_id, _ in PARAMS]
    assert fields.metadata("dataDate") == [20240101] * len(PARAMS)


def _extent(field: ekd.Field) -> tuple[float, float, float, float]:
    """Return (north, west, south, east), with longitudes in [-180, 180)."""
    latlon = field.to_latlon()
    lat = np.asarray(latlon["lat"])
    lon = (np.asarray(latlon["lon"]) + 180.0) % 360.0 - 180.0
    return float(lat.max()), float(lon.min()), float(lat.min()), float(lon.max())


def test_input_fields_are_global_latlon(input_fields: ekd.FieldList) -> None:
    assert len(input_fields) == len(PARAMS)
    for field in input_fields:
        assert field.shape == (INPUT_NJ, INPUT_NI)
        assert field.metadata("gridType") == "regular_ll"


class TestRegridGaussian:
    @pytest.mark.parametrize(
        ("grid", "grid_type", "gaussian_number", "number_of_points"),
        [
            ("O48", "reduced_gg", 48, 4 * 48 * (48 + 9)),
            ("o48", "reduced_gg", 48, 4 * 48 * (48 + 9)),
            ("N48", "reduced_gg", 48, 13280),
        ],
    )
    def test_gaussian_grid_target(
        self, input_fields: ekd.FieldList, grid: str, grid_type: str, gaussian_number: int, number_of_points: int
    ) -> None:
        result = _regrid(input_fields, grid=grid)

        assert len(result) == len(PARAMS)
        for field in result:
            assert field.metadata("gridType") == grid_type
            assert field.metadata("N") == gaussian_number
            assert field.metadata("numberOfDataPoints") == number_of_points
            assert np.asarray(field.to_numpy()).size == number_of_points
        _assert_identity_preserved(result)
        _assert_values_match_analytic(result)

    def test_gaussian_grid_is_global(self, input_fields: ekd.FieldList) -> None:
        result = _regrid(input_fields, grid="O48")

        for field in result:
            north, west, south, east = _extent(field)
            assert north > 88.0
            assert south < -88.0
            assert east - west > 350.0


class TestRegridLatLon:
    @pytest.mark.parametrize("grid", [1.0, [1.0, 1.0], (1.0, 1.0), "1/1"])
    def test_regular_resolution_target(self, input_fields: ekd.FieldList, grid: object) -> None:
        result = _regrid(input_fields, grid=grid)

        assert len(result) == len(PARAMS)
        for field in result:
            assert field.metadata("gridType") == "regular_ll"
            assert field.metadata("Ni") == 360
            assert field.metadata("Nj") == 181
            assert field.shape == (181, 360)
            north, _, south, _ = _extent(field)
            assert (north, south) == (90.0, -90.0)
        _assert_identity_preserved(result)
        _assert_values_match_analytic(result)

    def test_coarser_resolution_target(self, input_fields: ekd.FieldList) -> None:
        result = _regrid(input_fields, grid=4.0)

        # MIR anchors a global regular grid at (0, 0), so 4 degrees spans latitudes 88 to -88
        for field in result:
            assert field.shape == (45, 90)
            north, _, south, _ = _extent(field)
            assert (north, south) == (88.0, -88.0)
        _assert_values_match_analytic(result)

    @pytest.mark.parametrize(
        ("grid", "west_east", "south_north", "shape"),
        [
            ([1.0, 2.0], 1.0, 2.0, (91, 360)),
            ("1/2", 1.0, 2.0, (91, 360)),
            ([2.0, 1.0], 2.0, 1.0, (181, 180)),
            ([1, 2], 1.0, 2.0, (91, 360)),
        ],
    )
    def test_anisotropic_resolution_target(
        self, input_fields: ekd.FieldList, grid: object, west_east: float, south_north: float, shape: tuple[int, int]
    ) -> None:
        # The first resolution is west-east and the second south-north, and MIR anchors a global grid at (0, 0)
        result = _regrid(input_fields, grid=grid)

        assert len(result) == len(PARAMS)
        for field in result:
            assert field.metadata("gridType") == "regular_ll"
            assert field.metadata("iDirectionIncrementInDegrees") == west_east
            assert field.metadata("jDirectionIncrementInDegrees") == south_north
            assert field.shape == shape
            north, _, south, _ = _extent(field)
            assert (north, south) == (90.0, -90.0)
        _assert_identity_preserved(result)
        _assert_values_match_analytic(result)


class TestRegridEmptyArea:
    @pytest.mark.parametrize("domain", [None, []])
    def test_empty_area_only_regrids(self, input_fields: ekd.FieldList, domain: object) -> None:
        result = _regrid(input_fields, grid=1.0, domain=domain, fmt_if_list="nwse")

        assert len(result) == len(PARAMS)
        for field in result:
            assert field.metadata("gridType") == "regular_ll"
            assert field.shape == (181, 360)
            north, west, south, east = _extent(field)
            assert (north, south) == (90.0, -90.0)
            assert east - west == 359.0
        _assert_identity_preserved(result)
        _assert_values_match_analytic(result)

    def test_empty_area_with_pair_grid(self, input_fields: ekd.FieldList) -> None:
        result = _regrid(input_fields, grid=[1.0, 2.0], domain=[], fmt_if_list="nwse")

        for field in result:
            assert field.shape == (91, 360)
            north, _, south, _ = _extent(field)
            assert (north, south) == (90.0, -90.0)
        _assert_values_match_analytic(result)

    def test_empty_area_with_gaussian_grid(self, input_fields: ekd.FieldList) -> None:
        result = _regrid(input_fields, grid="O48", domain=[])

        for field in result:
            assert field.metadata("gridType") == "reduced_gg"
            assert field.metadata("numberOfDataPoints") == 4 * 48 * (48 + 9)
            north, west, south, east = _extent(field)
            assert north > 88.0
            assert south < -88.0
            assert east - west > 350.0
        _assert_values_match_analytic(result)


class TestRegridBoundingBox:
    # nwse of the cut-out; on the 1 degree grid it holds 26 rows and 41 columns
    AREA_NWSE = [60.0, -10.0, 35.0, 30.0]

    def _assert_cutout(self, result: ekd.FieldList, shape: tuple[int, int]) -> None:
        assert len(result) == len(PARAMS)
        for field in result:
            assert field.metadata("gridType") == "regular_ll"
            assert field.shape == shape
            north, west, south, east = _extent(field)
            np.testing.assert_allclose([north, west, south, east], self.AREA_NWSE)
        _assert_identity_preserved(result)
        _assert_values_match_analytic(result)

    def test_nwse_list_domain(self, input_fields: ekd.FieldList) -> None:
        result = _regrid(input_fields, grid=1.0, domain=self.AREA_NWSE, fmt_if_list="nwse")

        self._assert_cutout(result, (26, 41))

    def test_wsen_list_domain_is_reordered(self, input_fields: ekd.FieldList) -> None:
        result = _regrid(input_fields, grid=1.0, domain=[-10.0, 35.0, 30.0, 60.0], fmt_if_list="wsen")

        self._assert_cutout(result, (26, 41))

    def test_finer_resolution(self, input_fields: ekd.FieldList) -> None:
        result = _regrid(input_fields, grid=0.5, domain=self.AREA_NWSE, fmt_if_list="nwse")

        self._assert_cutout(result, (51, 81))

    def test_named_domain(self, input_fields: ekd.FieldList, monkeypatch: pytest.MonkeyPatch) -> None:
        # the real lookup reads natural earth shapes through cartopy, which can need the network
        monkeypatch.setattr(runtime, "_get_bbox_from_names", lambda identifiers: BBox((60.0, -10.0, 35.0, 30.0), fmt="nwse"))

        result = _regrid(input_fields, grid=1.0, domain="Somewhere")

        self._assert_cutout(result, (26, 41))

    @pytest.mark.parametrize("names", [["West", "East"], ["East", "West"]])
    def test_several_named_domains_are_cut_out_as_one_bounding_box(
        self, input_fields: ekd.FieldList, monkeypatch: pytest.MonkeyPatch, names: list[str]
    ) -> None:
        # offline stand-in for the lookup and union of the named domains: the box (north, west, south, east) holding every named box
        boxes = {"West": (60.0, -10.0, 45.0, 10.0), "East": (50.0, 5.0, 35.0, 30.0)}
        lookups: list[list[str]] = []

        def _union_bbox(identifiers: Sequence[str]) -> BBox:
            lookups.append(list(identifiers))
            selected = [boxes[name] for name in identifiers]
            north, south = max(box[0] for box in selected), min(box[2] for box in selected)
            west, east = min(box[1] for box in selected), max(box[3] for box in selected)
            return BBox((north, west, south, east), fmt="nwse")

        monkeypatch.setattr(runtime, "_get_bbox_from_names", _union_bbox)

        result = _regrid(input_fields, grid=1.0, domain=names)

        assert lookups == [names]
        self._assert_cutout(result, (26, 41))

    def test_cutout_is_smaller_than_global(self, input_fields: ekd.FieldList) -> None:
        global_result = _regrid(input_fields, grid=1.0)
        cutout = _regrid(input_fields, grid=1.0, domain=self.AREA_NWSE, fmt_if_list="nwse")

        assert np.asarray(cutout[0].to_numpy()).size < np.asarray(global_result[0].to_numpy()).size


class TestRegridAcrossAntimeridian:
    # The union of the two named boxes below is north -10, south -22, and longitudes from 175 east over the 180 line to 190 (170 west).
    # With an area given, MIR anchors the 1 degree grid at the south west corner, so the cut-out holds 13 rows and 16 columns.
    NAMED_BOXES: dict[str, list[tuple[float, float, float, float]]] = {
        "Eastland": [(-10.0, 175.0, -20.0, 180.0)],
        "Westland": [(-12.0, -178.0, -22.0, -170.0)],
    }
    WEST = 175.0
    SHAPE = (13, 16)

    def _assert_crosses_the_180_line(self, result: ekd.FieldList) -> None:
        assert len(result) == len(PARAMS)
        for field in result:
            assert field.metadata("gridType") == "regular_ll"
            assert field.shape == self.SHAPE
            latlon = field.to_latlon()
            lat = np.asarray(latlon["lat"])
            lon = np.asarray(latlon["lon"])
            np.testing.assert_allclose([lat.max(), lat.min()], [-10.0, -22.0])
            # longitudes measured eastwards from the west edge, whichever way MIR writes the ones past 180
            eastwards = (lon - self.WEST) % 360.0
            np.testing.assert_allclose([eastwards.min(), eastwards.max()], [0.0, 15.0])
            wrapped = (lon + 180.0) % 360.0 - 180.0
            assert (wrapped > 0).any()
            assert (wrapped < 0).any()
        _assert_identity_preserved(result)
        _assert_values_match_analytic(result)

    @pytest.mark.parametrize("names", [["Eastland", "Westland"], ["Westland", "Eastland"]])
    def test_named_domains_either_side_of_the_180_line(
        self, input_fields: ekd.FieldList, monkeypatch: pytest.MonkeyPatch, names: list[str]
    ) -> None:
        # only the per-name lookup is replaced, the combination into one area is the real union
        monkeypatch.setattr(runtime, "_latlon_boxes_for_name", lambda identifier: self.NAMED_BOXES[identifier])

        result = _regrid(input_fields, grid=1.0, domain=names)

        self._assert_crosses_the_180_line(result)

    @pytest.mark.parametrize("east", [190.0, -170.0])
    def test_mir_regrid_accepts_an_area_with_east_beyond_180(self, input_fields: ekd.FieldList, east: float) -> None:
        result = mir_regrid(input_fields, grid=1.0, area=[-10.0, 175.0, -22.0, east])

        self._assert_crosses_the_180_line(result)


def test_empty_fieldlist_is_returned_unchanged() -> None:
    empty = ekd.FieldList.from_fields([])

    assert len(_regrid(empty, grid="O48")) == 0
