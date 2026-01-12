# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import xarray as xr


def select(dataset: xr.Dataset, variable: str) -> xr.DataArray:
    if variable not in dataset:
        available = ",".join(str(e) for e in dataset.variables.keys())
        raise ValueError(f"{variable=} not found in dataset ({available=})")
    return dataset[variable]


def mean(array: xr.DataArray) -> xr.Dataset:
    return xr.Dataset({"2t": array.mean()})
