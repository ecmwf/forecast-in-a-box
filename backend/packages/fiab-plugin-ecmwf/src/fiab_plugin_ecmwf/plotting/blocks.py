# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import logging

from cascade.low.func import Either
from earthkit.workflows.fluent import Action, Payload
from fiab_core.fable import (
    ActionLookup,
    BlockConfigurationOption,
    BlockInstanceOutput,
    ConfigurationOptionId,
    ConfigurationOptionRestriction,
    QubedOutput,
    RawOutput,
)
from fiab_core.plugin import Error
from fiab_core.tools.blocks import BlockInstanceRich, Sink
from fiab_core.types import ClosedEnumType, GeoDomainType, ListType, ParameterType, StringType

from ..block_utils import (
    _extract_dataset,
    _param_id_to_param_key,
    _param_key_to_param_id,
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
        # ConfigurationOptionId("style_schema"): BlockConfigurationOption(
        #     title="Style Schema",
        #     description="earthkit-plots schema identifier",
        #     value_type=StringType(),
        # ),
    }
    inputs: list[str] = ["dataset"]

    def validate(
        self, block: BlockInstanceRich, inputs: dict[str, QubedOutput], restrictions: ConfigurationOptionRestriction
    ) -> BlockInstanceOutput:
        input_dataset = _extract_dataset(inputs, "dataset")

        input_axes = axes(input_dataset)
        input_param_values = input_axes.get(PARAM, set())
        param_values = [_param_id_to_param_key(x) for x in input_param_values]
        if param_values:
            restrictions[PARAM] = ListType(ClosedEnumType(sorted(param_values), subtype=ParameterType()))

        common = common_dimensions(input_dataset).intersection({PARAM, STEP, ENSEMBLE, LEVEL})
        splitby = [x for x in common if len(input_axes[x]) > 1]
        restrictions[SPLITBY] = ListType(ClosedEnumType(sorted(splitby) + ["none"]))

        params = block.config_as_list(PARAM, str, allow_empty=False)
        splitby_value = block.config_as_list(SPLITBY, str, allow_empty=True)
        fmt = block.config_as_str(FORMAT)

        missing_params = [param for param in params if param not in param_values]
        if missing_params:
            raise ValueError(f"params {missing_params} are not in the input parameters: {param_values}")

        if "none" in splitby_value and len(splitby_value) != 1:
            raise ValueError("Invalid splitby value: if none is selected, no other dimensions can be present")

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
        params = [_param_key_to_param_id(x) for x in block.config_as_list(PARAM, str, allow_empty=False)]
        groupby = block.config_as_str(GROUPBY)
        splitby = block.config_as_list(SPLITBY, str, allow_empty=True)
        if "none" in splitby:
            splitby = []

        selected = (
            inputs[input_task]
            .combine_branches(dim=PARAM, force=True)
            .select({PARAM: params if len(params) > 1 else params[0]})
            .flatten(new_dim="temp_dim", keep_dims=splitby, reset_coords=True)
            .concatenate(dim="temp_dim")
        )

        action = selected.map(
            Payload(
                "fiab_plugin_ecmwf.runtime.plots.map_plot",
                kwargs={
                    "domain": block.config_as_geodomain(DOMAIN).with_bbox_earthkitplots().value or None,
                    "format": block.config_as_str(FORMAT),
                    "groupby": None if groupby == "none" else groupby,
                    # "style_schema": block.config_as_str("style_schema") or "inbuilt://fiab",
                },
                metadata={"environment": ["earthkit-plots<1.0.0", "earthkit-regrid<1.0.0", "matplotlib<3.11"]},
            )
        )
        return Either.ok(action)

    def intersect(self, other: QubedOutput) -> bool:
        return contains(other, PARAM)
