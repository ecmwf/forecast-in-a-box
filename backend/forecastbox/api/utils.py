# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

from pathlib import Path
import io
import earthkit.data as ekd
import xarray as xr
import numpy as np
import cloudpickle
import logging

from forecastbox.config import config
from cascade.gateway.api import decoded_result
import cascade.gateway.api as api

logger = logging.getLogger(__name__)


def get_model_path(model: str) -> Path:
    """Get the path to a model."""
    return (Path(config.api.data_path) / model).with_suffix(".ckpt").absolute()


def encode_result(result: api.ResultRetrievalResponse) -> tuple[bytes, str]:
    """Converts cascade Result response to bytes+mime"""
    obj = decoded_result(result, job=None)
    if isinstance(obj, bytes):
        return obj, "application/pickle"

    try:
        from earthkit.plots import Figure

        if isinstance(obj, Figure):
            buf = io.BytesIO()
            obj.save(buf)
            return buf.getvalue(), "image/png"
    except ImportError:
        pass

    if isinstance(obj, ekd.FieldList):
        encoder = ekd.create_encoder("grib")
        if isinstance(obj, ekd.Field):
            return encoder.encode(obj).to_bytes(), "application/grib"
        elif isinstance(obj, ekd.FieldList):
            return encoder.encode(obj[0], template=obj[0]).to_bytes(), "application/grib"

    elif isinstance(obj, (xr.Dataset, xr.DataArray)):
        buf = io.BytesIO()
        obj.to_netcdf(buf, format="NETCDF4")
        return buf.getvalue(), "application/netcdf"

    elif isinstance(obj, np.ndarray):
        buf = io.BytesIO()
        np.save(buf, obj)
        return buf.getvalue(), "application/numpy"

    else:
        return cloudpickle.dumps(obj), "application/clpkl"
