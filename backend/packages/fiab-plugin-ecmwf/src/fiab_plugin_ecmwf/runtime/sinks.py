def write_zarr(fieldlist, path: str) -> None:
    fieldlist.to_target("zarr", xarray_to_zarr_kwargs={"store": path, "mode": "w"})
