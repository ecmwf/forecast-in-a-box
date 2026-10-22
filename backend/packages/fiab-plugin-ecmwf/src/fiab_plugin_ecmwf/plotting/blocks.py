# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import logging
from typing import Any

import numpy as np
from cascade.low.func import Either
from earthkit.workflows.fluent import Action, create_task_instance
from earthkit.workflows.metadata import NodeMetadata, Requirements
from earthkit.workflows.nodetree import nodetree_arrays
from fiab_core.fable import (
    ActionLookup,
    BlockConfigurationOption,
    BlockInstanceOutput,
    ConfigurationOptionId,
    ConfigurationOptionRestriction,
    QubedOutput,
    RawOutput,
)
from fiab_core.metkit import MetkitParamResolver
from fiab_core.plugin import Error
from fiab_core.tools.blocks import BlockInstanceRich, Sink
from fiab_core.types import ClosedEnumType, GeoDomainType, ListType, ParameterType, StringType

from ..block_utils import (
    _extract_dataset,
)
from ..constants import (
    DOMAIN,
    ENSEMBLE,
    FORMAT,
    GROUPBY,
    LEVEL,
    PARAM,
    SPLITBY,
    STEP,
    STYLE,
)
from ..qubed_utils import axes, common_dimensions, contains

logger = logging.getLogger(__name__)

GRIB_ALIASES = {
    "shortName": PARAM,
    "paramId": PARAM,
    "stepRange": STEP,
    "level": LEVEL,
}

PLOT_FORMAT_TO_MIME: dict[str, str] = {
    "png": "image/png",
    "pdf": "application/pdf",
    "svg": "image/svg+xml",
}

# NOTE the eckitlib pin is a hotfix due to proj in newer eckits clashing with pyproj, leading to a segfault
PLOT_ENVIRONMENT: list[str] = ["earthkit-plots<1.0.0", "earthkit-regrid<1.0.0", "matplotlib<3.11", "eckitlib<=2.2.0.27"]

DEFAULT_PLOT_STYLE = "ECMWF"

# NOTE the MetNorway package registers its earthkit-plots schema under the name "dccms"
PLOT_STYLE_TO_SCHEMA: dict[str, str] = {
    "ECMWF": "default",
    "MetNorway": "dccms",
}

# NOTE git dependencies cannot be declared as extras of a package published to PyPI, hence listed here
PLOT_STYLE_TO_ENVIRONMENT: dict[str, list[str]] = {
    "ECMWF": [],
    "MetNorway": ["temporary-earthkit-plots-metno-styles"],
}


def _plot_style(block: BlockInstanceRich) -> str:
    """Return the configured plot style, or the default style for blocks saved without one."""
    if STYLE not in block.block.configuration_values:
        return DEFAULT_PLOT_STYLE
    return block.config_as_str(STYLE)


def _coord_value_str(value: Any) -> str:
    return str(value.item()) if isinstance(value, np.generic) else str(value)


def _display_value(dim: str, value: str) -> str:
    """Returns the human readable form of a dimension value, using the shortname for params."""
    return MetkitParamResolver.param_id_to_shortname(int(value)) if dim == PARAM else value


def _set_plot_builder_metadata(action: Action, title: str) -> None:
    """Sets display name and dimension kvs on each plot node, based on its coordinates along the node array dims.

    Dimension kvs hold the raw coordinate values, the display name uses param shortnames.
    """
    for _, narray in nodetree_arrays(action.nodes):
        it = np.nditer(narray, flags=["multi_index", "refs_ok"])  # type: ignore[call-overload]
        for node in it:
            kvs = [
                (str(dim), _coord_value_str(narray.coords[dim].values[idx])) for dim, idx in zip(narray.dims, it.multi_index, strict=True)
            ]
            builder = node[()].metadata.builder  # type: ignore[index]
            builder.display_name = f"{title} ({', '.join(f'{k}={_display_value(k, v)}' for k, v in kvs)})" if kvs else title
            builder.dimension_kvs = kvs


