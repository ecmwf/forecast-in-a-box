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
from collections import defaultdict
from typing import TYPE_CHECKING, Any

import earthkit.data as ekd

if TYPE_CHECKING:
    from earthkit.plots import Figure, Subplot

logger = logging.getLogger(__name__)

WIND_SHORTNAMES = ["u", "v", "10u", "10v", "100u", "100v"]


def _configure_schema(style_schema: str) -> None:
    """Configure the earthkit-plots schema from a schema identifier.

    Supports:
    - ``package@path`` -- uses a named schema with a custom style library path
    - Any other string -- passed directly to ``schema.use()``
    """
    from earthkit.plots.schemas import schema

    if "@" in style_schema:
        schema.use(style_schema.split("@")[0])
    else:
        schema.use(style_schema)


def _plot_fields(subplot: "Subplot", fields: ekd.FieldList) -> None:
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
            try:
                getattr(subplot, method)(ekd.FieldList.from_fields(sub_fields))
            except Exception as err:
                if method == "quickplot":
                    raise err
                subplot.quickplot(ekd.FieldList.from_fields(sub_fields))


def _export_figure(figure: "Figure", fmt: str = "png", dpi: int = 100) -> tuple[bytes, str]:
    """Serialise a Figure to bytes and return ``(data, mime_type)``."""
    buf = io.BytesIO()
    figure.save(buf, format=fmt, dpi=dpi)
    return buf.getvalue(), f"image/{fmt}"


def map_plot(
    fields: ekd.FieldList,
    domain: str = "global",
    format: str = "png",
    groupby: str = "valid_datetime",
    style_schema: str = "default",
) -> tuple[bytes, str]:
    """Render a geographic map from *fields* using earthkit-plots.

    Returns ``(image_bytes, mime_type)``.
    """
    from earthkit.plots import Figure
    from earthkit.plots.components import layouts
    from earthkit.plots.utils import iter_utils

    _configure_schema(style_schema)

    if not isinstance(fields, ekd.FieldList):
        fields = ekd.FieldList.from_fields(fields)

    resolved_domain = None if domain in ("global", "Global", "DataDefined") else domain

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
