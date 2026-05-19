# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import logging

import numpy as np
from cascade.low.func import Either
from earthkit.workflows.fluent import Action, Payload, from_source
from fiab_core.fable import (
    ActionLookup,
    BlockConfigurationOption,
    BlockInstanceId,
    BlockInstanceOutput,
    ConfigurationOptionId,
    NoOutput,
    QubedOutput,
    RawOutput,
)
from fiab_core.plugin import Error
from fiab_core.tools.blocks import BlockInstanceRich as BlockInstance
from fiab_core.tools.blocks import Product, Sink, Source
from qubed import Qube

from .qubed_utils import axes, contains, coxpand, dimensions

SOURCE = ConfigurationOptionId("source")
DATE = ConfigurationOptionId("date")
EXPVER = ConfigurationOptionId("expver")
PARAM_DIM = ConfigurationOptionId("param")
STATISTIC = ConfigurationOptionId("statistic")
PATH = ConfigurationOptionId("path")
DOMAIN = ConfigurationOptionId("domain")
FORMAT = ConfigurationOptionId("format")

IFS_REQUEST = {
    "class": "od",
    "stream": "enfo",
    "param": [
        "10u",
        "10v",
        "2d",
        "2t",
        "msl",
        "skt",
        "sp",
        "stl1",
        "stl2",
        "tcw",
        "msl",
    ],
    "levtype": "sfc",
    "step": list(range(0, 61, 6)),
    "type": "pf",
    "number": list(range(1, 6)),
}
ENSEMBLE_DIM = "number"
STEP_DIM = "step"

logger = logging.getLogger(__name__)

PLOT_FORMAT_TO_MIME: dict[str, str] = {
    "png": "image/png",
    "pdf": "application/pdf",
    "svg": "image/svg+xml",
}


