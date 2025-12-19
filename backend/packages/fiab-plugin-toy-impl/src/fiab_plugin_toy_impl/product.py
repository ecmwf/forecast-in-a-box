import xarray as xr


def select(dataset: xr.Dataset, variable: str) -> xr.DataArray:
    if variable not in dataset:
        available = ",".join(str(e) for e in dataset.variables.keys())
        raise ValueError(f"{variable=} not found in dataset ({available=})")
    return dataset[variable]


def mean(array: xr.DataArray) -> xr.Dataset:
    return xr.Dataset({"2t": array.mean()})
