import fcntl
import pathlib

import earthkit.data


def write_zarr(fieldlist: earthkit.data.SimpleFieldList, path: str) -> str:
    fieldlist.to_target("zarr", xarray_to_zarr_kwargs={"store": path, "mode": "w"})
    return path


def write_grib(fieldlist: earthkit.data.SimpleFieldList, path: str) -> str:
    # Cascade fans out, so multiple workers can call this concurrently.
    p = pathlib.Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "ab") as fh:
        # Acquire an exclusive lock
        fcntl.flock(fh, fcntl.LOCK_EX)
        try:
            # Let earthkit handle the actual data I/O natively
            fieldlist.to_target("file", str(p), append=True)
        finally:
            # Explicitly release the lock
            fcntl.flock(fh, fcntl.LOCK_UN)
    return str(p)
