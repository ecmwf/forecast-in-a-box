# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import importlib.metadata
import logging
from pathlib import Path

from cascade.low.func import Either
from fiab_core.artifacts import ArtifactsProvider, CheckpointLookup, CompositeArtifactId
from fiab_core.fable import BlockInstance, QubedOutput
from fiab_core.plugin import Error
from qubed import Qube

from ..qubed_utils import expand

logger = logging.getLogger(__name__)


def get_available_checkpoints() -> CheckpointLookup:
    all_checkpoints: CheckpointLookup = ArtifactsProvider.get_checkpoint_lookup()
    return {
        composite_id: checkpoint
        for composite_id, checkpoint in all_checkpoints.items()
        # TODO: Add filtering here
    }


def get_checkpoint_enum_type() -> str:
    try:
        available_checkpoints = get_available_checkpoints()
    except Exception as e:
        logger.error(f"Error fetching available checkpoints: {e}")
        return "str"
    if not available_checkpoints:
        return "str"
    values = ", ".join(f"'{CompositeArtifactId.to_str(k)}'" for k in available_checkpoints.keys())
    return f"enum[{values}]"


def get_local_path(composite_id: CompositeArtifactId) -> Path:
    return Path(ArtifactsProvider.get_artifact_local_path(composite_id))


def get_model_output(composite_id: CompositeArtifactId, lead_time: int) -> QubedOutput:
    checkpoint = get_available_checkpoints()[composite_id]
    qube = Qube.from_json(checkpoint.output_qube)

    from earthkit.data.utils.dates import to_timedelta

    lead_time_seconds = lead_time * 3600
    model_step_seconds = int(to_timedelta(checkpoint.timestep).total_seconds())
    steps = list(map(lambda x: x // 3600, range(model_step_seconds, lead_time_seconds + model_step_seconds, model_step_seconds)))

    qubeoutput = QubedOutput(dataqube=qube)
    return expand(qubeoutput, {"step": steps})


def get_environment(composite_id: CompositeArtifactId) -> list[str]:
    packages = list(get_available_checkpoints()[composite_id].pip_package_constraints)

    ekw_anemoi_version = importlib.metadata.version("earthkit-workflows-anemoi")
    if not "dev" in ekw_anemoi_version:
        packages.append(f"earthkit-workflows-anemoi[runtime-inference]=={importlib.metadata.version('earthkit-workflows-anemoi')}")

    return packages


def validate_anemoi_block(block: BlockInstance) -> Either[QubedOutput, Error]:  # type:ignore[invalid-argument] # semigroup
    """Validate common Anemoi block configuration, returning the base QubedOutput on success."""
    if not block.configuration_values["checkpoint"]:
        return Either.error("Checkpoint must be given")

    if not block.configuration_values["lead_time"].isdigit():  # type: ignore
        return Either.error("Lead time must be a non-negative integer")

    ensemble_members = block.configuration_values.get("ensemble_members")
    if ensemble_members is not None and (not ensemble_members.isdigit() or int(ensemble_members) < 1):  # type: ignore
        return Either.error("Ensemble members must be an int and positive")

    checkpoint = block.configuration_values["checkpoint"]
    try:
        composite_id = CompositeArtifactId.from_str(checkpoint)
    except ValueError:
        return Either.error("Checkpoint must be a valid checkpoint identifier")

    try:
        return Either.ok(get_model_output(composite_id, int(block.configuration_values["lead_time"])))
    except KeyError:
        return Either.error(f"Unknown checkpoint: {checkpoint}")
