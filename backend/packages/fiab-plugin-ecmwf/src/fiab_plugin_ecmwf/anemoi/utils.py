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
from typing import Any

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

    def checkpoint(self) -> AnemoiCheckpoint:
        """Get the AnemoiCheckpoint artifact from the artifact store."""
        available_checkpoints = get_available_checkpoints()
        if self.artifact not in available_checkpoints:
            raise ValueError(
                f"Checkpoint artifact {CompositeArtifactId.to_str(self.artifact)} not found in available checkpoints: {[CompositeArtifactId.to_str(k) for k in available_checkpoints.keys()]}"
            )
        return available_checkpoints[self.artifact]

    def get_local_path(self) -> Path:
        """Get local path to the checkpoint artifact, assumes it is already locally available, does not trigger download"""
        return Path(ArtifactsProvider.get_artifact_local_path(self.artifact))

    def get_model_input(self) -> Qube:
        """Get the model input qube from the checkpoint artifact"""
        checkpoint = self.checkpoint()
        return Qube.from_json(checkpoint.input_qube)

    def get_model_output(self, lead_time: int) -> QubedOutput:
        """Get the model output qube from the checkpoint artifact"""
        checkpoint = self.checkpoint()
        qube = Qube.from_json(checkpoint.output_qube)

        from earthkit.data.utils.dates import to_timedelta

        lead_time_seconds = lead_time * 3600
        model_step_seconds = int(to_timedelta(checkpoint.timestep).total_seconds())
        steps = list(map(lambda x: x // 3600, range(model_step_seconds, lead_time_seconds + model_step_seconds, model_step_seconds)))

        qubeoutput = QubedOutput(dataqube=qube)
        return expand(qubeoutput, {"step": steps})

    def get_additional_kwargs(self) -> dict[str, Any]:
        """Get additional kwargs for the model inference from the checkpoint artifact, such as post processors and control options."""
        checkpoint = self.checkpoint()
        configuration = checkpoint.configuration

        post_processors = []
        if configuration.post_processors is not None:
            post_processors.extend(configuration.post_processors)

        # Add post processor to extract region of interest for nested models with cutout input
        if configuration.nested_model:
            if configuration.region_of_interest is None:
                raise ValueError("Nested models must specify a region of interest in the checkpoint configuration")
            if not configuration.input_options or not isinstance(configuration.input_options, list):
                raise ValueError(
                    "Nested models must specify input options as a list of region configurations in the checkpoint configuration"
                )
            if not configuration.region_of_interest in [next(iter(region.keys())) for region in configuration.input_options]:
                raise ValueError(
                    f"Region of interest {configuration.region_of_interest} must be one of the regions specified in input options {[next(iter(region.keys())) for region in configuration.input_options]}"
                )
            post_processors.append({"extract_from_state": configuration.region_of_interest})

        return {
            "post_processors": post_processors,
            "env": configuration.control_options or {},
        }

    def get_input_configuration(self, input_source: str | dict) -> dict[str, dict] | str:
        """Create input configuration for the model based on the checkpoint artifact and input source."""
        checkpoint = self.checkpoint()
        configuration = checkpoint.configuration
        if not isinstance(input_source, dict):
            input_source = {input_source: {}}
        elif len(input_source) != 1:
            raise ValueError(f"Input source must have exactly one key representing the source name, got {input_source}")

        source_name = next(iter(input_source.keys()))

        input_source = {**input_source}  # shallow copy to avoid mutating the original
        if source_name in INPUT_SOURCE_CONFIGURATION_OPTIONS:
            input_source[source_name].update(INPUT_SOURCE_CONFIGURATION_OPTIONS[source_name])

        if configuration.pre_processors is not None:
            input_source[source_name].setdefault("pre_processors", []).extend(configuration.pre_processors)

        if configuration.input_options is None:
            return input_source
        elif isinstance(configuration.input_options, dict):
            input_source.update(**configuration.input_options)
            return input_source
        # Input options is a list, which implies cutout input
        if not configuration.nested_model:
            raise ValueError("Cutout input configuration is only supported for nested models")

        # Input options is a named set of configurations for sub-inputs
        regions = configuration.input_options
        cutout_input_configuration: dict[str, dict[str, Any]] = {}

        for region_config in regions:
            if len(region_config) != 1:
                raise ValueError(f"Each region config must have exactly one key representing the region name, got {region_config}")
            region_name = next(iter(region_config.keys()))
            region_config = region_config[region_name]

            cutout_input_configuration[region_name] = input_source.copy()  # First set to user defined input config, i.e source
            cutout_input_configuration[region_name][source_name].update(
                region_config
            )  # Then override with region specific config from the checkpoint

        return input_source

    def get_environment(self) -> list[str]:
        """Get the environment for the model based on the checkpoint artifact and input source."""
        checkpoint = self.checkpoint()
        packages = list(checkpoint.pip_package_constraints)

        ekw_anemoi_version = importlib.metadata.version("earthkit-workflows-anemoi")
        from fiab_core.tools.plugins import _detect_editable_install

        if not "dev" in ekw_anemoi_version:
            editable = _detect_editable_install(f"earthkit-workflows-anemoi")
            if not editable.startswith("-e "):
                editable = f"earthkit-workflows-anemoi=={ekw_anemoi_version}"
            packages.append(editable)
        return packages
