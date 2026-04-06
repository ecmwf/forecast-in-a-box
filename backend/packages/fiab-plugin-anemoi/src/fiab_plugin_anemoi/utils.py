# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import importlib.metadata
import re
from pathlib import Path

from anemoi.inference.metadata import Metadata as InferenceMetadata
from anemoi.inference.metadata import MetadataFactory as InferenceMetadataFactory
from cascade.low.func import Either
from earthkit.workflows.plugins.anemoi.utils import expansion_qube
from fiab_core.artifacts import ArtifactsProvider, CheckpointLookup, CompositeArtifactId
from fiab_core.fable import BlockInstance
from fiab_core.plugin import Error
from fiab_plugin_ecmwf.metadata import QubedInstanceOutput

ENVIRONMENT_PACKAGES: list[str] = [
    "anemoi.models",
    "torch",
    "torch_geometric",
]

all_checkpoints: CheckpointLookup = ArtifactsProvider.get_checkpoint_lookup()
AVAILABLE_CHECKPOINTS: CheckpointLookup = {
    composite_id: checkpoint
    for composite_id, checkpoint in all_checkpoints.items()
    # TODO: Add filtering here
}
CHECKPOINT_ENUM_TYPE = f"enum['{', '.join(CompositeArtifactId.to_str(k) for k in AVAILABLE_CHECKPOINTS.keys())}']"


def get_local_path(composite_id: CompositeArtifactId) -> Path:
    return Path(ArtifactsProvider.get_artifact_local_path(composite_id))


def get_metadata(composite_id: CompositeArtifactId) -> InferenceMetadata:
    checkpoint = AVAILABLE_CHECKPOINTS[composite_id]
    return InferenceMetadataFactory(checkpoint.metadata)


INPUT_SOURCE_EXTRAS: dict[str, str] = {
    "opendata": "anemoi-plugins-ecmwf-inference[opendata]",
    "polytope": "anemoi-plugins-ecmwf-inference[polytope]",
    "mars": "earthkit-data[mars]",
}


def get_environment(composite_id: CompositeArtifactId, input_source: str | None = None) -> list[str]:
    metadata = get_metadata(composite_id)
    training_env = metadata.provenance_training()["module_versions"]

    matched_packages = set()
    for package in ENVIRONMENT_PACKAGES:
        matched_packages.update(re.findall(package, " ".join(training_env.keys())))

    environment = {pkg: training_env[pkg] for pkg in matched_packages}
    # Handle recent utils change where version is now a dict with version
    environment = {key: val if not isinstance(val, dict) else val["version"] for key, val in environment.items()}
    packages = list(f"{key.replace('.', '-')}=={val.split('+')[0]}" for key, val in environment.items())

    if input_source in INPUT_SOURCE_EXTRAS:
        packages.append(INPUT_SOURCE_EXTRAS[input_source])

    packages.append(f"earthkit-workflows-anemoi[runtime]=={importlib.metadata.version('earthkit-workflows-anemoi')}")
    return packages


def validate_anemoi_block(block: BlockInstance) -> Either[QubedInstanceOutput, Error]:  # type:ignore[invalid-argument] # semigroup
    """Validate common Anemoi block configuration, returning the base QubedInstanceOutput on success."""
    if not isinstance(block.configuration_values["checkpoint"], str):
        return Either.error("Checkpoint must be given")

    if not block.configuration_values["lead_time"].isdigit() or int(block.configuration_values["lead_time"]) < 0:  # type: ignore
        return Either.error("Lead time must be an int and non-negative")

    ensemble_members = block.configuration_values.get("ensemble_members")
    if ensemble_members is not None and (not ensemble_members.isdigit() or int(ensemble_members) < 1):  # type: ignore
        return Either.error("Ensemble members must be an int and positive")

    metadata = get_metadata(CompositeArtifactId.from_str(block.configuration_values["checkpoint"]))
    qube = expansion_qube(metadata, block.configuration_values["lead_time"])
    return Either.ok(QubedInstanceOutput(dataqube=qube))
