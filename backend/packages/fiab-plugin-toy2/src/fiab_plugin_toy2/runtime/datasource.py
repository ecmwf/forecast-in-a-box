# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import json
import logging
from typing import Literal

import earthkit.data as ekd
import xarray as xr

logger = logging.getLogger(__name__)


def from_source(source: Literal["mars", "ecmwf-open-data"], request_params_json: str) -> xr.Dataset:
    logger.debug(f"gotten params {request_params_json}")
    ds = ekd.from_source(
        source,
        request=json.loads(request_params_json),
    )
    return ds.to_xarray()


def from_example() -> xr.Dataset:
    ekd.download_example_file(["test.grib"])
    ds = ekd.from_source("file", "test.grib")
    return ds.to_xarray()
