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
from earthkit.workflows.plugins.anemoi.fluent import Inference, get_initial_conditions  # ty: ignore[unresolved-import]
from earthkit.workflows.plugins.anemoi.types import DATE
from fiab_core.fable import (
    ActionLookup,
    BlockConfigurationOption,
    ConfigurationOptionId,
    QubedOutput,
)
from fiab_core.plugin import BlockValidation, BlockValidationError, Error
from fiab_core.tools.blocks import BlockInstanceRich as BlockInstance
from fiab_core.tools.blocks import Source, Transform
from fiab_core.tools.validators import positive

from fiab_plugin_ecmwf.qubed_utils import axes, contains, expand

from .utils import (
    CheckpointArtifact,
    get_checkpoint_enum_type,
)

INPUT_SOURCE_EXTRAS: dict[str, list[str]] = {
    "opendata": ["anemoi-plugins-ecmwf-inference[opendata]"],
    "polytope": ["anemoi-plugins-ecmwf-inference[polytope]"],
    "mars": ["earthkit-data[mars]"],
}

ENSEMBLE = ConfigurationOptionId("number")
CHECKPOINT = ConfigurationOptionId("checkpoint")
LEAD_TIME = ConfigurationOptionId("lead_time")
INPUT_SOURCE = ConfigurationOptionId("input_source")
BASE_TIME = ConfigurationOptionId("base_time")


class AnemoiBuilder:
    """Utility to build an Inference from an Anemoi checkpoint, for use in both Source and Transform blocks"""

    def __init__(self, checkpoint: str) -> None:
        self.checkpoint = CheckpointArtifact(checkpoint)
        self.artifact_id = self.checkpoint.artifact

    @property
    def _local_path(self) -> Path:
        "Get local path to the checkpoint artifact, assumes it is already locally available, does not trigger download"
        return self.checkpoint.get_local_path()

    def inference(self, lead_time: int, *, extra_environment: list[str] | None = None) -> Inference:
        """Build an Inference action for this checkpoint and lead time, with the appropriate environment for the input source if specified"""
        env = self.checkpoint.get_environment()
        env.extend(extra_environment or [])

        return Inference(
            ckpt=self._local_path,
            lead_time=lead_time,
            environment=env,
            expansion_qube=self.checkpoint.get_model_output(lead_time=lead_time),
            **self.checkpoint.get_additional_kwargs(),
        )

    def from_input(self, input_source: str, date: DATE, lead_time: int, ensemble: int = 1, **k: Any) -> Action:
        input_configuration = self.checkpoint.get_input_configuration(input_source)
        return self.inference(lead_time=lead_time, extra_environment=INPUT_SOURCE_EXTRAS.get(input_source)).from_input(
            input=input_configuration,
            date=date,
            lead_time=lead_time,
            ensemble_members=ensemble,
            **k,
            payload_metadata={"artifacts": [self.artifact_id]},
        )

    def from_initial_conditions(self, initial_conditions: Any, lead_time: int, **k: Any) -> Action:
        return self.inference(lead_time=lead_time).from_initial_conditions(
            initial_conditions, **k, payload_metadata={"artifacts": [self.artifact_id]}
        )

    def get_initial_conditions(self, input_source: str, date: DATE, ensemble: int = 1, **k: Any) -> Action:
        env = self.checkpoint.get_environment()
        env.extend(INPUT_SOURCE_EXTRAS.get(input_source, []))

        return get_initial_conditions(
            ckpt=self._local_path,
            input=self.checkpoint.get_input_configuration(input_source),
            date=date,
            environment=env,
            ensemble_members=ensemble,
            payload_metadata={"artifacts": [self.artifact_id]},
            **k,
            **self.checkpoint.get_additional_kwargs(),
        )


