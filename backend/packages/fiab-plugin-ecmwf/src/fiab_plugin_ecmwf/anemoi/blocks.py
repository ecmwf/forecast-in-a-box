# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.


from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from cascade.low.func import Either
from earthkit.workflows.fluent import Action
from earthkit.workflows.metadata import Artifacts
from earthkit.workflows.nodetree import nodetree_arrays, nodetree_dimensions, nodetree_from_dict
from earthkit.workflows.plugins.anemoi.fluent import Inference, get_initial_conditions  # ty: ignore[unresolved-import]
from fiab_core.artifacts import CompositeArtifactId
from fiab_core.fable import (
    ActionLookup,
    BlockConfigurationOption,
    BlockInstanceOutput,
    ConfigurationOptionId,
    ConfigurationOptionRestriction,
    QubedOutput,
)
from fiab_core.plugin import Error
from fiab_core.tools.blocks import BlockInstanceRich, Source, Transform
from fiab_core.types import DatetimeType, IntType, ListType, OpenEnumType
from fiab_core.types.traits import DivisibleBy, NonNegative, Positive
from qubed import Qube
from qubed.value_types import QEnum

from fiab_plugin_ecmwf.constants import (
    BASE_TIME,
    CHECKPOINT,
    DATE,
    ENSEMBLE,
    INPUT_SOURCE,
    LEAD_TIME,
    TIME,
)
from fiab_plugin_ecmwf.qubed_utils import axes, contains, expand

from .utils import CheckpointArtifact, get_available_input_sources, get_checkpoint_enum_type, get_input_source_extras


def strip_timezone(dt: datetime) -> datetime:
    if dt.tzinfo is not None:
        return dt.astimezone(tz=UTC).replace(tzinfo=None)
    return dt


class AnemoiBuilder:
    """Utility to build an Inference from an Anemoi checkpoint, for use in both Source and Transform blocks"""

    def __init__(self, checkpoint: CompositeArtifactId) -> None:
        self.checkpoint = CheckpointArtifact(checkpoint)
        self.artifact_id = self.checkpoint.artifact

    @property
    def _local_path(self) -> Path:
        "Get local path to the checkpoint artifact, assumes it is already locally available, does not trigger download"
        return self.checkpoint.get_local_path()

    def _add_extra_output_keys(self, action: Action) -> Action:
        """Add supplementary metadata from the checkpoint to the action.

        Must be added to the action to ensure at compilation time that the metadata is available.
        """
        for key, values in self.checkpoint.extra_output_keys.items():
            action.set_scalar_coords({key: values})

        if "paramId" in nodetree_dimensions(action.nodes):
            # Rename paramId axis to param in the action
            action = type(action)(
                nodetree_from_dict(
                    {
                        path: array.rename({"paramId": "param"}).assign_coords(
                            {"param": [str(x) for x in array.coords["paramId"].data.tolist()]}
                        )
                        for path, array in nodetree_arrays(action.nodes)
                    }
                )
            )
        return action

    def inference(self, lead_time: int, *, extra_environment: list[str] | None = None) -> Inference:
        """Build an Inference action for this checkpoint and lead time, with the appropriate environment for the input source if specified"""
        env = self.checkpoint.get_environment()
        env.extend(extra_environment or [])

        # Convert param to paramId for expansion
        checkpoint_output = self.checkpoint.get_model_output(lead_time=lead_time)

        def _param_to_paramId(node: Qube) -> None:
            if node.key == "param":
                node.key = "paramId"
                node.values = QEnum([int(x) for x in node.values])

        checkpoint_output.walk(_param_to_paramId)

        return Inference(
            ckpt=self._local_path,
            lead_time=lead_time,
            environment=env,
            expansion_qube=checkpoint_output,
            **self.checkpoint.get_additional_kwargs(),
        )

    def _ensemble_members(self, ensemble: list[int] | None) -> list[int] | None:
        """Members to pass to earthkit-workflows-anemoi, depending on the model type

        Only ensemble models run members, defaulting to the control member 0 when none are given. Non-ensemble and
        unknown models run deterministically, which is requested with `None`.
        """
        if self.checkpoint.is_ensemble_model is True:
            return list(ensemble) if ensemble else [0]
        return None

    def from_input(self, input_source: str, date: datetime, lead_time: int, ensemble: list[int] | None = None, **k: Any) -> Action:
        input_configuration = self.checkpoint.get_input_configuration(input_source)
        action = self.inference(lead_time=lead_time, extra_environment=get_input_source_extras(input_source)).from_input(
            input=input_configuration,
            date=strip_timezone(date),
            lead_time=lead_time,
            ensemble_members=self._ensemble_members(ensemble),
            artifacts=Artifacts(artifact_urls={CompositeArtifactId.to_str(self.artifact_id): self.checkpoint.get_url()}),
            **k,
        )
        return self._add_extra_output_keys(action)

    def from_initial_conditions(self, initial_conditions: Any, lead_time: int, **k: Any) -> Action:
        action = self.inference(lead_time=lead_time).from_initial_conditions(
            initial_conditions,
            **k,
            artifacts=Artifacts(artifact_urls={CompositeArtifactId.to_str(self.artifact_id): self.checkpoint.get_url()}),
        )
        return self._add_extra_output_keys(action)

    def get_initial_conditions(self, input_source: str, date: datetime, ensemble: list[int] | None = None, **k: Any) -> Action:
        env = self.checkpoint.get_environment()
        env.extend(get_input_source_extras(input_source))

        return get_initial_conditions(
            ckpt=self._local_path,
            input=self.checkpoint.get_input_configuration(input_source),
            date=strip_timezone(date),
            environment=env,
            ensemble_members=self._ensemble_members(ensemble),
            artifacts=Artifacts(artifact_urls={CompositeArtifactId.to_str(self.artifact_id): self.checkpoint.get_url()}),
            **k,
            **self.checkpoint.get_additional_kwargs(),
        )


