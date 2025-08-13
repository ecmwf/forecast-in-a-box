# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.


import io
from typing import TYPE_CHECKING, Literal

import earthkit.data as ekd
from earthkit.workflows.decorators import as_payload

if TYPE_CHECKING:
    import numpy as np

OUTPUT_TYPES = ["grib", "netcdf", "numpy"]


@as_payload
def export_fieldlist_as(
    fields: ekd.FieldList, format: Literal["grib", "netcdf", "numpy"] = "grib"
) -> tuple[bytes, str]:
    """Export an earthkit FieldList to a specified format.
    Supported formats are 'grib', 'netcdf', and 'numpy'.

    Parameters:
    ----------
    fields : ekd.FieldList
        The FieldList to export.
    format : str, optional
        The format to export to. Default is 'grib'.

    Returns:
    -------
    tuple[bytes, str]
        A tuple containing the serialized data as bytes and the MIME type.
    """
    written_bytes = b''

    if format == "grib":
        buf = io.BytesIO()
        fields.to_target("file", buf, encoder="grib")
        written_bytes = buf.getvalue()
    elif format == "netcdf":
        buf = io.BytesIO()
        fields.to_target("file", buf, encoder="netcdf", decode_timedelta=False)
        written_bytes = buf.getvalue()
    elif format == "numpy":
        np_obj: np.ndarray = fields.to_numpy()  # type: ignore
        if np_obj is None:
            raise ValueError("Data cannot be converted to numpy.")
        written_bytes = np_obj.tobytes()
    else:
        raise ValueError(f"Unsupported format: {format}. Supported formats are {OUTPUT_TYPES}.")

    return written_bytes, f"application/{format}"
