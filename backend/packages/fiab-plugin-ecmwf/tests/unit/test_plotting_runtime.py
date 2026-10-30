# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import earthkit.data as ekd
import eccodes
import numpy as np
import pytest

from fiab_plugin_ecmwf.plotting import runtime
from fiab_plugin_ecmwf.plotting.runtime import _is_lambert, _needs_latlon, _prepare_fields


def _grib_field(grid_keys: dict, values: np.ndarray) -> ekd.FieldList:
    handle = eccodes.codes_grib_new_from_samples("GRIB2")
    try:
        for key, value in grid_keys.items():
            eccodes.codes_set(handle, key, value)
        eccodes.codes_set(handle, "paramId", 167)
        eccodes.codes_set_values(handle, values)
        message = eccodes.codes_get_message(handle)
    finally:
        eccodes.codes_release(handle)
    return ekd.from_source("memory", message)


@pytest.fixture
def lambert_field() -> ekd.FieldList:
    nx, ny = 4, 3
    keys = {
        "gridDefinitionTemplateNumber": 30,
        "shapeOfTheEarth": 1,
        "scaleFactorOfRadiusOfSphericalEarth": 0,
        "scaledValueOfRadiusOfSphericalEarth": 6371000,
        "Nx": nx,
        "Ny": ny,
        "latitudeOfFirstGridPointInDegrees": 60.0,
        "longitudeOfFirstGridPointInDegrees": 10.0,
        "LaDInDegrees": 63.3,
        "LoVInDegrees": 15.0,
        "Latin1InDegrees": 63.3,
        "Latin2InDegrees": 63.3,
        "DxInMetres": 2500.0,
        "DyInMetres": 2500.0,
        "iScansNegatively": 0,
        "jScansPositively": 1,
    }
    return _grib_field(keys, np.arange(nx * ny, dtype=float))


@pytest.fixture
def regular_ll_field() -> ekd.FieldList:
    keys = {
        "gridDefinitionTemplateNumber": 0,
        "Ni": 4,
        "Nj": 3,
        "latitudeOfFirstGridPointInDegrees": 60.0,
        "longitudeOfFirstGridPointInDegrees": 0.0,
        "latitudeOfLastGridPointInDegrees": 58.0,
        "longitudeOfLastGridPointInDegrees": 3.0,
        "iDirectionIncrementInDegrees": 1.0,
        "jDirectionIncrementInDegrees": 1.0,
    }
    return _grib_field(keys, np.arange(12, dtype=float))


# NOTE the rewrapped ArrayFields are not built here: with the backend's earthkit-data (0.19), a process holding one
# crashes at interpreter exit, which fails the test run although the tests pass; the plot environment is not affected
class TestPrepareFields:
    def test_lambert_field_is_rewrapped(self, lambert_field: ekd.FieldList, monkeypatch: pytest.MonkeyPatch) -> None:
        field = lambert_field[0]
        assert _is_lambert(field) and _needs_latlon(field)
        assert field.to_latlon(flatten=True)["lat"].size == 12

        rewrapped = []
        monkeypatch.setattr(runtime, "_to_latlon_field", lambda f: rewrapped.append(f) or f)
        _prepare_fields(lambert_field)
        assert [f.metadata("gridType") for f in rewrapped] == ["lambert"]

    def test_regular_ll_field_is_unchanged(self, regular_ll_field: ekd.FieldList) -> None:
        assert not _is_lambert(regular_ll_field[0]) and not _needs_latlon(regular_ll_field[0])
        assert _prepare_fields(regular_ll_field) is regular_ll_field
