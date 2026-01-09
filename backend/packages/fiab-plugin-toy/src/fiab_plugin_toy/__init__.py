# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import json
from typing import cast

from cascade.low.builders import JobBuilder, TaskBuilder
from cascade.low.func import Either
from fiab_core.fable import (
    BlockConfigurationOption,
    BlockFactory,
    BlockFactoryCatalogue,
    BlockFactoryId,
    BlockInstance,
    BlockInstanceId,
    BlockInstanceOutput,
    BlockKind,
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

catalogue = BlockFactoryCatalogue(
    factories={
        "exampleSource": exampleSource,
        "ekdSource": ekdSource,
        "meanProduct": meanProduct,
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
        case unmatched:
            raise TypeError(f"unexpected factory id {unmatched}")
    return Either.ok(output)


def expander(block: BlockInstanceOutput) -> list[BlockFactoryId]:
    if isinstance(block, XarrayOutput):
        if block.variables:
            return ["meanProduct"]
    return []


def compiler(
    jobBuilder: JobBuilder, partitions: DataPartitionLookup, block_id: BlockInstanceId, block: BlockInstance
) -> Either[tuple[JobBuilder, DataPartitionLookup], Error]:  # type: ignore[invalid-argument] # semigroup
    match block.factory_id.factory:
        case "exampleSource":
            task = TaskBuilder.from_entrypoint(
                entrypoint="fiab_plugin_toy_impl.datasource.from_example",
                input_schema={},
                output_class="xarray.Dataset",
                environment=["fiab-plugin-toy-impl"],
            )
            partitions[block_id] = {"": block_id}
            return Either.ok((jobBuilder.with_node(block_id, task), partitions))
        case "ekdSource":
            request_params = {
                "param": ["2t", "msl"],
                "levtype": "sfc",
                "area": [50, -10, 40, 10],
                "grid": [2, 2],
                "date": block.configuration_values["date"],
            }
            task = TaskBuilder.from_entrypoint(
                entrypoint="fiab_plugin_toy_impl.datasource.from_source",
                input_schema={
                    "source": "str",
                    "request_params_json": "str",
                },
                output_class="xarray.Dataset",
                environment=["fiab-plugin-toy-impl"],
            ).with_values(
                source=block.configuration_values["source"],
                request_params_json=json.dumps(request_params),
            )
            partitions[block_id] = {"": block_id}
            return Either.ok((jobBuilder.with_node(block_id, task), partitions))
        case "meanProduct":
            input_task = block.input_ids["dataset"]
            input_task_partitions = partitions[input_task]
            if (pc := len(input_task_partitions.values())) != 1:
                return Either.error("meanProduct supports only trivial partitioning, gotten {pc}")
            input_task_id = list(input_task_partitions.values())[0]
            taskSelect = TaskBuilder.from_entrypoint(
                entrypoint="fiab_plugin_toy_impl.product.select",
                input_schema={
                    "dataset": "xarray.Dataset",
                    "variable": "str",
                },
                output_class="xarray.DataArray",
                environment=["fiab-plugin-toy-impl"],
            ).with_values(variable=block.configuration_values["variable"])
            taskCalculate = TaskBuilder.from_entrypoint(
                entrypoint="fiab_plugin_toy_impl.product.mean",
                input_schema={"array": "xarray.DataArray"},
                output_class="xarray.Dataset",
                environment=["fiab-plugin-toy-impl"],
            )
            partitions[block_id] = {"": block_id + "/calculate"}
            return Either.ok(
                (
                    (
                        jobBuilder.with_node(block_id + "/select", taskSelect)
                        .with_node(block_id + "/calculate", taskCalculate)
                        .with_edge(input_task_id, block_id + "/select", "dataset")
                        .with_edge(block_id + "/select", block_id + "/calculate", "array")
                    ),
                    partitions,
                )
            )
        case unmatched:
            raise TypeError(f"unexpected factory id {unmatched}")


plugin = Plugin(
    catalogue=catalogue,
    validator=validator,
    expander=expander,
    compiler=compiler,
)
