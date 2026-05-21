import pathlib

import earthkit.data


def write_zarr(fieldlist: earthkit.data.SimpleFieldList, path: str) -> bytes:
    p = pathlib.Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    fieldlist.to_target("zarr", xarray_to_zarr_kwargs={"store": path, "mode": "w"})
    return path.encode("ascii")


def write_grib(fieldlist: earthkit.data.SimpleFieldList, path: str) -> bytes:
    p = pathlib.Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    formatted_path = path.replace("{", "[").replace("}", "]")
    fieldlist.to_target("file-pattern", formatted_path)
    return path.encode("ascii")
