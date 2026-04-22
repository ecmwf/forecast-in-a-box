# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""
Declarations related to Artifacts such as ML Model Checkpoints.
"""

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, NewType

from pydantic import BaseModel, Field

# NOTE we may eventually fine-grain this with like cuda versions or architecture etc, form a hierarchy, etc. Or maybe not and this will be enough.
Platform = Literal["macos", "linux"]

MlModelCheckpointId = NewType("MlModelCheckpointId", str)
ArtifactStoreId = NewType("ArtifactStoreId", str)


@dataclass(frozen=True, eq=True, slots=True)
class CompositeArtifactId:
    """Composite identifier for an artifact combining store and checkpoint IDs"""

    artifact_store_id: ArtifactStoreId
    ml_model_checkpoint_id: MlModelCheckpointId

    @classmethod
    def from_str(cls, v: str) -> Self:
        if not ":" in v:
            raise ValueError(f"must be of the form artifact_store_id:ml_model_checkpoint_id, got {v}")
        artifact_store_id, ml_model_checkpoint_id = v.split(":", 1)
        return cls(artifact_store_id=artifact_store_id, ml_model_checkpoint_id=ml_model_checkpoint_id)

    @staticmethod
    def to_str(k: "CompositeArtifactId") -> str:
        return f"{k.artifact_store_id}:{k.ml_model_checkpoint_id}"


class MlModelCheckpoint(BaseModel):
    url: str = Field(
        description="Location such as anemoi catalogue or hugging face registry url. Represents the source url, not an url of a local copy"
    )
    display_name: str = Field(description="Utilized by frontend for listing and picking as input in a job")
    display_author: str = Field(description="Utilized by frontend for displaying author")
    display_description: str = Field(description="Additional info about the model")
    comment: str = Field("", description="Additional internal data at the store level")
    disk_size_bytes: int = Field(description="Physical storage footprint of the checkpoint")
    pip_package_constraints: list[str] = Field(
        description="Pip-compatible constraints for requisite python packages such as torch or anemoi-inference"
    )
    supported_platforms: list[Platform] = Field(
        description="Platforms this model has been tested and verified on"
    )  # Question: or negate, ie, 'unsupported'?
    # NOTE this is provisionary -- maybe we'd have a qubed, maybe a qubed<input> template, maybe nothing
    output_characteristics: list[str] = Field(description="List of variables that the model produces")
    input_characteristics: list[str] = Field(
        description="List of config keys that this model exposes"
    )  # Question: do we want key-values, or just keys and the plugins define values?
    # Question: how would we capture memory requirements? May be tricky since technically its a function of config and backend
    metadata: dict[str, Any] = Field(
        default_factory=dict, description="Additional metadata from the checkpoint, for anemoi this is the raw dump"
    )


CheckpointLookup = Mapping[CompositeArtifactId, MlModelCheckpoint]


class ArtifactsProvider:
    """Singleton provider giving plugins access to artifact management functions.

    The host application registers implementations via `register_*` class methods
    during startup.  Plugins call the plain class methods to invoke them.
    Raises RuntimeError if a method is called before its implementation is registered.
    """

    _get_checkpoint_lookup: Callable[[], CheckpointLookup] | None = None
    _get_artifact_local_path: Callable[[CompositeArtifactId], Path] | None = None

    @classmethod
    def register_get_checkpoint_lookup(cls, fn: Callable[[], CheckpointLookup]) -> None:
        """Register the get_checkpoint_lookup implementation."""
        cls._get_checkpoint_lookup = fn

    @classmethod
    def get_checkpoint_lookup(cls) -> CheckpointLookup:
        """Return a mapping of all known CompositeArtifactId to MlModelCheckpoint."""
        if cls._get_checkpoint_lookup is None:
            raise RuntimeError("ArtifactsProvider.get_checkpoint_lookup has not been registered")
        return cls._get_checkpoint_lookup()

    @classmethod
    def register_get_artifact_local_path(cls, fn: Callable[[CompositeArtifactId], Path]) -> None:
        """Register the get_artifact_local_path implementation (without data_dir — it is bound at registration time)."""
        cls._get_artifact_local_path = fn

    @classmethod
    def get_artifact_local_path(cls, composite_id: CompositeArtifactId) -> Path:
        """Return the local filesystem path for the given artifact."""
        if cls._get_artifact_local_path is None:
            raise RuntimeError("ArtifactsProvider.get_artifact_local_path has not been registered")
        return cls._get_artifact_local_path(composite_id)
