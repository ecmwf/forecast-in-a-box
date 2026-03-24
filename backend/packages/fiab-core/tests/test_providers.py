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

from fiab_core.artifacts import CompositeArtifactId, MlModelOverview
from fiab_core.providers import ArtifactsProvider


def _reset_provider() -> None:
    ArtifactsProvider._list_models = None
    ArtifactsProvider._get_artifact_local_path = None


@pytest.fixture(autouse=True)
def clean_provider():
    _reset_provider()
    yield
    _reset_provider()


def test_list_models_raises_before_registration():
    with pytest.raises(RuntimeError, match="list_models"):
        ArtifactsProvider.list_models()


def test_get_artifact_local_path_raises_before_registration():
    composite_id = CompositeArtifactId(artifact_store_id="store", ml_model_checkpoint_id="ckpt")
    with pytest.raises(RuntimeError, match="get_artifact_local_path"):
        ArtifactsProvider.get_artifact_local_path(composite_id)


def test_list_models_returns_registered_result():
    expected: list[MlModelOverview] = [
        MlModelOverview(
            composite_id=CompositeArtifactId(artifact_store_id="s", ml_model_checkpoint_id="c"),
            display_name="My Model",
            display_author="Author",
            disk_size_bytes=1024,
            supported_platforms=["linux"],
            is_available=True,
        )
    ]
    ArtifactsProvider.register_list_models(lambda: expected)
    assert ArtifactsProvider.list_models() == expected


def test_get_artifact_local_path_returns_registered_result():
    base = Path("/data")
    ArtifactsProvider.register_get_artifact_local_path(lambda cid: base / cid.artifact_store_id / cid.ml_model_checkpoint_id)

    composite_id = CompositeArtifactId(artifact_store_id="store", ml_model_checkpoint_id="ckpt")
    result = ArtifactsProvider.get_artifact_local_path(composite_id)
    assert result == Path("/data/store/ckpt")


def test_registration_can_be_replaced():
    ArtifactsProvider.register_list_models(lambda: [])
    assert ArtifactsProvider.list_models() == []

    sentinel: list[MlModelOverview] = [
        MlModelOverview(
            composite_id=CompositeArtifactId(artifact_store_id="a", ml_model_checkpoint_id="b"),
            display_name="X",
            display_author="Y",
            disk_size_bytes=0,
            supported_platforms=[],
            is_available=False,
        )
    ]
    ArtifactsProvider.register_list_models(lambda: sentinel)
    assert ArtifactsProvider.list_models() == sentinel
