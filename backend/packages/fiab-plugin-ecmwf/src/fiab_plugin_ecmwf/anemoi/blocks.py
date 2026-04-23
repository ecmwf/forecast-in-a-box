# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.


from pathlib import Path
from typing import Any

from cascade.low.func import Either
from earthkit.workflows.fluent import Action
from earthkit.workflows.plugins.anemoi.fluent import Inference
from fiab_core.artifacts import CompositeArtifactId
from fiab_core.fable import (
    ActionLookup,
    BlockConfigurationOption,
    BlockInstance,
    BlockInstanceId,
    BlockInstanceOutput,
    QubedOutput,
)
from fiab_core.plugin import Error
from fiab_core.tools.blocks import Source, Transform

from fiab_plugin_ecmwf.qubed_utils import axes, contains, dimensions, expand

from .utils import (
    get_checkpoint_enum_type,
    get_environment,
    get_local_path,
    get_metadata,
    validate_anemoi_block,
)


class AnemoiBuilder:
    """Utility to build an Inference from an Anemoi checkpoint, for use in both Source and Transform blocks"""

    def __init__(self, checkpoint: str) -> None:
        self.checkpoint = checkpoint
        self.artifact_id = CompositeArtifactId.from_str(checkpoint)

    def _local_path(self) -> Path:
        return get_local_path(self.artifact_id)

    def build(self, lead_time: int) -> Inference:  # type: ignore[reportReturnType]
        import functools

        class WrappedInference(Inference):
            @functools.wraps(Inference.from_input)
            def from_input(s, *a: Any, **k: Any) -> Action:  # type: ignore[reportIncompatibleMethodOverride, reportSelfClsParameterName]
                return super().from_input(*a, **k, payload_metadata={"artifacts": [self.artifact_id]})

            @functools.wraps(Inference.from_initial_conditions)
            def from_initial_conditions(s, *a: Any, **k: Any) -> Action:  # type: ignore[reportIncompatibleMethodOverride, reportSelfClsParameterName]
                return super().from_initial_conditions(*a, **k, payload_metadata={"artifacts": [self.artifact_id]})

        return WrappedInference(
            ckpt=self._local_path(),
            lead_time=lead_time,
            environment=get_environment(self.artifact_id),
            metadata=get_metadata(self.artifact_id),
        )


class AnemoiSource(Source):
    title: str = "Anemoi Model Source"
    description: str = "Get a forecast from an Anemoi checkpoint, initialised from a source."
    inputs: list[str] = []

    configuration_options: dict[str, BlockConfigurationOption] = {
        "checkpoint": BlockConfigurationOption(
            title="Anemoi Checkpoint",
            description="Anemoi checkpoint name",
            value_type=get_checkpoint_enum_type(),
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

    def validate(self, block: BlockInstance, inputs: dict[str, QubedOutput]) -> Either[BlockInstanceOutput, Error]:  # type:ignore[invalid-argument] # semigroup
        result = validate_anemoi_block(block)
        if result.e or not result.t:
            return Either.error(result.e)

        ensemble_members = int(block.configuration_values.get("ensemble_members") or 1)
        qubed_instance = expand(result.t, {"number": range(1, ensemble_members + 1)})
        return Either.ok(qubed_instance)

    def compile(
        self,
        inputs: ActionLookup,
        block_id: BlockInstanceId,
        block: BlockInstance,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        configuration = block.configuration_values

        inference = AnemoiBuilder(configuration["checkpoint"]).build(lead_time=int(configuration["lead_time"]))
        action = inference.from_input(
            configuration["input_source"],
            date=configuration["base_time"],
            ensemble_members=int(configuration.get("ensemble_members") or 1),
        )
        return Either.ok(action)


class AnemoiTransform(Transform):
    title: str = "Anemoi Model Transform"
    description: str = "Initialise an Anemoi model from an existing datasource"
    inputs: list[str] = ["dataset"]

    configuration_options: dict[str, BlockConfigurationOption] = {
        "checkpoint": BlockConfigurationOption(
            title="Anemoi Checkpoint",
            description="Anemoi checkpoint name",
            value_type=get_checkpoint_enum_type(),
        ),
        "lead_time": BlockConfigurationOption(
            title="Lead time",
            description="Lead time of the forecast",
            value_type="int",
        ),
    }

    def validate(self, block: BlockInstance, inputs: dict[str, QubedOutput]) -> Either[BlockInstanceOutput, Error]:  # type:ignore[invalid-argument] # semigroup
        # TODO: Validate that initial conditions are fully provided
        result = validate_anemoi_block(block)
        if result.e or not result.t:
            return Either.error(result.e)

        qubed_instance = result.t
        input_dataset = inputs["dataset"]
        if contains(input_dataset, "number"):
            qubed_instance = expand(qubed_instance, {"number": axes(input_dataset)["number"]})
        return Either.ok(qubed_instance)

    def compile(
        self,
        inputs: ActionLookup,
        block_id: BlockInstanceId,
        block: BlockInstance,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        input_task = block.input_ids["dataset"]
        inference = AnemoiBuilder(block.configuration_values["checkpoint"]).build(lead_time=int(block.configuration_values["lead_time"]))
        action = inference.from_initial_conditions(
            inputs[input_task],
        )
        return Either.ok(action)

    def intersect(self, other: QubedOutput) -> bool:
        # NOTE not sure if this is exactly correct -- tests prescribe that for QubedOutput() this should return False, otherwise True
        return bool(dimensions(other))
