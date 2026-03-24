# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

from pathlib import Path

import pytest

from fiab_core.artifacts import CheckpointLookup, CompositeArtifactId, MlModelCheckpoint
from fiab_core.providers import ArtifactsProvider


def _reset_provider() -> None:
    ArtifactsProvider._get_checkpoint_lookup = None
    ArtifactsProvider._get_artifact_local_path = None


@pytest.fixture(autouse=True)
def clean_provider():
    _reset_provider()
    yield
    _reset_provider()


def test_get_checkpoint_lookup_raises_before_registration():
    with pytest.raises(RuntimeError, match="get_checkpoint_lookup"):
        ArtifactsProvider.get_checkpoint_lookup()


def test_get_artifact_local_path_raises_before_registration():
    composite_id = CompositeArtifactId(artifact_store_id="store", ml_model_checkpoint_id="ckpt")
    with pytest.raises(RuntimeError, match="get_artifact_local_path"):
        ArtifactsProvider.get_artifact_local_path(composite_id)


def test_get_checkpoint_lookup_returns_registered_result():
    checkpoint = MlModelCheckpoint(
        url="http://example.com/model.ckpt",
        display_name="My Model",
        display_author="Author",
        display_description="A model",
        disk_size_bytes=1024,
        pip_package_constraints=[],
        supported_platforms=["linux"],
        output_characteristics=[],
        input_characteristics=[],
    )
    composite_id = CompositeArtifactId(artifact_store_id="s", ml_model_checkpoint_id="c")
    catalog: CheckpointLookup = {composite_id: checkpoint}
    ArtifactsProvider.register_get_checkpoint_lookup(lambda: catalog)
    result = ArtifactsProvider.get_checkpoint_lookup()
    assert result[composite_id] == checkpoint


def test_get_checkpoint_lookup_returns_current_value_of_mutable_source():
    """Verifies that registering a lambda (not an instance) means callers see mutations."""
    catalog: dict[CompositeArtifactId, MlModelCheckpoint] = {}
    ArtifactsProvider.register_get_checkpoint_lookup(lambda: catalog)
    assert len(ArtifactsProvider.get_checkpoint_lookup()) == 0

    checkpoint = MlModelCheckpoint(
        url="http://example.com/model.ckpt",
        display_name="M",
        display_author="A",
        display_description="D",
        disk_size_bytes=0,
        pip_package_constraints=[],
        supported_platforms=[],
        output_characteristics=[],
        input_characteristics=[],
    )
    catalog[CompositeArtifactId(artifact_store_id="s", ml_model_checkpoint_id="c")] = checkpoint
    assert len(ArtifactsProvider.get_checkpoint_lookup()) == 1


def test_get_artifact_local_path_returns_registered_result():
    base = Path("/data")
    ArtifactsProvider.register_get_artifact_local_path(lambda cid: base / cid.artifact_store_id / cid.ml_model_checkpoint_id)

    composite_id = CompositeArtifactId(artifact_store_id="store", ml_model_checkpoint_id="ckpt")
    assert ArtifactsProvider.get_artifact_local_path(composite_id) == Path("/data/store/ckpt")
