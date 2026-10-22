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

from typing import Any

import earthkit.data as ekd
import eccodes
import numpy as np
import pytest

from fiab_plugin_ecmwf.geography import runtime
from fiab_plugin_ecmwf.geography.runtime import BBox, regrid

INPUT_NI = 180
INPUT_NJ = 91

# (paramId, offset) of the generated fields
PARAMS = ((167, 280.0), (151, 1000.0))

# Interpolating the smooth input field from 2 degrees is accurate to a few hundredths; the tolerance leaves room for packing
ATOL = 0.1


def _regrid(fields: ekd.FieldList, grid: Any = None, domain: Any = None, fmt_if_list: str | None = None) -> ekd.FieldList:
    """Call regrid with the argument types the compiled block passes (floats and lists)."""
    return regrid(fields, grid=grid, domain=domain, fmt_if_list=fmt_if_list)


def _analytic(lat: np.ndarray, lon: np.ndarray, offset: float) -> np.ndarray:
    return offset + 20.0 * np.cos(np.radians(lat)) + 2.0 * np.sin(np.radians(lon))


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
        np.testing.assert_allclose(values, _analytic(lat, lon, offset), atol=ATOL)


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
        monkeypatch.setattr(runtime, "_get_bbox_from_string", lambda identifier: BBox((60.0, -10.0, 35.0, 30.0), fmt="nwse"))

        result = _regrid(input_fields, grid=1.0, domain="Somewhere")

        self._assert_cutout(result, (26, 41))

    def test_cutout_is_smaller_than_global(self, input_fields: ekd.FieldList) -> None:
        global_result = _regrid(input_fields, grid=1.0)
        cutout = _regrid(input_fields, grid=1.0, domain=self.AREA_NWSE, fmt_if_list="nwse")

        assert np.asarray(cutout[0].to_numpy()).size < np.asarray(global_result[0].to_numpy()).size


def test_empty_fieldlist_is_returned_unchanged() -> None:
    empty = ekd.FieldList.from_fields([])

    assert len(_regrid(empty, grid="O48")) == 0
