# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

from typing import cast

import numpy as np
from cascade.low.func import Either
from earthkit.workflows.fluent import Action, Payload, from_source
from fiab_core.fable import (
    ActionLookup,
    BlockConfigurationOption,
    BlockInstance,
    BlockInstanceId,
    BlockInstanceOutput,
)
from fiab_core.plugin import Error
from fiab_core.tools.blocks import Product, Sink, Source

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
    }
    inputs: list[str] = []

    def validate(self, block: BlockInstance, inputs: dict[str, BlockInstanceOutput]) -> Either[QubedInstanceOutput, Error]:  # type:ignore[invalid-argument] # semigroup
        output = QubedInstanceOutput(
            dataqube={
                PARAM_DIM: cast(list[str], IFS_REQUEST[PARAM_DIM]),
                ENSEMBLE_DIM: cast(list[int], IFS_REQUEST[ENSEMBLE_DIM]),
                STEP_DIM: cast(list[int], IFS_REQUEST[STEP_DIM]),
            }
        )
        return Either.ok(output)

    def compile(
        self,
        inputs: ActionLookup,
        block_id: BlockInstanceId,
        block: BlockInstance,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
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
                                    PARAM_DIM: param,
                                }
                            },
                        )
                        for param in IFS_REQUEST[PARAM_DIM]
                    ]
                ),
                coords={PARAM_DIM: IFS_REQUEST[PARAM_DIM]},
            )
            .expand(
                (ENSEMBLE_DIM, cast(list[int], IFS_REQUEST["number"])),
                "number",
                dim_size=len(IFS_REQUEST["number"]),
                backend_kwargs={"method": "isel"},
            )
            .expand(
                (STEP_DIM, cast(list[int], IFS_REQUEST["step"])),
                "step",
                dim_size=len(IFS_REQUEST["step"]),
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
        return Either.ok(action)

    def intersect(self, input: BlockInstanceOutput) -> bool:
        if not isinstance(input, QubedInstanceOutput):
            return False
        return ENSEMBLE_DIM in input and PARAM_DIM in input


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
        return STEP_DIM in input and PARAM_DIM in input


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
        return Either.ok(QubedInstanceOutput())

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
        if not isinstance(input, QubedInstanceOutput):
            return False
        return PARAM_DIM in input and len(input.axes()[PARAM_DIM]) > 0