class EkdSource(Source):
    title: str = "Earthkit Data Source"
    description: str = "Fetch data from mars or ecmwf open data"
    configuration_options: dict[ConfigurationOptionId, BlockConfigurationOption] = {
        SOURCE: BlockConfigurationOption(
            title="Source",
            description="Top level source for earthkit data",
            value_type="enumClosed['mars', 'ecmwf-open-data']",
        ),
        DATE: BlockConfigurationOption(
            title="Date",
            description="The date dimension of the data",
            value_type="date",
        ),
        EXPVER: BlockConfigurationOption(
            title="Expver",
            description="The expver value of the forecast",
            value_type="str",
        ),
        PARAM_DIM: BlockConfigurationOption(
            title="Parameters",
            description="Parameters to select and plot (e.g. '2t', 'msl')",
            value_type="list[str]",
        ),
        ConfigurationOptionId("step"): BlockConfigurationOption(
            title="Steps",
            description="Forecast steps to select (e.g. '0,6,12,...')",
            value_type="list[int]",
        ),
        ConfigurationOptionId("number"): BlockConfigurationOption(
            title="Ensemble Members",
            description="Ensemble members to select (e.g. '1,2,3,...')",
            value_type="list[int]",
        ),
    }
    inputs: list[str] = []

    def validate(self, block: BlockInstance, inputs: dict[str, QubedOutput]) -> Either[BlockInstanceOutput, Error]:  # type:ignore[invalid-argument] # semigroup
        param = block.config_as_list(PARAM_DIM, str, allow_empty=False)
        step = block.config_as_list("step", int)
        number = block.config_as_list("number", int)

        output = QubedOutput(
            dataqube=Qube.from_datacube(
                {
                    PARAM_DIM: param,
                    ENSEMBLE_DIM: number,
                    STEP_DIM: step,
                }
            )
        )
        return Either.ok(output)

    def compile(
        self,
        inputs: ActionLookup,
        block_id: BlockInstanceId,
        block: BlockInstance,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        param = block.config_as_list(PARAM_DIM, str, allow_empty=False)
        step = block.config_as_list("step", int)
        number = block.config_as_list("number", int)

        action = (
            from_source(
                np.asarray(
                    [
                        Payload(
                            "fiab_plugin_ecmwf.runtime.source.earthkit_source",
                            [block.config_as_str(SOURCE)],
                            {
                                "request": {
                                    **IFS_REQUEST,
                                    "date": block.config_as_date(DATE).isoformat(),
                                    "expver": block.config_as_str(EXPVER),
                                    PARAM_DIM: p,
                                    ENSEMBLE_DIM: number,
                                    STEP_DIM: step,
                                }
                            },
                        )
                        for p in param
                    ]
                ),
                coords={PARAM_DIM: param},
            )
            .expand(
                (ENSEMBLE_DIM, number),
                "number",
                dim_size=len(number),
                backend_kwargs={"method": "isel"},
            )
            .expand(
                (STEP_DIM, step),
                "step",
                dim_size=len(step),
                backend_kwargs={"method": "isel"},
            )
        )
        return Either.ok(action)


class EnsembleStatistics(Product):
    title: str = "Ensemble Statistics"
    description: str = "Computes ensemble mean or standard deviation"
    configuration_options: dict[ConfigurationOptionId, BlockConfigurationOption] = {
        PARAM_DIM: BlockConfigurationOption(title="Parameter", description="Parameter name like '2t'", value_type="str"),
        STATISTIC: BlockConfigurationOption(
            title="Statistic",
            description="Statistic to compute over the ensemble",
            value_type="enumClosed['mean', 'std']",
        ),
    }
    inputs: list[str] = ["dataset"]

    def validate(self, block: BlockInstance, inputs: dict[str, QubedOutput]) -> Either[BlockInstanceOutput, Error]:  # type:ignore[invalid-argument] # semigroup
        input_dataset = inputs.get("dataset")
        if not isinstance(input_dataset, QubedOutput):
            actual_type = type(input_dataset).__name__ if input_dataset is not None else "None"
            return Either.error(f"Unsupported input type for 'dataset': expected QubedOutput, got {actual_type}")

        param = block.config_as_str(PARAM_DIM)
        if not contains(input_dataset, {PARAM_DIM: param}):
            return Either.error(f"param {param} is not in the input parameters: {axes(input_dataset).get(PARAM_DIM, [])}")

        output = coxpand(input_dataset, [PARAM_DIM, ENSEMBLE_DIM], {PARAM_DIM: [param]})
        return Either.ok(output)

    def compile(
        self,
        inputs: ActionLookup,
        block_id: BlockInstanceId,
        block: BlockInstance,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        input_task = block.input_ids["dataset"]
        input_task_action = inputs[input_task]
        stat = block.config_as_str(STATISTIC)
        param = input_task_action.select({PARAM_DIM: block.config_as_str(PARAM_DIM)})
        if stat == "mean":
            action = param.mean(dim=ENSEMBLE_DIM)
        elif stat == "std":
            action = param.std(dim=ENSEMBLE_DIM)
        else:
            return Either.error(f"Unsupported statistic '{stat}'")
        return Either.ok(action)

    def intersect(self, other: QubedOutput) -> bool:
        return contains(other, ENSEMBLE_DIM) and contains(other, PARAM_DIM)


class TemporalStatistics(Product):
    title: str = "Temporal Statistics"
    description: str = "Computes temporal statistics"
    configuration_options: dict[ConfigurationOptionId, BlockConfigurationOption] = {
        PARAM_DIM: BlockConfigurationOption(title=PARAM_DIM, description="Param name like '2t'", value_type="str"),
        STATISTIC: BlockConfigurationOption(
            title="Statistic",
            description="Statistic to compute over steps",
            value_type="enumClosed['mean', 'std', 'min', 'max']",
        ),
    }
    inputs: list[str] = ["dataset"]

    def validate(self, block: BlockInstance, inputs: dict[str, QubedOutput]) -> Either[BlockInstanceOutput, Error]:  # type:ignore[invalid-argument] # semigroup
        input_dataset = inputs.get("dataset")
        if not isinstance(input_dataset, QubedOutput):
            actual_type = type(input_dataset).__name__ if input_dataset is not None else "None"
            return Either.error(f"Unsupported input type for 'dataset': expected QubedOutput, got {actual_type}")

        param = block.config_as_str(PARAM_DIM)
        if not contains(input_dataset, {PARAM_DIM: param}):
            return Either.error(f"param {param} is not in the input parameters: {axes(input_dataset).get(PARAM_DIM, [])}")
        output = coxpand(input_dataset, [PARAM_DIM, STEP_DIM], {PARAM_DIM: [param]})
        return Either.ok(output)

    def compile(
        self,
        inputs: ActionLookup,
        block_id: BlockInstanceId,
        block: BlockInstance,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        input_task = block.input_ids["dataset"]
        input_task_action = inputs[input_task]
        stat = block.config_as_str(STATISTIC)
        param = input_task_action.select({PARAM_DIM: block.config_as_str(PARAM_DIM)})
        if stat == "mean":
            action = param.mean(dim=STEP_DIM)
        elif stat == "std":
            action = param.std(dim=STEP_DIM)
        elif stat == "min":
            action = param.min(dim=STEP_DIM)
        elif stat == "max":
            action = param.max(dim=STEP_DIM)
        else:
            return Either.error(f"Unsupported temporal statistic: {stat}")
        return Either.ok(action)

    def intersect(self, other: QubedOutput) -> bool:
        return contains(other, STEP_DIM) and contains(other, PARAM_DIM)


class ZarrSink(Sink):
    title: str = "Zarr Sink"
    description: str = "Write dataset to a zarr on the local filesystem"
    configuration_options: dict[ConfigurationOptionId, BlockConfigurationOption] = {
        PATH: BlockConfigurationOption(
            title="Zarr Path",
            description="Filesystem path where the zarr should be written",
            value_type="str",
        )
    }
    inputs: list[str] = ["dataset"]

    def validate(self, block: BlockInstance, inputs: dict[str, QubedOutput]) -> Either[BlockInstanceOutput, Error]:  # type:ignore[invalid-argument] # semigroup
        return Either.ok(NoOutput())

    def compile(
        self,
        inputs: ActionLookup,
        block_id: BlockInstanceId,
        block: BlockInstance,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        input_task = block.input_ids["dataset"]

        action = inputs[input_task].map(
            Payload(
                "fiab_plugin_ecmwf.runtime.sinks.write_zarr",
                kwargs={"path": block.config_as_str(PATH)},
                metadata={"environment": ["zarr"]},
            )
        )
        return Either.ok(action)

    def intersect(self, other: QubedOutput) -> bool:
        return bool(dimensions(other))


class MapPlotSink(Sink):
    title: str = "Map Plot"
    description: str = "Render a geographic map using earthkit-plots"
    configuration_options: dict[ConfigurationOptionId, BlockConfigurationOption] = {
        PARAM_DIM: BlockConfigurationOption(
            title="Parameters",
            description="Parameters to select and plot (e.g. '2t', 'msl')",
            value_type="list[str]",
        ),
        DOMAIN: BlockConfigurationOption(
            title="Domain",
            description="Geographic domain: global, europe, or a named region",
            value_type="str",
        ),
        FORMAT: BlockConfigurationOption(
            title="Format",
            description="Output image format",
            value_type="enumClosed['png', 'pdf', 'svg']",
        ),
        # Disabled for now
        # "groupby": BlockConfigurationOption(
        #     title="Group By",
        #     description="Dimension to create subplots over",
        #     value_type="enum['valid_datetime', 'step', 'number', 'none']",
        # ),
        # "style_schema": BlockConfigurationOption(
        #     title="Style Schema",
        #     description="earthkit-plots schema identifier",
        #     value_type="str",
        # ),
    }
    inputs: list[str] = ["dataset"]

    def validate(self, block: BlockInstance, inputs: dict[str, BlockInstanceOutput]) -> Either[BlockInstanceOutput, Error]:  # type:ignore[invalid-argument] # semigroup
        input_dataset = inputs.get("dataset")
        if not isinstance(input_dataset, QubedOutput):
            actual_type = type(input_dataset).__name__ if input_dataset is not None else "None"
            return Either.error(f"Unsupported input type for 'dataset': expected QubedOutput, got {actual_type}")

        params = block.config_as_list(PARAM_DIM, str, allow_empty=False)
        missing = [p for p in params if not contains(input_dataset, {PARAM_DIM: p})]
        if missing:
            return Either.error(f"params {missing} are not in the input parameters: {axes(input_dataset).get(PARAM_DIM, [])}")

        # Disabled for now
        # groupby_value = block.configuration_values["groupby"]
        # if groupby_value not in ("valid_datetime", "step", "number", "none"):
        #     return Either.error(
        #         f"Invalid groupby value: {groupby_value}, must be one of {set(['valid_datetime', 'step', 'number', 'none']).intersection(dimensions(input_dataset))}"
        #     )
        # if groupby_value != "none" and groupby_value not in dimensions(input_dataset):
        #     return Either.error(
        #         f"Invalid groupby value: {groupby_value}, must be one of {set(['valid_datetime', 'step', 'number', 'none']).intersection(dimensions(input_dataset))}"
        #     )

        fmt = block.config_as_str(FORMAT)
        mime_type = PLOT_FORMAT_TO_MIME.get(fmt)
        if mime_type is None:
            return Either.error(f"Unsupported output format: {fmt}")
        return Either.ok(RawOutput(type_fqn="bytes", mime_type=mime_type))

    def compile(
        self,
        inputs: ActionLookup,
        block_id: BlockInstanceId,
        block: BlockInstance,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        input_task = block.input_ids["dataset"]
        params = block.config_as_list(PARAM_DIM, str, allow_empty=False)
        selected = inputs[input_task].select({PARAM_DIM: params if len(params) > 1 else params[0]})

        # Disabled for now
        # groupby = block.configuration_values["groupby"] or "valid_datetime"

        # if groupby != "none":
        #     selected = selected.concatenate(groupby)

        action = selected.map(
            Payload(
                "fiab_plugin_ecmwf.runtime.plots.map_plot",
                kwargs={
                    "domain": block.config_as_str(DOMAIN) or None,
                    "format": block.config_as_str(FORMAT),
                    # "groupby": block.configuration_values["groupby"] or "valid_datetime",
                    # "style_schema": block.configuration_values["style_schema"] or "inbuilt://fiab",
                },
                metadata={"environment": ["earthkit-plots<1.0.0", "earthkit-regrid<1.0.0"]},
            )
        )
        return Either.ok(action)

    def intersect(self, other: QubedOutput) -> bool:
        return contains(other, PARAM_DIM)
