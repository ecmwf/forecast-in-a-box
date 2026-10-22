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
import re
from collections import defaultdict
from typing import TYPE_CHECKING, Any

import earthkit.data as ekd
import numpy as np
from fiab_core.types import UnrestrictedGeoDomainAlias

if TYPE_CHECKING:
    from earthkit.plots import Figure, Subplot  # type: ignore[unresolved-import]

logger = logging.getLogger(__name__)

WIND_SHORTNAMES = ["u", "v", "10u", "10v", "100u", "100v"]

# TODO remove REDUCED_GG_PATTERN, LATLON_METADATA_KEYS, _is_subarea_reduced_gg, _to_latlon_field and _prepare_fields
# once we switch to earthkit-plots 1.0, where a fix is probably available. earthkit-plots<1.0 drops the area from the
# gridspec of reduced Gaussian GRIB fields, so sub-area fields (e.g. limited-area model output) are regridded with the
# global matrix and fail with a dimension mismatch. As a workaround such fields are plotted as scattered lat/lon points.
REDUCED_GG_PATTERN = re.compile(r"^[OoNn]\d+$")

LATLON_METADATA_KEYS = ["shortName", "paramId", "name", "units", "levtype", "level", "step", "number", "date", "time"]


def _configure_schema(style_schema: str) -> None:
    """Configure the earthkit-plots schema from a schema identifier.

    Supports:
    - ``package@path`` -- uses a named schema with a custom style library path
    - Any other string -- passed directly to ``schema.use()``
    """
    # import inside function justified: earthkit.plots is an optional dependency
    from earthkit.plots.schemas import schema  # type: ignore[unresolved-import]

    if "@" in style_schema:
        schema.use(style_schema.split("@")[0])
    else:
        schema.use(style_schema)


def _style_units(fields: ekd.FieldList) -> str | None:
    """Return the units of the style the active earthkit-plots schema selects for *fields*, or None if unknown."""
    # import inside function justified: earthkit.plots is an optional dependency
    from earthkit.plots.sources import get_source  # type: ignore[unresolved-import]
    from earthkit.plots.styles import auto  # type: ignore[unresolved-import]

    try:
        return getattr(auto.guess_style(get_source(fields)), "units", None)
    except Exception as err:
        logger.warning("map_plot: failed to determine style units: %s", err)
        return None


def _quickplot(subplot: "Subplot", fields: ekd.FieldList, **kwargs: Any) -> None:
    """Quickplot *fields*, converting them to the units of the selected style."""
    # earthkit-plots<1.0 picks a style in its preferred units (e.g. celsius) when the schema sets
    # use_preferred_units, but only converts the data when units are passed explicitly
    subplot.quickplot(fields, units=_style_units(fields), **kwargs)


def _plot_fields(subplot: "Subplot", fields: ekd.FieldList, **kwargs: Any) -> None:
    """Plot fields on a subplot, selecting the appropriate method based on field metadata.

    Wind fields (u/v components) are plotted with ``quiver``; all others use ``quickplot``.
    """
    plot_categories: dict[str, dict] = defaultdict(lambda: defaultdict(list))
    for index, field in enumerate(fields):  # type: ignore[reportArgumentType]
        if field.metadata().get("shortName", None) in WIND_SHORTNAMES:
            plot_categories["quiver"][field.metadata().get("levtype", None)].append(field)
            continue
        plot_categories["quickplot"][index].append(field)

    for method, comp in plot_categories.items():
        for _sub_cat, sub_fields in comp.items():
            sub_fieldlist = ekd.FieldList.from_fields(sub_fields)
            if method == "quickplot":
                _quickplot(subplot, sub_fieldlist, **kwargs.get("quickplot", {}))
                continue
            try:
                getattr(subplot, method)(sub_fieldlist, **kwargs.get(method, {}))
            except Exception:
                _quickplot(subplot, sub_fieldlist, **kwargs.get("quickplot", {}))


def _is_subarea_reduced_gg(field: Any) -> bool:
    """Return True if *field* is on a reduced Gaussian grid restricted to a non-global area."""
    try:
        gridspec = field.metadata().geography.gridspec()
    except Exception:
        return False
    if gridspec is None:
        return False
    grid, area = gridspec.get("grid"), gridspec.get("area")
    if not (isinstance(grid, str) and REDUCED_GG_PATTERN.match(grid)) or not area:
        return False
    north, west, south, east = area
    return (north - south) < 170 or (east - west) % 360 < 350


def _to_latlon_field(field: Any) -> ekd.ArrayField:
    """Rewrap *field* as an ArrayField carrying explicit latitudes and longitudes and no grid definition."""
    latlon = field.to_latlon(flatten=True)
    lons = latlon["lon"]
    datetimes = field.datetime()
    metadata = {key: value for key in LATLON_METADATA_KEYS if (value := field.metadata(key, default=None)) is not None}
    metadata.update(
        param=metadata.get("shortName"),
        base_datetime=datetimes["base_time"],
        valid_datetime=datetimes["valid_time"],
        latitudes=latlon["lat"],
        longitudes=np.where(lons > 180, lons - 360, lons),
    )
    return ekd.ArrayField(field.to_numpy(flatten=True), metadata)


