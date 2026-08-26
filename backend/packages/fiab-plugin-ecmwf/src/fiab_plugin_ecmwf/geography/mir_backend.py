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

import earthkit.data as ekd
import numpy as np

LOG = logging.getLogger(__name__)


GridSpec = str | list[float] | tuple[float, ...] | dict[str, list[float]]

# GRIB keys copied from each source field onto the target-grid template
# when using the (fast) array-based regridding path. Order matters

TEMPLATE_OVERRIDE_KEYS: tuple[str, ...] = (
    "dataDate",
    "dataTime",
    "stepType",
    "stepRange",
    "typeOfLevel",
    "level",
    "paramId",
)


def normalise_grid(grid: GridSpec | None) -> str | None:
    """Normalise the grid specification to a string format.

    Parameters
    ----------
    grid : GridSpec | None
        The grid specification, which can be a string, list, tuple, or dict.

    Returns
    -------
    str | None
        The normalised grid specification as a string.
    """
    if grid is None:
        return grid
    if isinstance(grid, (list, tuple)):
        return "/".join(map(str, iter(grid)))
    elif isinstance(grid, (int, float)):
        return f"{grid}/{grid}"
    elif isinstance(grid, dict):
        return "/".join(f"{k}={v}" for k, v in grid.items())
    else:
        return str(grid).upper()


def _make_job(grid: str | None, area: str | list[float] | None, packing: str, accuracy: int) -> "mir.Job":
    import mir

    job_args = {}
    if grid:
        job_args["grid"] = grid
    if area:
        job_args["area"] = area

    return mir.Job(**job_args, edition=2, packing=packing, accuracy=accuracy, truncation="auto")  # type: ignore[reportAttributeAccessIssue]


def _mir_regrid_grib(
    fields: ekd.FieldList,
    grid: str | None,
    area: str | list[float] | None,
    packing: str,
    accuracy: int,
) -> ekd.FieldList:
    """Regrid via a full GRIB round-trip (slow, but preserves all metadata)."""
    job = _make_job(grid, area, packing, accuracy)
    input_buffer = io.BytesIO()
    output_buffer = io.BytesIO()
    fields.to_target("file", input_buffer)

    input_buffer.seek(0)
    job.execute(input_buffer, output_buffer)
    return ekd.from_source("memory", output_buffer.getvalue())  # type: ignore[reportAttributeAccessIssue]


def _resolve_input_gridspec(field: ekd.Field) -> dict | None:
    """Determine a MIR-compatible gridspec for a field's values.

    Returns ``None`` if the field has no gridspec (e.g. spectral fields),
    in which case it cannot go through the array interface.

    The gridspec derived from GRIB metadata contains an ``area`` rounded to
    6 decimals; this rounding makes MIR compute a point count that differs
    from the values array length (``RawInput: values size equals iterator
    count`` assertion or Bus error). For reduced Gaussian grids the area is
    always redundant (they are inherently global), so it is unconditionally
    stripped. For other grids, it is dropped when the ecCodes computed key
    ``global`` is true.
    """
    gridspec = field.metadata().gridspec  # type: ignore[reportOptionalMemberAccess]
    if gridspec is None:
        return None
    gridspec = dict(gridspec)

    # Reduced Gaussian grids (O, N, F prefixed) are always global; the area
    # key from GRIB metadata is rounded and causes MIR to miscount points.
    grid_name = str(gridspec.get("grid", ""))
    is_reduced_gg = grid_name and grid_name[0] in ("O", "N", "F") and grid_name[1:].isdigit()

    if is_reduced_gg or int(field.metadata("global", default=0)) == 1:
        gridspec.pop("area", None)
    return gridspec


