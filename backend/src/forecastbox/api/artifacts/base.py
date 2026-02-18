# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""
Base definitions pertaining to artifacts such as ml model checkpoints
"""

from dataclasses import dataclass
from pathlib import Path

from fiab_core.artifacts import MlModelCheckpoint, MlModelCheckpointId, Platform

from forecastbox.config import ArtifactStoreId


@dataclass(frozen=True, eq=True, slots=True)
class CompositeArtifactId:
    """Composite identifier for an artifact combining store and checkpoint IDs"""

    artifact_store_id: ArtifactStoreId
    ml_model_checkpoint_id: MlModelCheckpointId


@dataclass(frozen=True, eq=True, slots=True)
class MlModelOverview:
    """Overview information for listing ML models"""

    composite_id: CompositeArtifactId
    display_name: str
    display_author: str
    disk_size_bytes: int
    supported_platforms: list[Platform]
    is_available: bool


@dataclass(frozen=True, eq=True, slots=True)
class MlModelDetail:
    """Detailed information for a specific ML model (excludes comment field)"""

    composite_id: CompositeArtifactId
    display_name: str
    display_author: str
    display_description: str
    url: str
    disk_size_bytes: int
    pip_package_constraints: list[str]
    supported_platforms: list[Platform]
    output_characteristics: list[str]
    input_characteristics: list[str]
    is_available: bool


ArtifactCatalog = dict[CompositeArtifactId, MlModelCheckpoint]

artifacts_subdir = "artifacts"


def get_artifact_local_path(composite_id: CompositeArtifactId, data_dir: Path) -> Path:
    """Get the local filesystem path for an artifact file, raising ValueError if the composite ID contains invalid path characters.
    The Path is not checked for existence, only for validity (ie invalid chars)"""
    store_id = composite_id.artifact_store_id
    checkpoint_id = composite_id.ml_model_checkpoint_id

    invalid_chars = {"..", "/", "\\", "\0"}
    if any(char in store_id for char in invalid_chars) or any(char in checkpoint_id for char in invalid_chars):
        raise ValueError(f"Invalid characters in artifact ID: {composite_id}")

    artifact_path = data_dir / artifacts_subdir / store_id / checkpoint_id

    return artifact_path
