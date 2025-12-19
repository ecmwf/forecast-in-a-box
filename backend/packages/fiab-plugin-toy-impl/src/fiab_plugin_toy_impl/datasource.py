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
