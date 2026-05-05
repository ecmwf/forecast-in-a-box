# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

from collections.abc import Generator
from pathlib import Path

import pytest

from fiab_core.artifacts import (
    ArtifactLocalId,
    ArtifactResolved,
    ArtifactsLookup,
    ArtifactsProvider,
    ArtifactStoreId,
    CompositeArtifactId,
    MlModelCheckpoint,
)


def _reset_provider() -> None:
    ArtifactsProvider._get_artifacts_lookup = None
    ArtifactsProvider._get_artifact_local_path = None


@pytest.fixture(autouse=True)
def clean_provider() -> Generator[None, None, None]:
    _reset_provider()
    yield
    _reset_provider()


def test_get_artifacts_lookup_raises_before_registration() -> None:
    with pytest.raises(RuntimeError, match="get_artifacts_lookup"):
        ArtifactsProvider.get_artifacts_lookup()


def test_get_artifact_local_path_raises_before_registration() -> None:
    composite_id = CompositeArtifactId(artifact_store_id=ArtifactStoreId("store"), artifact_local_id=ArtifactLocalId("ckpt"))
    with pytest.raises(RuntimeError, match="get_artifact_local_path"):
        ArtifactsProvider.get_artifact_local_path(composite_id)


def test_get_artifacts_lookup_returns_registered_result() -> None:
    checkpoint = MlModelCheckpoint(
        url="http://example.com/model.ckpt",
        display_name="My Model",
        display_author="Author",
        display_description="A model",
        disk_size_bytes=1024,
        pip_package_constraints=[],
        supported_platforms=["linux"],
        input_characteristics=[],
        output_qube={},
        timestep="1h",
        comment="",
    )
    artifact = ArtifactResolved(
        artifact_type="MlModelCheckpoint",
        store_info=checkpoint,
        is_locally_compatible=True,
        local_compatibility_detail=None,
    )
    composite_id = CompositeArtifactId(artifact_store_id=ArtifactStoreId("s"), artifact_local_id=ArtifactLocalId("c"))
    catalog: ArtifactsLookup = {composite_id: artifact}
    ArtifactsProvider.register_get_artifacts_lookup(lambda: catalog)
    result = ArtifactsProvider.get_artifacts_lookup()
    assert result[composite_id] == artifact
    assert result[composite_id].store_info == checkpoint
    assert result[composite_id].is_locally_compatible is True
    assert result[composite_id].local_compatibility_detail is None


def test_get_artifacts_lookup_returns_registered_result_incompatible() -> None:
    """Verifies that incompatible artifacts are stored and returned correctly."""
    checkpoint = MlModelCheckpoint(
        url="http://example.com/model.ckpt",
        display_name="Incompatible Model",
        display_author="Author",
        display_description="A model that is not locally compatible",
        disk_size_bytes=512,
        pip_package_constraints=[],
        supported_platforms=["linux"],
        input_characteristics=[],
        output_qube={},
        timestep="1h",
        comment="",
    )
    artifact = ArtifactResolved(
        artifact_type="MlModelCheckpoint",
        store_info=checkpoint,
        is_locally_compatible=False,
        local_compatibility_detail="Requires CUDA 12, but only CUDA 11 is available",
    )
    composite_id = CompositeArtifactId(artifact_store_id=ArtifactStoreId("s"), artifact_local_id=ArtifactLocalId("incompatible"))
    catalog: ArtifactsLookup = {composite_id: artifact}
    ArtifactsProvider.register_get_artifacts_lookup(lambda: catalog)
    result = ArtifactsProvider.get_artifacts_lookup()
    assert result[composite_id].is_locally_compatible is False
    assert result[composite_id].local_compatibility_detail == "Requires CUDA 12, but only CUDA 11 is available"


def test_get_artifacts_lookup_returns_current_value_of_mutable_source() -> None:
    """Verifies that registering a lambda (not an instance) means callers see mutations."""
    catalog: dict[CompositeArtifactId, ArtifactResolved] = {}
    ArtifactsProvider.register_get_artifacts_lookup(lambda: catalog)
    assert len(ArtifactsProvider.get_artifacts_lookup()) == 0

    checkpoint = MlModelCheckpoint(
        url="http://example.com/model.ckpt",
        display_name="M",
        display_author="A",
        display_description="D",
        disk_size_bytes=0,
        pip_package_constraints=[],
        supported_platforms=[],
        input_characteristics=[],
        output_qube={},
        timestep="1h",
        comment="",
    )
    artifact = ArtifactResolved(
        artifact_type="MlModelCheckpoint",
        store_info=checkpoint,
        is_locally_compatible=True,
        local_compatibility_detail=None,
    )
    catalog[CompositeArtifactId(artifact_store_id=ArtifactStoreId("s"), artifact_local_id=ArtifactLocalId("c"))] = artifact
    assert len(ArtifactsProvider.get_artifacts_lookup()) == 1


def test_get_artifact_local_path_returns_registered_result() -> None:
    base = Path("/data")
    ArtifactsProvider.register_get_artifact_local_path(lambda cid: base / cid.artifact_store_id / cid.artifact_local_id)

    composite_id = CompositeArtifactId(artifact_store_id=ArtifactStoreId("store"), artifact_local_id=ArtifactLocalId("ckpt"))
    assert ArtifactsProvider.get_artifact_local_path(composite_id) == Path("/data/store/ckpt")