class AnemoiBaseBlock:
    """Base class for Anemoi blocks that run a model, providing common validation and restriction logic"""

    def validate_lead_time(self, checkpoint: CheckpointArtifact, lead_time: int) -> None:
        """Validate the lead time configuration option against the checkpoint properties"""
        validation_error = checkpoint.validate_lead_time(lead_time)
        if validation_error is not None:
            raise ValueError(validation_error)

    def get_ensemble_members(self, block: BlockInstanceRich) -> list[int]:
        """The ensemble members requested in the block configuration, empty if none (or the option is absent)"""
        if ENSEMBLE not in block.block.configuration_values:
            return []
        return block.config_as_list(ENSEMBLE, int, allow_empty=True)

    def validate_ensemble(self, checkpoint: CheckpointArtifact, ensemble_members: list[int]) -> None:
        """Validate the ensemble configuration option against the checkpoint properties

        Ensemble models accept any member ids, or none to run the control member. Non-ensemble and unknown models run
        deterministically, so cannot be given members.
        """
        if checkpoint.is_ensemble_model is True or not ensemble_members:
            return
        reason = "not an ensemble model" if checkpoint.is_ensemble_model is False else "not known to be an ensemble model"
        raise ValueError(
            f"Checkpoint {checkpoint.artifact} is {reason}, so ensemble members cannot be set, but {ensemble_members} were requested. "
            "Leave the ensemble members empty."
        )

    def resolve_ensemble(self, checkpoint: CheckpointArtifact, ensemble_members: list[int]) -> list[int]:
        """The members that are actually run: ensemble models run the control member 0 if none are requested"""
        if checkpoint.is_ensemble_model is True and not ensemble_members:
            return [0]
        return ensemble_members

    def add_restrictions(self, checkpoint: CheckpointArtifact, restrictions: ConfigurationOptionRestriction) -> None:
        """Add restrictions to the block configuration options based on the checkpoint properties"""
        restrictions[LEAD_TIME] = IntType(traits=DivisibleBy(checkpoint.model_step))

    def _expand_ensemble(
        self, checkpoint: CheckpointArtifact, qube: Qube, ensemble_members: list[int] | None, preserve_members: bool = False
    ) -> Qube:
        """Add the `number` axis for the given members, if any

        By default only ensemble models get the axis. With `preserve_members` the members are added whatever the model
        type, for blocks that keep the members of their initial conditions.
        """
        if (preserve_members or checkpoint.is_ensemble_model is True) and ensemble_members:
            return expand(qube, {ENSEMBLE: sorted(ensemble_members)})
        return qube

    def get_input_qube(
        self, checkpoint: CheckpointArtifact, ensemble_members: list[int] | None = None, base_time: datetime | None = None
    ) -> QubedOutput:
        """Get the input qube for the given checkpoint and ensemble members"""
        qubed_input = checkpoint.combine_if_nested_qube(checkpoint.get_model_input())

        if base_time is not None:
            datetime = strip_timezone(base_time)
            qubed_input = expand(
                qubed_input,
                {
                    DATE: [datetime.date().strftime("%Y%m%d")],
                    TIME: [datetime.time().strftime("%H%M")],
                },
            )

        return QubedOutput(dataqube=self._expand_ensemble(checkpoint, qubed_input, ensemble_members))

    def get_output_qube(
        self,
        checkpoint: CheckpointArtifact,
        lead_time: int,
        ensemble_members: list[int] | None = None,
        base_time: datetime | None = None,
        preserve_members: bool = False,
    ) -> QubedOutput:
        """Get the output qube for the given checkpoint, lead time, and ensemble members"""
        qubed_output = checkpoint.combine_if_nested_qube(checkpoint.get_model_output(lead_time))

        # Ensure alignment in output qube and action metadata
        qubed_output = expand(qubed_output, {key: [value] for key, value in checkpoint.extra_output_keys.items()})

        if base_time is not None:
            datetime = strip_timezone(base_time)
            qubed_output = expand(
                qubed_output,
                {
                    DATE: [datetime.date().strftime("%Y%m%d")],
                    TIME: [datetime.time().strftime("%H%M")],
                },
            )

        return QubedOutput(dataqube=self._expand_ensemble(checkpoint, qubed_output, ensemble_members, preserve_members))


