import pathlib

import earthkit.data


def write_zarr(fieldlist: earthkit.data.SimpleFieldList, path: str) -> str:
    fieldlist.to_target("zarr", xarray_to_zarr_kwargs={"store": path, "mode": "w"})
    return path


def write_grib(fieldlist: earthkit.data.SimpleFieldList, path: str) -> str:
    p = pathlib.Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    fieldlist.to_target("file-pattern", path)
    return str(p.parent)
