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

from fiab_core.artifacts import AnemoiCheckpoint, ArtifactsProvider, CompositeArtifactId
from fiab_core.fable import QubedOutput
from qubed import Qube

from ..qubed_utils import expand

INPUT_SOURCE_CONFIGURATION_OPTIONS = {"polytope": {"collection": "initial-conditions"}}

logger = logging.getLogger(__name__)


def get_available_checkpoints() -> dict[CompositeArtifactId, AnemoiCheckpoint]:
    all_artifacts = ArtifactsProvider.get_artifacts_lookup()
    return {
        composite_id: artifact.store_info
        for composite_id, artifact in all_artifacts.items()
        if artifact.artifact_type == "AnemoiCheckpoint" and artifact.is_locally_compatible
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
    return f"enumClosed[{values}]"


class CheckpointArtifact:
    """Wrapper around the checkpoint artifact to provide utility methods for accessing the checkpoint data and creating model input configuration."""

    def __init__(self, artifact: CompositeArtifactId | str) -> None:
        self.artifact = CompositeArtifactId.from_str(artifact) if isinstance(artifact, str) else artifact

        if self.artifact not in get_available_checkpoints():
            raise ValueError(f"Unknown checkpoint artifact: {self.artifact!r}")

    def get_local_path(self) -> Path:
        """Get local path to the checkpoint artifact, assumes it is already locally available, does not trigger download"""
        return Path(ArtifactsProvider.get_artifact_local_path(self.artifact))

    def get_model_input(self) -> Qube:
        """Get the model input qube from the checkpoint artifact"""
        checkpoint = get_available_checkpoints()[self.artifact]
        qube = Qube.from_json(checkpoint.input_qube)
        return qube

    def get_input_configuration(self, input_source: str | dict) -> dict[str, dict] | str:
        """Create input configuration for the model based on the checkpoint artifact and input source."""
        checkpoint = get_available_checkpoints()[self.artifact]

        if checkpoint.input_options is None:
            return input_source

        if not isinstance(input_source, dict):
            input_source = {input_source: {}}

        input_source = {**input_source}  # shallow copy to avoid mutating the original
        if next(iter(input_source.keys())) in INPUT_SOURCE_CONFIGURATION_OPTIONS:
            input_source[next(iter(input_source.keys()))].update(INPUT_SOURCE_CONFIGURATION_OPTIONS[next(iter(input_source.keys()))])

        input_source.update(**checkpoint.input_options)
        return input_source

    def get_model_output(self, lead_time: int) -> QubedOutput:
        """Get the model output qube from the checkpoint artifact"""
        checkpoint = get_available_checkpoints()[self.artifact]
        qube = Qube.from_json(checkpoint.output_qube)

        from earthkit.data.utils.dates import to_timedelta

        lead_time_seconds = lead_time * 3600
        model_step_seconds = int(to_timedelta(checkpoint.timestep).total_seconds())
        steps = list(map(lambda x: x // 3600, range(model_step_seconds, lead_time_seconds + model_step_seconds, model_step_seconds)))

        qubeoutput = QubedOutput(dataqube=qube)
        return expand(qubeoutput, {"step": steps})

    def get_environment(self) -> list[str]:
        """Get the environment for the model based on the checkpoint artifact and input source."""
        packages = list(get_available_checkpoints()[self.artifact].pip_package_constraints)

        ekw_anemoi_version = importlib.metadata.version("earthkit-workflows-anemoi")
        from fiab_core.tools.plugins import _detect_editable_install

        if not "dev" in ekw_anemoi_version:
            editable = _detect_editable_install(f"earthkit-workflows-anemoi")
            if not editable.startswith("-e "):
                editable = f"earthkit-workflows-anemoi=={ekw_anemoi_version}"
            packages.append(editable)
        return packages
