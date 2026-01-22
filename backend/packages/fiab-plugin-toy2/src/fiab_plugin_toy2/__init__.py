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
    BlockFactory,
    BlockFactoryCatalogue,
    BlockFactoryId,
    BlockInstance,
    BlockInstanceId,
    BlockInstanceOutput,
    DataPartitionLookup,
    XarrayOutput,
)
from fiab_core.plugin import Error, Plugin

exampleSource = BlockFactory(
    kind="source",
    title="The earthkit test.grib example file",
    description="A dataset sample for testing out workflows",
    configuration_options={},
    inputs=[],
)

ekdSource = BlockFactory(
    kind="source",
    title="Earthkit Data Source",
    description="Fetch data from mars or ecmwf open data",
    configuration_options={
        "source_name": BlockConfigurationOption(
            title="Source", description="Top level source for earthkit data", value_type="enum['mars', 'ecmwf-open-data']"
        ),
        "date": BlockConfigurationOption(title="Date", description="The date dimension of the data", value_type="date-iso8601"),
        # NOTE there could be more, we just hardcode remaining params in the definition
    },
    inputs=[],
)

meanProduct = BlockFactory(
    kind="product",
    title="Mean",
    description="Computes a mean of the given variable over all coords/dims",
    configuration_options={
        "variable": BlockConfigurationOption(title="Variable", description="Variable name like '2t'", value_type="str"),
    },
    inputs=["dataset"],
)

dummySink = BlockFactory(
    kind="sink",
    title="Dummy Sink",
    description="A dummy sink",
    configuration_options={},
    inputs=["dataset"],
)

catalogue = BlockFactoryCatalogue(
    factories={
        "exampleSource": exampleSource,
        "ekdSource": ekdSource,
        "meanProduct": meanProduct,
        "dummySink": dummySink,
    },
)


def validator(block: BlockInstance, inputs: dict[str, BlockInstanceOutput]) -> Either[BlockInstanceOutput, Error]:  # type: ignore[invalid-argument] # semigroup
    output: XarrayOutput
    match block.factory_id.factory:
        case "exampleSource" | "ekdSource":
            output = XarrayOutput(variables=["2t", "msl"], coords=["lat", "lon"])
        case "meanProduct":
            input_dataset = cast(XarrayOutput, inputs["dataset"])  # type:ignore[redundant-cast] # NOTE the warning is correct but we expect more
            mean_variable = block.configuration_values["variable"]
            if mean_variable not in input_dataset.variables:
                return Either.error(f"variable {mean_variable} is not in the input variables: {input_dataset.variables}")
            output = XarrayOutput(variables=[mean_variable], coords=[])
        case "dummySink":
            output = XarrayOutput(variables=[], coords=[])
        case unmatched:
            raise TypeError(f"unexpected factory id {unmatched}")
    return Either.ok(output)


def expander(block: BlockInstanceOutput) -> list[BlockFactoryId]:
    if len(block.variables) == 0:
        return []
    expansions = ["dummySink"]
    if isinstance(block, XarrayOutput):
        if block.variables:
            expansions.append("meanProduct")
    return expansions


def compiler(partitions: DataPartitionLookup, block_id: BlockInstanceId, block: BlockInstance) -> Either[DataPartitionLookup, Error]:  # type: ignore[invalid-argument] # semigroup
    # NOTE this is commented out since the plugin is not actually published, but instead installed via the `dev` group
    # environment = ["fiab-plugin-toy2[runtime]"]
    match block.factory_id.factory:
        case "exampleSource":
            action = from_source(np.array(["fiab_plugin_toy2.runtime.datasource.from_example"]))
        case "ekdSource":
            request_params = {
                "param": ["2t", "msl"],
                "levtype": "sfc",
                "area": [50, -10, 40, 10],
                "grid": [2, 2],
                "date": block.configuration_values["date"],
            }
            action = from_source(
                np.array(
                    [
                        Payload(
                            "fiab_plugin_toy2.runtime.datasource.from_source",
                            [block.configuration_values["source"], request_params],
                        )
                    ]
                )
            )
        case "meanProduct":
            input_task = block.input_ids["dataset"]
            input_task_action = partitions[input_task]
            if input_task_action.nodes.size != 1:
                return Either.error(f"meanProduct supports only trivial partitioning, gotten {input_task_action.nodes.size}")
            action = input_task_action.map(
                Payload("fiab_plugin_toy2.runtime.product.select", kwargs={"variable": block.configuration_values["variable"]})
            ).map(Payload("fiab_plugin_toy2.runtime.product.mean"))
        case "dummySink":
            input_task = block.input_ids["dataset"]
            action = partitions[input_task]
        case unmatched:
            raise TypeError(f"unexpected factory id {unmatched}")

    partitions[block_id] = action
    return Either.ok(partitions)


class ToyPlugin(Plugin):
    def validate(
        self, block: BlockInstance, inputs: dict[str, BlockInstanceOutput]
    ) -> Either[BlockInstanceOutput, Error]:  # type: ignore[invalid-argument] # semigroup
        return validator(block, inputs)

    def expand(self, block: BlockInstanceOutput) -> list[BlockFactoryId]:
        return expander(block)

    def compile(
        self,
        partitions: DataPartitionLookup,
        block_id: BlockInstanceId,
        block: BlockInstance,
    ) -> Either[DataPartitionLookup, Error]:  # type: ignore[invalid-argument] # semigroup
        return compiler(partitions, block_id, block)


plugin = ToyPlugin(catalogue=catalogue)
