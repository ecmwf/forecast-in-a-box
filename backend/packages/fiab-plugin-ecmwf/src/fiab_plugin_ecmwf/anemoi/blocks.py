# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.


from typing import cast

from cascade.low.func import Either
from earthkit.workflows.plugins.anemoi.fluent import from_initial_conditions, from_input
from fiab_core.tools.blocks import Product, Sink, Source, Transform
from fiab_core.fable import (
    BlockConfigurationOption,
    BlockInstance,
    BlockInstanceId,
    BlockInstanceOutput,
    DataPartitionLookup,
    XarrayOutput,
)
from fiab_core.plugin import Error


def _get_environment(checkpoint: str) -> dict[str, list[str]]:
    # TODO: Implement logic to get environment information based on checkpoint
    return {}


class AnemoiSource(Source):
    title: str ="Anemoi Model Source"
    description: str ="Fetch data from anemoi initial conditions"
    configuration_options: dict[str, BlockConfigurationOption] = {
        "checkpoint": BlockConfigurationOption(
            title="Anemoi Checkpoint",
            description="Anemoi checkpoint name",
            value_type="str",
        ),
        "input_source": BlockConfigurationOption(
            title="Input Source",
            description="Source of the initial conditions",
            value_type="str",
        ),
        "lead_time": BlockConfigurationOption(
            title="Lead time",
            description="Lead time of the forecast",
            value_type="int",
        ),
        "base_time": BlockConfigurationOption(
            title="Base time",
            description="Base time of the forecast",
            value_type="datetime",
        ),
        "ensemble_members": BlockConfigurationOption(
            title="Ensemble Members",
            description="Number of ensemble members",
            value_type="int",
        ),
        "configuration": BlockConfigurationOption(
            title="Anemoi Configuration",
            description="Extra Anemoi configuration parameters",
            value_type="optional[dict]",
        ),
    }
    inputs: list[str] =[]

    def validate(self, block: BlockInstance, inputs: dict[str, BlockInstanceOutput]) -> Either[BlockInstanceOutput, Error]:  # type:ignore[invalid-argument] # semigroup
        # TODO: Need to link this to the actual configuration options and checkpoint
        output = XarrayOutput(variables=["u", "v", "t", "q"], coords=["time", "level"])
        return Either.ok(output)

    def compile(
        self,
        partitions: DataPartitionLookup,
        block_id: BlockInstanceId,
        block: BlockInstance,
    ) -> Either[DataPartitionLookup, Error]:  # type:ignore[invalid-argument] # semigroup
        configuration = block.configuration_values

        action = from_input(
            configuration["checkpoint"],
            configuration["input_source"],
            lead_time=configuration["lead_time"],
            date=configuration["base_time"],
            ensemble_members=cast(int, configuration["ensemble_members"]),
            environment=_get_environment(configuration["checkpoint"]),
            # **extra_kwargs,
        )
        partitions[block_id] = action
        return Either.ok(partitions)


class AnemoiTransform(Transform):
    title: str ="Anemoi Model Transform"
    description: str="Initialise an Anemoi model from a source"
    configuration_options: dict[str, BlockConfigurationOption] = {
        "checkpoint": BlockConfigurationOption(
            title="Anemoi Checkpoint",
            description="Anemoi checkpoint name",
            value_type="str",
        ),
        "lead_time": BlockConfigurationOption(
            title="Lead time",
            description="Lead time of the forecast",
            value_type="int",
        ),
        "configuration": BlockConfigurationOption(
            title="Anemoi Configuration",
            description="Extra Anemoi configuration parameters",
            value_type="optional[dict]",
        ),
    }
    inputs: list[str] =["dataset"]


    def validate(self, block: BlockInstance, inputs: dict[str, BlockInstanceOutput]) -> Either[BlockInstanceOutput, Error]: # type:ignore[invalid-argument] # semigroup
        input_dataset = cast(XarrayOutput, inputs["dataset"])  # type:ignore[redundant-cast] # NOTE the warning is correct but we expect more
        checkpoint = block.configuration_values["checkpoint"]
        # TODO: Need to link this to the actual configuration options and checkpoint
        output = XarrayOutput(variables=["u", "v", "t", "q"], coords=["time", "level"])
        return Either.ok(output)

    def compile(
        self,
        partitions: DataPartitionLookup,
        block_id: BlockInstanceId,
        block: BlockInstance,
    ) -> Either[DataPartitionLookup, Error]:  # type:ignore[invalid-argument] # semigroup
        input_task = block.input_ids["dataset"]
        input_task_action = partitions[input_task]

        partitions[block_id] = from_initial_conditions(
            ckpt=block.configuration_values["checkpoint"],
            initial_conditions=input_task_action,
            lead_time=block.configuration_values["lead_time"],
            # **extra_kwargs,
        )
        return Either.ok(partitions)

    def intersect(self, input: BlockInstanceOutput) -> bool:
        # TODO: Validate that the dataset contains the initial conditions needed
        return isinstance(input, XarrayOutput) and len(input.variables) > 0
