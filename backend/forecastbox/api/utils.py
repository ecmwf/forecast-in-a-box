# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import io
import logging
from pathlib import Path

import cascade.gateway.api as api
import cloudpickle
import earthkit.data as ekd
import numpy as np
import xarray as xr
from cascade.gateway.api import decoded_result
from forecastbox.config import config

logger = logging.getLogger(__name__)


def get_model_path(model: str) -> Path:
    """Get the path to a model."""
    return (Path(config.api.data_path) / model.replace('_','/')).with_suffix(".ckpt").absolute()


def encode_result(result: api.ResultRetrievalResponse) -> tuple[bytes, str]:
    """Converts cascade Result response to bytes+mime"""
    obj = decoded_result(result, job=None)  # type: ignore
    if isinstance(obj, bytes):
        return obj, "application/pickle"
    if isinstance(obj, tuple):
        if len(obj) == 2 and isinstance(obj[0], bytes):
            return obj[0], obj[1]
        else:
            raise ValueError("Tuple result must contain exactly two elements: (bytes, mime_type)")

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
            return encoder.encode(obj).to_bytes(), "application/grib"  # type: ignore
        elif isinstance(obj, ekd.FieldList):
            return encoder.encode(obj[0], template=obj[0]).to_bytes(), "application/grib"  # type: ignore

    elif isinstance(obj, (xr.Dataset, xr.DataArray)):
        buf = io.BytesIO()
        obj.to_netcdf(buf, format="NETCDF4")  # type: ignore
        return buf.getvalue(), "application/netcdf"

    elif isinstance(obj, np.ndarray):
        buf = io.BytesIO()
        np.save(buf, obj)
        return buf.getvalue(), "application/numpy"

    return cloudpickle.dumps(obj), "application/clpkl"
