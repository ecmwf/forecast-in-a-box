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
    XarrayOutput,
)
from fiab_core.plugin import Error
from fiab_core.tools.blocks import Product, Sink, Source

IFS_REQUEST = {
    "class": ["od"],
    "stream": ["enfo"],
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
    "levtype": ["sfc"],
    "step": list(map(str, range(0, 61, 6))),
    "type": ["pf"],
    "number": list(map(str, range(1, 6))),
}
PARAM_DIM = "param"
ENSEMBLE_DIM = "number"
STEP_DIM = "step"


class EkdSource(Source):
    def validate(self, block: BlockInstance, inputs: dict[str, BlockInstanceOutput]) -> Either[BlockInstanceOutput, Error]:  # type:ignore[invalid-argument] # semigroup
        output = XarrayOutput(variables=IFS_REQUEST["param"], coords=[STEP_DIM, ENSEMBLE_DIM])
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
                            "earthkit.data.from_source",
                            [block.configuration_values["source"]],
                            {
                                "request": {
                                    **IFS_REQUEST,
                                    "date": block.configuration_values["date"],
                                    "expver": block.configuration_values["expver"],
                                    "param": param,
                                }
                            },
                        )
                        for param in IFS_REQUEST["param"]
                    ]
                ),
                coords={PARAM_DIM: IFS_REQUEST[x] for x in ["param"]},
            )
            .expand(
                (ENSEMBLE_DIM, IFS_REQUEST["number"]),
                "number",
                dim_size=len(IFS_REQUEST["number"]),
            )
            .expand(
                (STEP_DIM, IFS_REQUEST["step"]),
                "step",
                dim_size=len(IFS_REQUEST["step"]),
            )
        )
        partitions[block_id] = action
        return Either.ok(partitions)


ekdSource = EkdSource(
    title="Earthkit Data Source",
    description="Fetch data from mars or ecmwf open data",
    configuration_options={
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
    },
    inputs=[],
)


class EnsembleStatistics(Product):
    def validate(self, block: BlockInstance, inputs: dict[str, BlockInstanceOutput]) -> Either[BlockInstanceOutput, Error]:  # type:ignore[invalid-argument] # semigroup
        input_dataset = cast(XarrayOutput, inputs["dataset"])  # type:ignore[redundant-cast] # NOTE the warning is correct but we expect more
        variable = block.configuration_values["variable"]
        if variable not in input_dataset.variables:
            return Either.error(f"variable {variable} is not in the input variables: {input_dataset.variables}")
        output = XarrayOutput(variables=[variable], coords=[x for x in input_dataset.coords if x != ENSEMBLE_DIM])
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
        partitions[block_id] = action
        return Either.ok(partitions)

    def intersect(self, input: BlockInstanceOutput) -> bool:
        return isinstance(input, XarrayOutput) and len(input.variables) > 0 and ENSEMBLE_DIM in input.coords


ensembleStatistics = EnsembleStatistics(
    title="Ensemble Statistics",
    description="Computes ensemble mean or standard deviation",
    configuration_options={
        "variable": BlockConfigurationOption(title="Variable", description="Variable name like '2t'", value_type="str"),
        "statistic": BlockConfigurationOption(
            title="Statistic",
            description="Statistic to compute over the ensemble",
            value_type="enum['mean', 'std']",
        ),
    },
    inputs=["dataset"],
)


class TemporalStatistics(Product):
    def validate(self, block: BlockInstance, inputs: dict[str, BlockInstanceOutput]) -> Either[BlockInstanceOutput, Error]:  # type:ignore[invalid-argument] # semigroup
        input_dataset = cast(XarrayOutput, inputs["dataset"])  # type:ignore[redundant-cast] # NOTE the warning is correct but we expect more
        variable = block.configuration_values["variable"]
        if variable not in input_dataset.variables:
            return Either.error(f"variable {variable} is not in the input variables: {input_dataset.variables}")
        output = XarrayOutput(variables=[variable], coords=[x for x in input_dataset.coords if x != STEP_DIM])
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
            action = param.mean(dim=STEP_DIM)
        elif stat == "std":
            action = param.std(dim=STEP_DIM)
        elif stat == "min":
            action = param.min(dim=STEP_DIM)
        elif stat == "max":
            action = param.max(dim=STEP_DIM)
        partitions[block_id] = action
        return Either.ok(partitions)

    def intersect(self, input: BlockInstanceOutput) -> bool:
        return isinstance(input, XarrayOutput) and len(input.variables) > 0 and STEP_DIM in input.coords


temporalStatistics = TemporalStatistics(
    title="Temporal Statistics",
    description="Computes temporal statistics",
    configuration_options={
        "variable": BlockConfigurationOption(title="Variable", description="Variable name like '2t'", value_type="str"),
        "statistic": BlockConfigurationOption(
            title="Statistic",
            description="Statistic to compute over steps",
            value_type="enum['mean', 'std', 'min', 'max']",
        ),
    },
    inputs=["dataset"],
)


def write_zarr(fieldlist, path: str) -> None:
    fieldlist.to_xarray().to_zarr(path, mode="w")


class ZarrSink(Sink):
    def validate(self, block: BlockInstance, inputs: dict[str, BlockInstanceOutput]) -> Either[BlockInstanceOutput, Error]:  # type:ignore[invalid-argument] # semigroup
        output = XarrayOutput(variables=[], coords=[])
        return Either.ok(output)

    def compile(
        self,
        partitions: DataPartitionLookup,
        block_id: BlockInstanceId,
        block: BlockInstance,
    ) -> Either[DataPartitionLookup, Error]:  # type:ignore[invalid-argument] # semigroup
        input_task = block.input_ids["dataset"]
        action = partitions[input_task].map(Payload(write_zarr, kwargs={"path": block.configuration_values["path"]}))
        partitions[block_id] = action
        return Either.ok(partitions)

    def intersect(self, input: BlockInstanceOutput) -> bool:
        return len(input.variables) > 0


zarrSink = ZarrSink(
    title="Zarr Sink",
    description="Write dataset to a zarr on the local filesystem",
    configuration_options={
        "path": BlockConfigurationOption(
            title="Zarr Path",
            description="Filesystem path where the zarr should be written",
            value_type="str",
        )
    },
    inputs=["dataset"],
)
