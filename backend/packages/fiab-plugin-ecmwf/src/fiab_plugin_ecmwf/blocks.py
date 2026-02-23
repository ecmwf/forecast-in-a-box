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
from earthkit.workflows.fluent import Payload, from_source
from fiab_core.fable import (
    BlockConfigurationOption,
    BlockInstance,
    BlockInstanceId,
    BlockInstanceOutput,
    DataPartitionLookup,
)
from fiab_core.plugin import Error
from fiab_core.tools.blocks import Product, Sink, Source

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

    def validate(self, block: BlockInstance, inputs: dict[str, BlockInstanceOutput]) -> Either[BlockInstanceOutput, Error]:  # type:ignore[invalid-argument] # semigroup
        output = BlockInstanceOutput(
            dataqube={
                PARAM_DIM: cast(list[str], IFS_REQUEST[PARAM_DIM]),
                ENSEMBLE_DIM: cast(list[int], IFS_REQUEST[ENSEMBLE_DIM]),
                STEP_DIM: cast(list[int], IFS_REQUEST[STEP_DIM]),
            }
        )
        return Either.ok(output)

    def compile(
        self,
        partitions: DataPartitionLookup,
        block_id: BlockInstanceId,
        block: BlockInstance,
    ) -> Either[DataPartitionLookup, Error]:  # type:ignore[invalid-argument] # semigroup
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
                coords={PARAM_DIM: IFS_REQUEST[x] for x in [PARAM_DIM]},
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
        partitions[block_id] = action
        return Either.ok(partitions)


class EnsembleStatistics(Product):
    title: str = "Ensemble Statistics"
    description: str = "Computes ensemble mean or standard deviation"
    configuration_options: dict[str, BlockConfigurationOption] = {
        PARAM_DIM: BlockConfigurationOption(title="Variable", description="Variable name like '2t'", value_type="str"),
        "statistic": BlockConfigurationOption(
            title="Statistic",
            description="Statistic to compute over the ensemble",
            value_type="enum['mean', 'std']",
        ),
    }
    inputs: list[str] = ["dataset"]

    def validate(self, block: BlockInstance, inputs: dict[str, BlockInstanceOutput]) -> Either[BlockInstanceOutput, Error]:  # type:ignore[invalid-argument] # semigroup
        input_dataset = inputs["dataset"]

        param = block.configuration_values[PARAM_DIM]
        if {PARAM_DIM: param} not in input_dataset:
            return Either.error(f"param {param} is not in the input variables: {input_dataset.axes().get('param', [])}")

        output = input_dataset.collapse(["param", ENSEMBLE_DIM]).expand({"param": [param]})
        return Either.ok(output)

    def compile(
        self,
        partitions: DataPartitionLookup,
        block_id: BlockInstanceId,
        block: BlockInstance,
    ) -> Either[DataPartitionLookup, Error]:  # type:ignore[invalid-argument] # semigroup
        input_task = block.input_ids["dataset"]
        input_task_action = partitions[input_task]
        stat = block.configuration_values["statistic"]
        param = input_task_action.select({PARAM_DIM: block.configuration_values["variable"]})
        if stat == "mean":
            action = param.mean(dim=ENSEMBLE_DIM)
        elif stat == "std":
            action = param.std(dim=ENSEMBLE_DIM)
        else:
            return Either.error(f"Unsupported statistic {stat}")
        partitions[block_id] = action
        return Either.ok(partitions)

    def intersect(self, input: BlockInstanceOutput) -> bool:
        return ENSEMBLE_DIM in input and "param" in input


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

    def validate(self, block: BlockInstance, inputs: dict[str, BlockInstanceOutput]) -> Either[BlockInstanceOutput, Error]:  # type:ignore[invalid-argument] # semigroup
        input_dataset = inputs["dataset"]
        param = block.configuration_values[PARAM_DIM]
        if {"param": param} not in input_dataset:
            return Either.error(f"param {param} is not in the input variables: {input_dataset.axes().get('param', [])}")
        output = input_dataset.collapse(["param", STEP_DIM]).expand({"param": [param]})
        return Either.ok(output)

    def compile(
        self,
        partitions: DataPartitionLookup,
        block_id: BlockInstanceId,
        block: BlockInstance,
    ) -> Either[DataPartitionLookup, Error]:  # type:ignore[invalid-argument] # semigroup
        input_task = block.input_ids["dataset"]
        input_task_action = partitions[input_task]
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
        else:
            return Either.error(f"Unsupported statistic {stat}")
        partitions[block_id] = action
        return Either.ok(partitions)

    def intersect(self, input: BlockInstanceOutput) -> bool:
        return STEP_DIM in input and "param" in input


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

    def validate(self, block: BlockInstance, inputs: dict[str, BlockInstanceOutput]) -> Either[BlockInstanceOutput, Error]:  # type:ignore[invalid-argument] # semigroup
        return Either.ok(BlockInstanceOutput())

    def compile(
        self,
        partitions: DataPartitionLookup,
        block_id: BlockInstanceId,
        block: BlockInstance,
    ) -> Either[DataPartitionLookup, Error]:  # type:ignore[invalid-argument] # semigroup
        input_task = block.input_ids["dataset"]
        action = partitions[input_task].map(
            Payload("fiab_plugin_ecmwf.runtime.sinks.write_zarr", kwargs={"path": block.configuration_values["path"]})
        )
        partitions[block_id] = action
        return Either.ok(partitions)

    def intersect(self, input: BlockInstanceOutput) -> bool:
        return "param" in input and len(input.axes()["param"]) > 0