def _prepare_fields(fields: ekd.FieldList) -> ekd.FieldList:
    """Rewrap sub-area reduced Gaussian fields as lat/lon fields; other fields are returned unchanged."""
    if not any(_is_subarea_reduced_gg(field) for field in fields):  # type: ignore[reportGeneralTypeIssues]
        return fields
    return ekd.FieldList.from_fields(
        [_to_latlon_field(field) if _is_subarea_reduced_gg(field) else field for field in fields]  # type: ignore[reportGeneralTypeIssues]
    )


def _is_subarea_reduced_gg(field: Any) -> bool:
    """Return True if *field* is on a reduced Gaussian grid restricted to a non-global area."""
    try:
        gridspec = field.metadata().geography.gridspec()
    except Exception:
        return False
    if gridspec is None:
        return False
    grid, area = gridspec.get("grid"), gridspec.get("area")
    if not (isinstance(grid, str) and REDUCED_GG_PATTERN.match(grid)) or not area:
        return False
    north, west, south, east = area
    return (north - south) < 170 or (east - west) % 360 < 350


def _to_latlon_field(field: Any) -> ekd.ArrayField:
    """Rewrap *field* as an ArrayField carrying explicit latitudes and longitudes and no grid definition."""
    latlon = field.to_latlon(flatten=True)
    lons = latlon["lon"]
    datetimes = field.datetime()
    metadata = {key: value for key in LATLON_METADATA_KEYS if (value := field.metadata(key, default=None)) is not None}
    metadata.update(
        param=metadata.get("shortName"),
        base_datetime=datetimes["base_time"],
        valid_datetime=datetimes["valid_time"],
        latitudes=latlon["lat"],
        longitudes=np.where(lons > 180, lons - 360, lons),
    )
    return ekd.ArrayField(field.to_numpy(flatten=True), metadata)


def _prepare_fields(fields: ekd.FieldList) -> ekd.FieldList:
    """Rewrap sub-area reduced Gaussian fields as lat/lon fields; other fields are returned unchanged."""
    if not any(_is_subarea_reduced_gg(field) for field in fields):  # type: ignore[reportGeneralTypeIssues]
        return fields
    return ekd.FieldList.from_fields(
        [_to_latlon_field(field) if _is_subarea_reduced_gg(field) else field for field in fields]  # type: ignore[reportGeneralTypeIssues]
    )


def _export_figure(figure: "Figure", fmt: str = "png", dpi: int = 100) -> bytes:
    """Serialise a Figure to bytes."""
    buf = io.BytesIO()
    figure.save(buf, format=fmt, dpi=dpi)
    return buf.getvalue()


def map_plot(
    fields: ekd.FieldList,
    domain: str | list[int] | list[str] | None = None,
    format: str = "png",
    groupby: str = "none",
    style_schema: str = "default",
) -> bytes:
    """Render a geographic map from *fields* using earthkit-plots.

    Returns image bytes.
    """
    # import inside function justified: earthkit.plots is an optional dependency
    from earthkit.plots import Figure  # type: ignore[unresolved-import]
    from earthkit.plots.components import layouts  # type: ignore[unresolved-import]
    from earthkit.plots.utils import iter_utils  # type: ignore[unresolved-import]

    _configure_schema(style_schema)

    if not isinstance(fields, ekd.FieldList):
        fields = ekd.FieldList.from_fields(fields)
    # TODO remove once we switch to earthkit-plots 1.0, see REDUCED_GG_PATTERN
    fields = _prepare_fields(fields)

    resolved_domain = None if (isinstance(domain, str) and domain in UnrestrictedGeoDomainAlias.items) else domain

    if groupby and groupby != "none":
        unique_values = iter_utils.flatten(arg.metadata(groupby) for arg in fields)
        unique_values = list(dict.fromkeys(unique_values))
        grouped_data = {val: fields.sel(**{groupby: val}) for val in unique_values}
    else:
        grouped_data = {None: fields}

    rows, columns = layouts.rows_cols(len(grouped_data))
    figure = Figure(rows=rows, columns=columns)

    for group_val, group_fields in grouped_data.items():
        logger.debug("map_plot: plotting group %s (%d fields)", group_val, len(group_fields))
        subplot = figure.add_map(domain=resolved_domain)
        _plot_fields(subplot, group_fields, quickplot=dict(interpolate=True))  # type: ignore[reportArgumentType]
        try:
            subplot.title("{variable_name}" + (f" over {domain}" if resolved_domain else "") + " at {time:%H:%M UTC on %-d %B %Y}")
        except Exception as err:
            logger.warning("map_plot: failed to set subplot title: %s", err)

    try:
        figure.borders()
        figure.coastlines()
        figure.gridlines()
        figure.legend()
    except Exception as err:
        logger.warning("map_plot: failed to add map decorations: %s", err)

    return _export_figure(figure, fmt=format)