class AnemoiSource(Source, AnemoiBaseBlock):
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
            value_type=OpenEnumType(list(get_available_input_sources())),
            default_value="opendata",
        ),
        LEAD_TIME: BlockConfigurationOption(
            title="Lead time",
            description="Lead time of the forecast",
            value_type=IntType(traits=Positive()),
        ),
        BASE_TIME: BlockConfigurationOption(
            title="Base time",
            description="Base time of the forecast",
            value_type=DatetimeType(),
        ),
        ENSEMBLE: BlockConfigurationOption(
            title="Ensemble members",
            description=(
                "IDs of the ensemble members to run, for ensemble models only. Leave empty to run the control forecast (member 0)"
                " of an ensemble model. Models that are not ensembles cannot be given members."
            ),
            value_type=ListType(IntType(traits=NonNegative())),
            default_value="",
        ),
    }

    def validate(
        self, block: BlockInstanceRich, inputs: dict[str, QubedOutput], restrictions: ConfigurationOptionRestriction
    ) -> BlockInstanceOutput:
        ensemble_members = self.get_ensemble_members(block)
        checkpoint = CheckpointArtifact(block.config_as_artifactid(CHECKPOINT))
        lead_time = block.config_as_int(LEAD_TIME)
        base_time = block.config_as_datetime(BASE_TIME)

        self.validate_lead_time(checkpoint, lead_time)
        self.validate_ensemble(checkpoint, ensemble_members)
        self.add_restrictions(checkpoint, restrictions)

        return self.get_output_qube(checkpoint, lead_time, self.resolve_ensemble(checkpoint, ensemble_members), base_time=base_time)

    def compile(  # type:ignore[invalid-argument] # semigroup
        self,
        inputs: ActionLookup,
        block: BlockInstanceRich,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup

        input_source = block.config_as_str(INPUT_SOURCE)
        builder = AnemoiBuilder(block.config_as_artifactid(CHECKPOINT))

        datetime = strip_timezone(block.config_as_datetime(BASE_TIME))
        action = builder.from_input(
            input_source=input_source,
            lead_time=block.config_as_int(LEAD_TIME),
            date=datetime,
            ensemble=self.get_ensemble_members(block),
        )
        action.set_scalar_coords(
            {
                DATE: datetime.date().strftime("%Y%m%d"),
                TIME: datetime.time().strftime("%H%M"),
            },
            override=True,
        )
        return Either.ok(action)


class AnemoiInputSource(Source, AnemoiBaseBlock):
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
            value_type=OpenEnumType(list(get_available_input_sources())),
            default_value="opendata",
        ),
        BASE_TIME: BlockConfigurationOption(
            title="Base time",
            description="Base time of the forecast",
            value_type=DatetimeType(),
        ),
        ENSEMBLE: BlockConfigurationOption(
            title="Ensemble members",
            description=(
                "IDs of the ensemble members to run, for ensemble models only. Leave empty to run the control forecast (member 0)"
                " of an ensemble model. Models that are not ensembles cannot be given members."
            ),
            value_type=ListType(IntType(traits=NonNegative())),
            default_value="",
        ),
    }

    def validate(
        self, block: BlockInstanceRich, inputs: dict[str, QubedOutput], restrictions: ConfigurationOptionRestriction
    ) -> BlockInstanceOutput:
        checkpoint = CheckpointArtifact(block.config_as_artifactid(CHECKPOINT))
        ensemble_members = self.get_ensemble_members(block)
        base_time = block.config_as_datetime(BASE_TIME)

        self.validate_ensemble(checkpoint, ensemble_members)
        return self.get_input_qube(checkpoint, self.resolve_ensemble(checkpoint, ensemble_members), base_time=base_time)

    def compile(  # type:ignore[invalid-argument] # semigroup
        self,
        inputs: ActionLookup,
        block: BlockInstanceRich,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup

        builder = AnemoiBuilder(block.config_as_artifactid(CHECKPOINT))

        base_time = strip_timezone(block.config_as_datetime(BASE_TIME))
        action = builder.get_initial_conditions(
            input_source=block.config_as_str(INPUT_SOURCE),
            date=base_time,
            ensemble=self.get_ensemble_members(block),
        )
        action.set_scalar_coords(
            {
                DATE: base_time.date().strftime("%Y%m%d"),
                TIME: base_time.time().strftime("%H%M"),
            },
            override=True,
        )
        return Either.ok(action)


class AnemoiTransform(Transform, AnemoiBaseBlock):
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
            value_type=IntType(traits=Positive()),
        ),
    }

    def validate(
        self, block: BlockInstanceRich, inputs: dict[str, QubedOutput], restrictions: ConfigurationOptionRestriction
    ) -> BlockInstanceOutput:
        checkpoint = CheckpointArtifact(block.config_as_artifactid(CHECKPOINT))
        lead_time = block.config_as_int(LEAD_TIME)
        qubed_input = checkpoint.combine_if_nested_qube(checkpoint.get_model_input())

        if not "initial conditions" in inputs:
            raise ValueError("Missing 'initial conditions' for AnemoiTransform block")

        if not contains(inputs["initial conditions"], qubed_input):
            difference_qube = qubed_input ^ inputs["initial conditions"].dataqube
            raise ValueError(f"Input dataset is not compatible with the model checkpoint. Difference in qubes: {difference_qube}")

        input_dataset = inputs["initial conditions"]
        ensemble_members = sorted(int(x) for x in axes(input_dataset).get(ENSEMBLE, set()))
        dates = sorted(axes(input_dataset).get(DATE, set()))
        times = sorted(axes(input_dataset).get(TIME, set()))
        base_time = datetime.strptime(f"{dates[0]}{times[0]}", "%Y%m%d%H%M") if dates and times else None

        self.validate_lead_time(checkpoint, lead_time)
        # The members are those of the initial conditions, which the model runs on whatever its type, so they are not
        # validated against the model type and the output keeps exactly the upstream `number` axis (if any)
        restrictions[LEAD_TIME] = IntType(traits=DivisibleBy(checkpoint.model_step))

        return self.get_output_qube(checkpoint, lead_time, ensemble_members, base_time=base_time, preserve_members=True)

    def compile(  # type:ignore[invalid-argument] # semigroup
        self,
        inputs: ActionLookup,
        block: BlockInstanceRich,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        input_task = block.input_ids["initial conditions"]

        builder = AnemoiBuilder(block.config_as_artifactid(CHECKPOINT))
        action = builder.from_initial_conditions(
            inputs[input_task],
            lead_time=block.config_as_int(LEAD_TIME),
        )
        return Either.ok(action)

    def intersect(self, other: QubedOutput) -> bool:
        return contains(other, "param")  # Basic check to see if the input contains params, cannot validate further