class MapPlotSink(Sink):
    title: str = "Map Plot"
    description: str = "Render a geographic map using earthkit-plots"
    configuration_options: dict[ConfigurationOptionId, BlockConfigurationOption] = {
        PARAM: BlockConfigurationOption(
            title="Parameters",
            description="Parameters to select and plot (e.g. '2t', 'msl')",
            value_type=ListType(ParameterType()),
        ),
        DOMAIN: BlockConfigurationOption(
            title="Domain",
            description="Area to display: auto (fit the data), global, a named region/country (select several to union), or a drawn bounding box",
            value_type=GeoDomainType(),
            default_value="global",
        ),
        FORMAT: BlockConfigurationOption(
            title="Format",
            description="Output image format",
            value_type=ClosedEnumType(["png", "pdf", "svg"]),
            default_value="png",
        ),
        GROUPBY: BlockConfigurationOption(
            title="Group By",
            description="Dimension to create subplots over",
            value_type=ClosedEnumType(["valid_datetime", "step", "number", "none"]),
            default_value="none",
        ),
        SPLITBY: BlockConfigurationOption(
            title="Split By",
            description="Dimensions to separate plots by",
            value_type=ListType(StringType()),
            default_value="step",
        ),
        STYLE: BlockConfigurationOption(
            title="Style",
            description="Colour scheme and styling of the plot",
            value_type=ClosedEnumType(list(PLOT_STYLE_TO_SCHEMA)),
            default_value=DEFAULT_PLOT_STYLE,
        ),
    }
    inputs: list[str] = ["dataset"]

    def validate(
        self, block: BlockInstanceRich, inputs: dict[str, QubedOutput], restrictions: ConfigurationOptionRestriction
    ) -> BlockInstanceOutput:
        input_dataset = _extract_dataset(inputs, "dataset")

        input_axes = axes(input_dataset)
        input_param_values = input_axes.get(PARAM, set())
        if input_param_values:
            restrictions[PARAM] = ListType(ClosedEnumType(sorted(input_param_values), subtype=ParameterType()))

        common = common_dimensions(input_dataset).intersection({PARAM, STEP, ENSEMBLE, LEVEL})
        splitby = [x for x in common if len(input_axes[x]) > 1]
        restrictions[SPLITBY] = ListType(ClosedEnumType(sorted(splitby) + ["none"]))

        params = block.config_as_list(PARAM, str, allow_empty=False)
        splitby_value = block.config_as_list(SPLITBY, str, allow_empty=True)
        fmt = block.config_as_str(FORMAT)

        missing_params = [param for param in params if param not in input_param_values]
        if missing_params:
            raise ValueError(f"params {missing_params} are not in the input parameters: {input_param_values}")

        if "none" in splitby_value and len(splitby_value) != 1:
            raise ValueError("Invalid splitby value: if none is selected, no other dimensions can be present")

        style = _plot_style(block)
        if style not in PLOT_STYLE_TO_SCHEMA:
            raise ValueError(f"Unsupported style: {style}")

        mime_type = PLOT_FORMAT_TO_MIME.get(fmt)
        if mime_type is None:
            raise ValueError(f"Unsupported output format: {fmt}")
        return RawOutput(type_fqn="bytes", mime_type=mime_type)

    def compile(
        self,
        inputs: ActionLookup,
        block: BlockInstanceRich,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        input_task = block.input_ids["dataset"]
        params = block.config_as_list(PARAM, str, allow_empty=False)
        groupby = block.config_as_str(GROUPBY)
        splitby = block.config_as_list(SPLITBY, str, allow_empty=True)
        if "none" in splitby:
            splitby = []
        style = _plot_style(block)

        selected = (
            inputs[input_task]
            .combine_branches(dim=PARAM, force=True)
            .select({PARAM: params if len(params) > 1 else params[0]})
            .flatten(new_dim="temp_dim", keep_dims=splitby, reset_coords=True)
            .concatenate(dim="temp_dim")
        )

        action = selected.map(
            create_task_instance(
                "fiab_plugin_ecmwf.plotting.runtime.map_plot",
                static_input_kw={
                    "domain": block.config_as_geodomain(DOMAIN).with_bbox_earthkitplots().value or None,
                    "format": block.config_as_str(FORMAT),
                    "groupby": None if groupby == "none" else groupby,
                    "style_schema": PLOT_STYLE_TO_SCHEMA[style],
                },
            ),
            node_metadata=NodeMetadata(requirements=Requirements(environment=PLOT_ENVIRONMENT + PLOT_STYLE_TO_ENVIRONMENT[style])),
        )
        _set_plot_builder_metadata(action, self.title)
        return Either.ok(action)

    def intersect(self, other: QubedOutput) -> bool:
        return contains(other, PARAM)
