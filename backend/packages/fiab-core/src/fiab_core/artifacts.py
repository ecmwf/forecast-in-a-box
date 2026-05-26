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
from typing import Any, Literal, NewType, Self

from pydantic import Field

from fiab_core.pydantic_utils import FiabCoreBaseModel

# NOTE we may eventually fine-grain this with like cuda versions or architecture etc, form a hierarchy, etc. Or maybe not and this will be enough.
Platform = Literal["macos", "linux"]

ArtifactLocalId = NewType("ArtifactLocalId", str)
ArtifactStoreId = NewType("ArtifactStoreId", str)
ArtifactType = Literal["AnemoiCheckpoint"]


@dataclass(frozen=True, eq=True, slots=True)
class CompositeArtifactId:
    """Composite identifier for an artifact combining store and local IDs"""

    artifact_store_id: ArtifactStoreId
    artifact_local_id: ArtifactLocalId

    @classmethod
    def from_str(cls, v: str) -> Self:
        if not ":" in v:
            raise ValueError(f"must be of the form artifact_store_id:ml_model_checkpoint_id, got {v}")
        artifact_store_id, artifact_local_id = v.split(":", 1)
        return cls(artifact_store_id=ArtifactStoreId(artifact_store_id), artifact_local_id=ArtifactLocalId(artifact_local_id))

    @staticmethod
    def to_str(k: Self) -> str:
        return f"{k.artifact_store_id}:{k.artifact_local_id}"


class AnemoiCheckpoint(FiabCoreBaseModel):
    url: str = Field(
        description="Location such as anemoi catalogue or hugging face registry url. Represents the source url, not an url of a local copy"
    )
    display_name: str = Field(description="Utilized by frontend for listing and picking as input in a job")
    display_author: str = Field(description="Utilized by frontend for displaying author")
    display_description: str = Field(description="Additional info about the model")
    comment: str = Field("", description="Additional internal data at the store level")
    disk_size_bytes: int = Field(description="Physical storage footprint of the checkpoint")
    minimum_gpu_memory_mib: int | None = Field(
        default=None, description="If this model *requires* gpu, then what is the minimum realistic size in MiB"
    )
    pip_package_constraints: list[str] = Field(
        description="Pip-compatible constraints for requisite python packages such as torch or anemoi-inference"
    )
    supported_platforms: list[Platform] = Field(
        description="Platforms this model has been tested and verified on"
    )  # Question: or negate, ie, 'unsupported'?

    input_characteristics: list[str] = Field(
        description="List of config keys that this model exposes"
    )  # Question: do we want key-values, or just keys and the plugins define values?
    # Question: how would we capture memory requirements? May be tricky since technically its a function of config and backend

    input_qube: dict[str, Any] = Field(description="Json Dump of the input qube structure, including variables, levels")
    output_qube: dict[str, Any] = Field(description="Json Dump of the output qube structure, including variables, levels, but not step")

    input_options: dict[str, Any] = Field(
        default_factory=dict,
        description="Additional options related to the input source, e.g. for polytope collection or mars requests. This is a free-form dict since it will likely be very different between plugins and we want to allow flexibility here.",
    )
    timestep: str = Field(description="Timestep of the model output, e.g. '1h', '6h'")


@dataclass
class ArtifactResolved:
    """A combination of info from the store and locally gathered compatibility information"""

    artifact_type: ArtifactType  # determines the store_info class
    store_info: AnemoiCheckpoint  # NOTE this will eventually be a union
    is_locally_compatible: bool
    local_compatibility_detail: str | None


ArtifactsLookup = Mapping[CompositeArtifactId, ArtifactResolved]


class ArtifactsProvider:
    """Singleton provider giving plugins access to artifact management functions.

    The host application registers implementations via `register_*` class methods
    during startup.  Plugins call the plain class methods to invoke them.
    Raises RuntimeError if a method is called before its implementation is registered.
    """

    _get_artifacts_lookup: Callable[[], ArtifactsLookup] | None = None
    _get_artifact_local_path: Callable[[CompositeArtifactId], Path] | None = None

    @classmethod
    def register_get_artifacts_lookup(cls, fn: Callable[[], ArtifactsLookup]) -> None:
        """Register the get_artifacts_lookup implementation."""
        cls._get_artifacts_lookup = fn

    @classmethod
    def get_artifacts_lookup(cls) -> ArtifactsLookup:
        """Return a mapping of all known CompositeArtifactId to ArtifactResolved."""
        if cls._get_artifacts_lookup is None:
            raise RuntimeError("ArtifactsProvider.get_artifacts_lookup has not been registered")
        return cls._get_artifacts_lookup()

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
