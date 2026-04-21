import earthkit.data


def write_zarr(fieldlist: earthkit.data.SimpleFieldList, path: str) -> str:
    fieldlist.to_target("zarr", xarray_to_zarr_kwargs={"store": path, "mode": "w"})
    return path
