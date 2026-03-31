# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import logging
from typing import TypeVar

import numpy as np
from cascade.low.func import Either
from earthkit.workflows.fluent import Action, Payload, from_source
from fiab_core.fable import (
    ActionLookup,
    BlockConfigurationOption,
    BlockInstance,
    BlockInstanceId,
    BlockInstanceOutput,
    NoOutput,
)
from fiab_core.plugin import Error
from fiab_core.tools.blocks import Product, Sink, Source, Transform

from .metadata import QubedInstanceOutput

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
PARAM_DIM = "param"
ENSEMBLE_DIM = "number"
STEP_DIM = "step"

logger = logging.getLogger(__name__)

T = TypeVar("T")


def _get_item_list(raw: str, item_type: type[T], *, allow_empty: bool = True) -> Either[list[T], Error]:  # type:ignore[invalid-argument] # semigroup
    split = raw.split(",")
    if not raw:
        return Either.ok([]) if allow_empty else Either.error(f"Empty list of {item_type.__name__}")
    try:
        return Either.ok(list(map(item_type, split)))
    except ValueError:
        return Either.error(f"Invalid list of {item_type.__name__}: '{raw}'")


class EkdSource(Source):
    title: str = "Earthkit Data Source"
    description: str = "Fetch data from mars or ecmwf open data"
    configuration_options: dict[str, BlockConfigurationOption] = {
        "source": BlockConfigurationOption(
            title="Source",
            description="Top level source for earthkit data",
            value_type="enum['mars', 'ecmwf-open-data']",
        ),
        "date": BlockConfigurationOption(
            title="Date",
            description="The date dimension of the data",
            value_type="date-iso8601",
        ),
        "expver": BlockConfigurationOption(
            title="Expver",
            description="The expver value of the forecast",
            value_type="str",
        ),
        "param": BlockConfigurationOption(
            title="Parameters",
            description="Parameters to select and plot (e.g. '2t', 'msl')",
            value_type="list[str]",
        ),
        "step": BlockConfigurationOption(
            title="Steps",
            description="Forecast steps to select (e.g. '0,6,12,...')",
            value_type="list[int]",
        ),
        "number": BlockConfigurationOption(
            title="Ensemble Members",
            description="Ensemble members to select (e.g. '1,2,3,...')",
            value_type="list[int]",
        ),
    }
    inputs: list[str] = []

    def validate(self, block: BlockInstance, inputs: dict[str, BlockInstanceOutput]) -> Either[QubedInstanceOutput, Error]:  # type:ignore[invalid-argument] # semigroup
        param = _get_item_list(block.configuration_values.get("param") or IFS_REQUEST["param"], str)
        step = _get_item_list(block.configuration_values.get("step") or IFS_REQUEST["step"], int)
        number = _get_item_list(block.configuration_values.get("number") or IFS_REQUEST["number"], int)

        if any(map(lambda x: x.e is not None, [param, step, number])):
            return Either.error(f"Invalid configuration: {param.e}, {step.e}, {number.e}")

        output = QubedInstanceOutput(
            dataqube={
                PARAM_DIM: param.get_or_raise(),
                ENSEMBLE_DIM: number.get_or_raise(),
                STEP_DIM: step.get_or_raise(),
            }
        )
        return Either.ok(output)

    def compile(
        self,
        inputs: ActionLookup,
        block_id: BlockInstanceId,
        block: BlockInstance,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        param = _get_item_list(block.configuration_values.get("param") or IFS_REQUEST["param"], str).get_or_raise()
        step = _get_item_list(block.configuration_values.get("step") or IFS_REQUEST["step"], int).get_or_raise()
        number = _get_item_list(block.configuration_values.get("number") or IFS_REQUEST["number"], int).get_or_raise()

        action = (
            from_source(
                np.asarray(
                    [
                        Payload(
                            "fiab_plugin_ecmwf.runtime.source.earthkit_source",
                            [block.configuration_values["source"]],
                            {
                                "request": {
                                    **IFS_REQUEST,
                                    "date": block.configuration_values["date"],
                                    "expver": block.configuration_values["expver"],
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
    configuration_options: dict[str, BlockConfigurationOption] = {
        PARAM_DIM: BlockConfigurationOption(title="Parameter", description="Parameter name like '2t'", value_type="str"),
        "statistic": BlockConfigurationOption(
            title="Statistic",
            description="Statistic to compute over the ensemble",
            value_type="enum['mean', 'std']",
        ),
    }
    inputs: list[str] = ["dataset"]

    def validate(self, block: BlockInstance, inputs: dict[str, BlockInstanceOutput]) -> Either[QubedInstanceOutput, Error]:  # type:ignore[invalid-argument] # semigroup
        input_dataset = inputs.get("dataset")
        if not isinstance(input_dataset, QubedInstanceOutput):
            actual_type = type(input_dataset).__name__ if input_dataset is not None else "None"
            return Either.error(f"Unsupported input type for 'dataset': expected QubedInstanceOutput, got {actual_type}")

        param = block.configuration_values[PARAM_DIM]
        if {PARAM_DIM: param} not in input_dataset:
            return Either.error(f"param {param} is not in the input parameters: {input_dataset.axes().get(PARAM_DIM, [])}")

        output = input_dataset.collapse([PARAM_DIM, ENSEMBLE_DIM]).expand({PARAM_DIM: [param]})
        return Either.ok(output)

    def compile(
        self,
        inputs: ActionLookup,
        block_id: BlockInstanceId,
        block: BlockInstance,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        input_task = block.input_ids["dataset"]
        input_task_action = inputs[input_task]
        stat = block.configuration_values["statistic"]
        param = input_task_action.select({PARAM_DIM: block.configuration_values[PARAM_DIM]})
        if stat == "mean":
            action = param.mean(dim=ENSEMBLE_DIM)
        elif stat == "std":
            action = param.std(dim=ENSEMBLE_DIM)
        else:
            return Either.error(f"Unsupported statistic '{stat}'")
        return Either.ok(action)

    def intersect(self, input: BlockInstanceOutput) -> bool:
        if not isinstance(input, QubedInstanceOutput):
            return False
        dims = input.dimensions()
        return ENSEMBLE_DIM in dims and PARAM_DIM in dims


class TemporalStatistics(Product):
    title: str = "Temporal Statistics"
    description: str = "Computes temporal statistics"
    configuration_options: dict[str, BlockConfigurationOption] = {
        PARAM_DIM: BlockConfigurationOption(title=PARAM_DIM, description="Param name like '2t'", value_type="str"),
        "statistic": BlockConfigurationOption(
            title="Statistic",
            description="Statistic to compute over steps",
            value_type="enum['mean', 'std', 'min', 'max']",
        ),
    }
    inputs: list[str] = ["dataset"]

    def validate(self, block: BlockInstance, inputs: dict[str, BlockInstanceOutput]) -> Either[QubedInstanceOutput, Error]:  # type:ignore[invalid-argument] # semigroup
        input_dataset = inputs.get("dataset")
        if not isinstance(input_dataset, QubedInstanceOutput):
            actual_type = type(input_dataset).__name__ if input_dataset is not None else "None"
            return Either.error(f"Unsupported input type for 'dataset': expected QubedInstanceOutput, got {actual_type}")

        param = block.configuration_values[PARAM_DIM]
        if {PARAM_DIM: param} not in input_dataset:
            return Either.error(f"param {param} is not in the input parameters: {input_dataset.axes().get(PARAM_DIM, [])}")
        output = input_dataset.collapse([PARAM_DIM, STEP_DIM]).expand({PARAM_DIM: [param]})
        return Either.ok(output)

    def compile(
        self,
        inputs: ActionLookup,
        block_id: BlockInstanceId,
        block: BlockInstance,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        input_task = block.input_ids["dataset"]
        input_task_action = inputs[input_task]
        stat = block.configuration_values["statistic"]
        param = input_task_action.select({PARAM_DIM: block.configuration_values[PARAM_DIM]})
        if stat == "mean":
            action = param.mean(dim=STEP_DIM)
        elif stat == "std":
            action = param.std(dim=STEP_DIM)
        elif stat == "min":
            action = param.min(dim=STEP_DIM)
        elif stat == "max":
            action = param.max(dim=STEP_DIM)
        return Either.ok(action)

    def intersect(self, input: BlockInstanceOutput) -> bool:
        if not isinstance(input, QubedInstanceOutput):
            return False
        dims = input.dimensions()
        return STEP_DIM in dims and PARAM_DIM in dims


class ZarrSink(Sink):
    title: str = "Zarr Sink"
    description: str = "Write dataset to a zarr on the local filesystem"
    configuration_options: dict[str, BlockConfigurationOption] = {
        "path": BlockConfigurationOption(
            title="Zarr Path",
            description="Filesystem path where the zarr should be written",
            value_type="str",
        )
    }
    inputs: list[str] = ["dataset"]

    def validate(self, block: BlockInstance, inputs: dict[str, BlockInstanceOutput]) -> Either[QubedInstanceOutput, Error]:  # type:ignore[invalid-argument] # semigroup
        return Either.ok(NoOutput())

    def compile(
        self,
        inputs: ActionLookup,
        block_id: BlockInstanceId,
        block: BlockInstance,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        input_task = block.input_ids["dataset"]
        action = inputs[input_task].map(
            Payload("fiab_plugin_ecmwf.runtime.sinks.write_zarr", kwargs={"path": block.configuration_values["path"]})
        )
        return Either.ok(action)

    def intersect(self, input: BlockInstanceOutput) -> bool:
        return not input.is_empty()


class MapPlotSink(Sink):
    title: str = "Map Plot"
    description: str = "Render a geographic map using earthkit-plots"
    configuration_options: dict[str, BlockConfigurationOption] = {
        PARAM_DIM: BlockConfigurationOption(
            title="Parameters",
            description="Parameters to select and plot (e.g. '2t', 'msl')",
            value_type="list[str]",
        ),
        "domain": BlockConfigurationOption(
            title="Domain",
            description="Geographic domain: global, europe, or a named region",
            value_type="str",
        ),
        "format": BlockConfigurationOption(
            title="Format",
            description="Output image format",
            value_type="enum['png', 'pdf', 'svg']",
        ),
        "groupby": BlockConfigurationOption(
            title="Group By",
            description="Dimension to create subplots over",
            value_type="enum['valid_datetime', 'step', 'number', 'none']",
        ),
        "style_schema": BlockConfigurationOption(
            title="Style Schema",
            description="earthkit-plots schema identifier (e.g. 'inbuilt://fiab')",
            value_type="str",
        ),
    }
    inputs: list[str] = ["dataset"]

    def validate(self, block: BlockInstance, inputs: dict[str, BlockInstanceOutput]) -> Either[QubedInstanceOutput, Error]:  # type:ignore[invalid-argument] # semigroup
        input_dataset = inputs.get("dataset")
        if not isinstance(input_dataset, QubedInstanceOutput):
            actual_type = type(input_dataset).__name__ if input_dataset is not None else "None"
            return Either.error(f"Unsupported input type for 'dataset': expected QubedInstanceOutput, got {actual_type}")

        params = _get_item_list(block.configuration_values[PARAM_DIM], str, allow_empty=False)
        if any(map(lambda x: x.e is not None, [params])):
            return Either.error(f"Invalid configuration: {params.e}")

        params = params.get_or_raise()
        missing = [p for p in params if {PARAM_DIM: p} not in input_dataset]
        if missing:
            return Either.error(f"params {missing} are not in the input parameters: {input_dataset.axes().get(PARAM_DIM, [])}")

        if (
            block.configuration_values["groupby"] not in ("valid_datetime", "step", "number", "none")
            or block.configuration_values["groupby"] not in input_dataset.dimensions()
        ):
            return Either.error(
                f"Invalid groupby value: {block.configuration_values['groupby']}, must be one of {set(['valid_datetime', 'step', 'number', 'none']).intersection(set(input_dataset.dimensions()))}"
            )

        return Either.ok(NoOutput())

    def compile(
        self,
        inputs: ActionLookup,
        block_id: BlockInstanceId,
        block: BlockInstance,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        input_task = block.input_ids["dataset"]
        params = _get_item_list(block.configuration_values[PARAM_DIM], str, allow_empty=False).get_or_raise()
        selected = inputs[input_task].select({PARAM_DIM: params if len(params) > 1 else params[0]})

        groupby = block.configuration_values["groupby"] or "valid_datetime"

        if groupby != "none":
            selected = selected.concatenate(groupby)

        action = selected.map(
            Payload(
                "fiab_plugin_ecmwf.runtime.plots.map_plot",
                kwargs={
                    "domain": block.configuration_values["domain"] or None,
                    "format": block.configuration_values["format"] or "png",
                    "groupby": block.configuration_values["groupby"] or "valid_datetime",
                    "style_schema": block.configuration_values["style_schema"] or "inbuilt://fiab",
                },
            )
        )
        return Either.ok(action)

    def intersect(self, input: BlockInstanceOutput) -> bool:
        if not isinstance(input, QubedInstanceOutput):
            return False
        return PARAM_DIM in input.dimensions()