def _mir_regrid_array(
    fields: ekd.FieldList,
    grid: str | None,
    area: str | list[float] | None,
    packing: str,
    accuracy: int,
) -> ekd.FieldList:
    """Regrid via MIR's array interface (fast).

    Field values are passed to MIR as numpy arrays, skipping the GRIB
    encode/decode round-trip of the (large) input-resolution messages.
    Output metadata is built from a target-grid GRIB template (obtained by
    regridding the first field through the GRIB path), overriding the
    per-field identity keys (``TEMPLATE_OVERRIDE_KEYS``).
    """
    import mir

    # Partition: fields without a gridspec (e.g. spectral) cannot use the
    # array interface and go through the GRIB round-trip instead.
    gridspecs = [_resolve_input_gridspec(f) for f in fields]
    grib_only = [i for i, gs in enumerate(gridspecs) if gs is None]
    grib_results = []

    if len(grib_only) == len(fields):
        return _mir_regrid_grib(fields, grid, area, packing, accuracy)

    if grib_only:
        LOG.info(f"{len(grib_only)} of {len(fields)} fields have no gridspec (e.g. spectral); regridding them via the GRIB round-trip.")
        grib_results = _mir_regrid_grib(
            ekd.FieldList.from_fields([fields[i] for i in grib_only]),
            grid,
            area,
            packing,
            accuracy,
        )

    # Target-grid template metadata from the first array-able field (one small
    # GRIB round-trip).
    # NOTE: this must run before any mir.ArrayInput is created: current mir-python
    # segfaults if an ArrayInput is constructed before MIR has executed once.
    first = next(i for i, gs in enumerate(gridspecs) if gs is not None)
    template = _mir_regrid_grib(fields[first : first + 1], grid, area, packing, accuracy)[0]  # type: ignore[reportArgumentType]
    template_md = template.metadata()

    job = _make_job(grid, area, packing, accuracy)
    output = mir.ArrayOutput()  # type: ignore[reportAttributeAccessIssue]

    grib_iter = iter(grib_results)
    out_fields = []
    in_fields = fields.to_numpy()

    for i, (field, input_gridspec) in enumerate(zip(fields, gridspecs)):  # type: ignore[reportArgumentType]
        if input_gridspec is None:
            out_fields.append(next(grib_iter))
            continue

        values = np.ascontiguousarray(in_fields[i], dtype=np.float64)
        job.execute(mir.ArrayInput(values, input_gridspec), output)  # type: ignore[reportAttributeAccessIssue]

        overrides = {k: field.metadata(k, default=None) for k in TEMPLATE_OVERRIDE_KEYS}
        overrides = {k: v for k, v in overrides.items() if v is not None}
        out_fields.append(ekd.ArrayField(output.values(), template_md.override(overrides)))

    return ekd.FieldList.from_fields(out_fields)


def mir_regrid(
    fields: ekd.FieldList,
    grid: GridSpec | None = None,
    area: str | list[float] | None = None,
    packing: str = "ccsds",
    accuracy: int = 16,
    method: str = "grib",
) -> ekd.FieldList:
    """Regrid fields using the MIR library.

    Parameters
    ----------
    fields : ekd.FieldList
        The input fields to regrid.
    grid : GridSpec
        The target grid specification.
    area : str or list of float or None, optional
        The target area specification.
    packing : str, optional
        GRIB packing type of the output.
    accuracy : int, optional
        GRIB bits per value of the output.
    method : str, optional
        ``"grib"`` (default) round-trips everything through GRIB,
        preserving all metadata keys. ``"array"`` passes field values
        to MIR as numpy arrays, avoiding the GRIB round-trip of the
        input-resolution messages (faster when fields are already
        numpy-backed, e.g. ``ekd.ArrayField``); output metadata is
        rebuilt from a target-grid template.

    Returns
    -------
    ekd.FieldList
        The regridded fields.
    """
    if len(fields) == 0:
        return fields

    normalised_grid = normalise_grid(grid)

    LOG.info(
        f"Starting MIR regridding of {len(fields)} fields to grid: {normalised_grid!r}, area: {area!r}, "
        f"packing: {packing!r}, accuracy: {accuracy!r}, method: {method!r}."
    )

    if method == "array":
        return _mir_regrid_array(fields, normalised_grid, area, packing, accuracy)

    return _mir_regrid_grib(fields, normalised_grid, area, packing, accuracy)
