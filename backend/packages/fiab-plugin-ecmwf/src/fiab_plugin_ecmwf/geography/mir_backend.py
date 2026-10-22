# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import io
import logging
from typing import Any

import earthkit.data as ekd

from .runtime import GridRuntimeType

LOG = logging.getLogger(__name__)


GridSpec = GridRuntimeType | tuple[int | float, ...] | dict[str, list[float]]


def _is_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _make_mir_grid(grid: GridSpec) -> Any:
    """Build a `mir.Grid` from a grid name or 'west_east/south_north' string, a [west_east, south_north] pair, a single increment
    used for both directions, or a dictionary of `mir.Grid` keyword arguments."""
    # mir is only present at runtime
    import mir  # type: ignore[unresolved-import]

    if isinstance(grid, str):
        return mir.Grid(grid=grid.upper())
    if isinstance(grid, (list, tuple)):
        if len(grid) != 2:
            raise ValueError(f"Expected a grid of two resolutions, not {grid!r}.")
        return mir.Grid(grid=list(grid))
    if isinstance(grid, dict):
        return mir.Grid(**grid)
    if _is_number(grid):
        return mir.Grid(grid=[grid, grid])
    raise ValueError(f"Unsupported grid specification: {grid!r}")


def grid_repr(grid: GridSpec | None) -> str:
    """Return a short representation of the grid for logging."""
    if grid is None:
        return "None"
    if isinstance(grid, str):
        return grid.upper()
    if isinstance(grid, (list, tuple)):
        return str(list(grid)[:5] + ["..."] if len(grid) > 5 else list(grid))
    if isinstance(grid, dict):
        return str({key: f"list of len {len(value)}" for key, value in grid.items()})
    return repr(grid)


def mir_regrid(
    fields: ekd.FieldList,
    grid: GridSpec | None = None,
    area: str | list[float] | None = None,
    packing: str = "ccsds",
    accuracy: int = 16,
) -> ekd.FieldList:
    """Regrid fields to a grid and cut them out to an area with MIR, returning GRIB2 fields of the given packing and accuracy.

    The grid is as for `_make_mir_grid`, and the area is [north, west, south, east]. Without a grid the fields keep their grid and
    are only cut out, and without a grid and an area the fields are returned as they are.
    """
    if len(fields) == 0:
        return fields

    if grid is None and not area:
        LOG.info("No grid and no area given; returning the fields unchanged.")
        return fields

    LOG.info(
        f"Starting MIR regridding of {len(fields)} fields to grid: {grid_repr(grid)!r}, area: {area!r}, "
        f"packing: {packing!r}, accuracy: {accuracy!r}."
    )

    # mir is only present at runtime
    import mir  # type: ignore[unresolved-import]

    job_args: dict[str, Any] = {"edition": 2, "packing": packing, "accuracy": accuracy}
    if grid is not None:
        job_args["grid"] = _make_mir_grid(grid).spec
    if area:
        job_args["area"] = area
    job = mir.Job(**job_args)

    out_fields = []
    for field in fields:
        input_buffer = io.BytesIO()
        field.to_target("file", input_buffer)
        input_buffer.seek(0)

        output_buffer = io.BytesIO()
        job.execute(mir.PyGribInput(input_buffer), mir.PyGribOutput(output_buffer))
        out_fields.append(ekd.from_source("memory", output_buffer.getvalue())[0])  # type: ignore[reportAttributeAccessIssue]

        input_buffer.close()
        output_buffer.close()

    return ekd.FieldList.from_fields(out_fields)