class AnemoiSource(Source):
    title: str = "Anemoi Model Source"
    description: str = "Get a forecast from an Anemoi checkpoint, initialised from a source."
    inputs: list[str] = []

    configuration_options: dict[ConfigurationOptionId, BlockConfigurationOption] = {
        CHECKPOINT: BlockConfigurationOption(
            title="Anemoi Checkpoint",
            description="Anemoi checkpoint name",
            value_type=get_checkpoint_enum_type(),
        ),
        INPUT_SOURCE: BlockConfigurationOption(
            title="Input Source",
            description="Source of the initial conditions",
            value_type="enumOpen['mars', 'opendata', 'polytope']",
            default_value="opendata",
        ),
        LEAD_TIME: BlockConfigurationOption(
            title="Lead time",
            description="Lead time of the forecast",
            value_type="int",
        ),
        BASE_TIME: BlockConfigurationOption(
            title="Base time",
            description="Base time of the forecast",
            value_type="datetime",
        ),
        ENSEMBLE: BlockConfigurationOption(
            title="Ensemble Member",
            description="ID of ensemble member.",
            value_type="int",
            default_value="1",
        ),
    }

    def validate(self, block: BlockInstance, inputs: dict[str, QubedOutput]) -> BlockValidation:
        ensemble_members = block.config_as_int(ENSEMBLE, validator=positive)
        checkpoint = CheckpointArtifact(block.config_as_str(CHECKPOINT))
        lead_time = block.config_as_int(LEAD_TIME, validator=positive)
        if ensemble_members < 1:
            return BlockValidation(
                Either.error(BlockValidationError(reason="Ensemble members must be an int, positive and non zero.", is_hard=True))
            )

        validation_error = checkpoint.validate_lead_time(lead_time)
        if validation_error is not None:
            return BlockValidation(Either.error(BlockValidationError(reason=validation_error, is_hard=True)))

        qubed_output = checkpoint.combine_if_nested_qube(checkpoint.get_model_output(lead_time))
        if ensemble_members > 1:
            qubed_output = expand(qubed_output, {"number": range(1, ensemble_members + 1)})
        qubed_output = QubedOutput(dataqube=qubed_output)
        return BlockValidation(Either.ok(qubed_output))

    def compile(  # type:ignore[invalid-argument] # semigroup
        self,
        inputs: ActionLookup,
        block: BlockInstance,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup

        input_source = block.config_as_str(INPUT_SOURCE)
        builder = AnemoiBuilder(block.config_as_str(CHECKPOINT))

        action = builder.from_input(
            input_source=input_source,
            lead_time=block.config_as_int(LEAD_TIME, validator=positive),
            date=block.config_as_datetime(BASE_TIME),
            ensemble=block.config_as_int(ENSEMBLE, validator=positive),
        )
        return Either.ok(action)


class AnemoiInputSource(Source):
    title: str = "Anemoi Model Input Source"
    description: str = "Get the initial conditions for an Anemoi forecast, from a source, no forecast output."
    inputs: list[str] = []

    configuration_options: dict[ConfigurationOptionId, BlockConfigurationOption] = {
        CHECKPOINT: BlockConfigurationOption(
            title="Anemoi Checkpoint",
            description="Anemoi checkpoint name",
            value_type=get_checkpoint_enum_type(),
        ),
        INPUT_SOURCE: BlockConfigurationOption(
            title="Input Source",
            description="Source of the initial conditions",
            value_type="enumOpen['mars', 'opendata', 'polytope']",
            default_value="opendata",
        ),
        BASE_TIME: BlockConfigurationOption(
            title="Base time",
            description="Base time of the forecast",
            value_type="datetime",
        ),
        ENSEMBLE: BlockConfigurationOption(
            title="Ensemble Member",
            description="ID of ensemble member.",
            value_type="int",
            default_value="1",
        ),
    }

    def validate(self, block: BlockInstance, inputs: dict[str, QubedOutput]) -> BlockValidation:
        checkpoint = CheckpointArtifact(block.config_as_str(CHECKPOINT))
        number = block.config_as_int(ENSEMBLE, validator=positive)
        if number < 1:
            return BlockValidation(
                Either.error(BlockValidationError(reason="Ensemble members must be an int, positive and non zero.", is_hard=True))
            )
        model_input = checkpoint.combine_if_nested_qube(checkpoint.get_model_input())
        model_input = expand(model_input, {ENSEMBLE: [number]})

        return BlockValidation(Either.ok(QubedOutput(dataqube=model_input)))

    def compile(  # type:ignore[invalid-argument] # semigroup
        self,
        inputs: ActionLookup,
        block: BlockInstance,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup

        builder = AnemoiBuilder(block.config_as_str(CHECKPOINT))

        action = builder.get_initial_conditions(
            input_source=block.config_as_str(INPUT_SOURCE),
            date=block.config_as_datetime(BASE_TIME),
            ensemble=block.config_as_int(ENSEMBLE, validator=positive),
        )

        return Either.ok(action)


class AnemoiTransform(Transform):
    title: str = "Anemoi Model Transform"
    description: str = "Run an Anemoi model from a prior node"
    inputs: list[str] = ["initial conditions"]

    configuration_options: dict[ConfigurationOptionId, BlockConfigurationOption] = {
        CHECKPOINT: BlockConfigurationOption(
            title="Anemoi Checkpoint",
            description="Anemoi checkpoint name",
            value_type=get_checkpoint_enum_type(),
        ),
        LEAD_TIME: BlockConfigurationOption(
            title="Lead time",
            description="Lead time of the forecast",
            value_type="int",
        ),
    }

    def validate(self, block: BlockInstance, inputs: dict[str, QubedOutput]) -> BlockValidation:
        checkpoint = CheckpointArtifact(block.config_as_str(CHECKPOINT))
        lead_time = block.config_as_int(LEAD_TIME, validator=positive)
        qubed_input = checkpoint.combine_if_nested_qube(checkpoint.get_model_input())
        if not contains(inputs["dataset"], qubed_input):
            difference_qube = qubed_input ^ inputs["dataset"].dataqube
            return BlockValidation(
                Either.error(
                    BlockValidationError(
                        reason=f"Input dataset is not compatible with the model checkpoint. Difference in qubes: {difference_qube}",
                        is_hard=True,
                    )
                )
            )

        validation_error = checkpoint.validate_lead_time(lead_time)
        if validation_error is not None:
            return BlockValidation(Either.error(BlockValidationError(reason=validation_error, is_hard=True)))

        qubed_output = checkpoint.combine_if_nested_qube(checkpoint.get_model_output(lead_time=lead_time))

        input_dataset = inputs["dataset"]
        if contains(input_dataset, ENSEMBLE):
            qubed_output = expand(qubed_output, {ENSEMBLE: axes(input_dataset)[ENSEMBLE]})
        return BlockValidation(Either.ok(QubedOutput(dataqube=qubed_output)))

    def compile(  # type:ignore[invalid-argument] # semigroup
        self,
        inputs: ActionLookup,
        block: BlockInstance,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        input_task = block.input_ids["initial conditions"]

        builder = AnemoiBuilder(block.config_as_str(CHECKPOINT))
        action = builder.from_initial_conditions(
            inputs[input_task],
            lead_time=block.config_as_int(LEAD_TIME, validator=positive),
        )
        return Either.ok(action)

    def intersect(self, other: QubedOutput) -> bool:
        return contains(other, "param")  # Basic check to see if the input contains params, cannot validate further
