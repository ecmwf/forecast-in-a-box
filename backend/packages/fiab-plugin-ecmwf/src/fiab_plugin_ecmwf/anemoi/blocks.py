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
from earthkit.workflows.fluent import Action
from earthkit.workflows.plugins.anemoi.fluent import from_initial_conditions, from_input
from fiab_core.artifacts import CompositeArtifactId
from fiab_core.fable import (
    ActionLookup,
    BlockConfigurationOption,
    BlockInstance,
    BlockInstanceId,
    BlockInstanceOutput,
)
from fiab_core.plugin import Error
from fiab_core.tools.blocks import Source, Transform

from fiab_plugin_ecmwf.metadata import QubedInstanceOutput

from .utils import (
    CHECKPOINT_ENUM_TYPE,
    get_environment,
    get_local_path,
    validate_anemoi_block,
)


class AnemoiSource(Source):
    title: str = "Anemoi Model Source"
    description: str = "Get a forecast from an Anemoi checkpoint, initialised from a source."
    inputs: list[str] = []

    configuration_options: dict[str, BlockConfigurationOption] = {
        "checkpoint": BlockConfigurationOption(
            title="Anemoi Checkpoint",
            description="Anemoi checkpoint name",
            value_type=CHECKPOINT_ENUM_TYPE,
        ),
        "input_source": BlockConfigurationOption(
            title="Input Source",
            description="Source of the initial conditions",
            value_type="enum['mars', 'opendata', 'polytope']",
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
            description="Number of ensemble members, default is 1.",
            value_type="optional[int]",
        ),
    }

    def validate(self, block: BlockInstance, inputs: dict[str, BlockInstanceOutput]) -> Either[QubedInstanceOutput, Error]:  # type:ignore[invalid-argument] # semigroup
        result = validate_anemoi_block(block)
        if result.e or not result.t:
            return result

        ensemble_members = int(block.configuration_values.get("ensemble_members") or 1)
        qubed_instance = result.t.expand({"number": range(1, ensemble_members + 1)})
        return Either.ok(qubed_instance)

    def compile(
        self,
        inputs: ActionLookup,
        block_id: BlockInstanceId,
        block: BlockInstance,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        configuration = block.configuration_values
        composite_id = CompositeArtifactId.from_str(configuration["checkpoint"])
        ensemble_members_str = configuration.get("ensemble_members")
        action = from_input(
            get_local_path(composite_id),
            configuration["input_source"],
            lead_time=int(configuration["lead_time"]),
            date=configuration["base_time"],
            ensemble_members=int(ensemble_members_str) if ensemble_members_str else None,
            environment=get_environment(composite_id, configuration["input_source"]),
        )
        return Either.ok(action)


class AnemoiTransform(Transform):
    title: str = "Anemoi Model Transform"
    description: str = "Initialise an Anemoi model from a source"
    inputs: list[str] = ["dataset"]

    configuration_options: dict[str, BlockConfigurationOption] = {
        "checkpoint": BlockConfigurationOption(
            title="Anemoi Checkpoint",
            description="Anemoi checkpoint name",
            value_type=CHECKPOINT_ENUM_TYPE,
        ),
        "lead_time": BlockConfigurationOption(
            title="Lead time",
            description="Lead time of the forecast",
            value_type="int",
        ),
    }

    def validate(self, block: BlockInstance, inputs: dict[str, BlockInstanceOutput]) -> Either[BlockInstanceOutput, Error]:  # type:ignore[invalid-argument] # semigroup
        result = validate_anemoi_block(block)
        if result.e or not result.t:
            return result  # type: ignore

        qubed_instance = result.t
        input_dataset = cast(QubedInstanceOutput, inputs["dataset"])
        if "number" in input_dataset:
            qubed_instance = qubed_instance.expand({"number": input_dataset.axes()["number"]})
        return Either.ok(qubed_instance)

    def compile(
        self,
        inputs: ActionLookup,
        block_id: BlockInstanceId,
        block: BlockInstance,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        input_task = block.input_ids["dataset"]
        composite_id = CompositeArtifactId.from_str(block.configuration_values["checkpoint"])
        action = from_initial_conditions(
            ckpt=get_local_path(composite_id),
            initial_conditions=inputs[input_task],
            lead_time=int(block.configuration_values["lead_time"]),
            environment=get_environment(composite_id),
        )
        return Either.ok(action)

    def intersect(self, input: BlockInstanceOutput) -> bool:
        if not isinstance(input, QubedInstanceOutput) or input.is_empty():
            return False
        return True
