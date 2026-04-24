# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import json
import tempfile
from collections.abc import Generator
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import httpx
import pytest
from cascade.low.exceptions import CascadeInternalError
from fiab_core.artifacts import ArtifactStoreId, MlModelCheckpoint, MlModelCheckpointId
from pyrsistent import pmap

from forecastbox.domain.artifact.base import (
    ArtifactCatalog,
    CompositeArtifactId,
    get_artifact_local_path,
)
from forecastbox.domain.artifact.io import (
    download_artifact,
    get_artifacts_catalog,
    list_local_storage,
)
from forecastbox.utility.config import ArtifactStoreConfig, ArtifactStoresConfig


@pytest.fixture
def sample_checkpoint() -> MlModelCheckpoint:
    """Sample ML model checkpoint for testing"""
    return MlModelCheckpoint(
        url="https://example.com/model.ckpt",
        display_name="Test Model",
        display_author="Test Author",
        display_description="Test Description",
        disk_size_bytes=1024,
        pip_package_constraints=["torch>=2.0"],
        supported_platforms=["linux"],
        input_characteristics=["input_source"],
        output_qube={},
        timestep="1h",
        comment="",
    )


@pytest.fixture
def sample_artifact_stores_config() -> ArtifactStoresConfig:
    """Sample artifact stores configuration"""
    return {
        ArtifactStoreId("store1"): ArtifactStoreConfig(
            url="https://example.com/artifacts.json",
            method="file",
        ),
        ArtifactStoreId("store2"): ArtifactStoreConfig(
            url="https://example.com/artifacts2.json",
            method="file",
        ),
    }


@pytest.fixture
def tmpdir_path() -> Generator[Path, None, None]:
    """Create a temporary directory for testing"""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


def test_composite_artifact_id() -> None:
    """Test CompositeArtifactId creation and hashing"""
    id1 = CompositeArtifactId(artifact_store_id=ArtifactStoreId("store1"), ml_model_checkpoint_id=MlModelCheckpointId("model1"))
    id2 = CompositeArtifactId(artifact_store_id=ArtifactStoreId("store1"), ml_model_checkpoint_id=MlModelCheckpointId("model1"))
    id3 = CompositeArtifactId(artifact_store_id=ArtifactStoreId("store1"), ml_model_checkpoint_id=MlModelCheckpointId("model2"))

    assert id1 == id2
    assert id1 != id3
    assert hash(id1) == hash(id2)
    assert hash(id1) != hash(id3)

    # Test as dict key
    test_dict = {id1: "value1", id3: "value2"}
    assert test_dict[id2] == "value1"


def test_composite_artifact_id_from_str_round_trip() -> None:
    """Test CompositeArtifactId.from_str / to_str round-trip"""
    from fiab_core.artifacts import CompositeArtifactId as CoreCompositeArtifactId

    original = CoreCompositeArtifactId(artifact_store_id=ArtifactStoreId("my_store"), ml_model_checkpoint_id=MlModelCheckpointId("my_ckpt"))
    serialised = CoreCompositeArtifactId.to_str(original)
    assert serialised == "my_store:my_ckpt"

    restored = CoreCompositeArtifactId.from_str(serialised)
    assert restored == original


def test_composite_artifact_id_from_str_with_colon_in_checkpoint() -> None:
    """Checkpoint IDs containing colons should only split on the first colon"""
    from fiab_core.artifacts import CompositeArtifactId as CoreCompositeArtifactId

    parsed = CoreCompositeArtifactId.from_str("store:ckpt:extra")
    assert parsed.artifact_store_id == "store"
    assert parsed.ml_model_checkpoint_id == "ckpt:extra"


def test_composite_artifact_id_from_str_missing_colon() -> None:
    """from_str must raise ValueError when the separator is absent"""
    import pytest
    from fiab_core.artifacts import CompositeArtifactId as CoreCompositeArtifactId

    with pytest.raises(ValueError):
        CoreCompositeArtifactId.from_str("no_colon_here")


import pytest


def test_get_artifacts_catalog(sample_artifact_stores_config: Any, sample_checkpoint: Any) -> None:
    """Test getting artifacts catalog from multiple stores"""
    store1_data = {
        "display_name": "Store 1",
        "artifacts": {
            "model1": sample_checkpoint.model_dump(),
            "model2": sample_checkpoint.model_dump(),
        },
    }

    store2_data = {
        "display_name": "Store 2",
        "artifacts": {
            "model3": sample_checkpoint.model_dump(),
        },
    }

    with patch("httpx.Client") as mock_client_class:
        mock_client = MagicMock()
        mock_client_class.return_value.__enter__.return_value = mock_client

        mock_responses = []
        for data in [store1_data, store2_data]:
            mock_response = MagicMock()
            mock_response.content = json.dumps(data).encode()
            mock_response.raise_for_status = MagicMock()
            mock_responses.append(mock_response)

        mock_client.get.side_effect = mock_responses

        catalog = get_artifacts_catalog(sample_artifact_stores_config)

        assert len(catalog) == 3
        assert CompositeArtifactId(ArtifactStoreId("store1"), MlModelCheckpointId("model1")) in catalog
        assert CompositeArtifactId(ArtifactStoreId("store1"), MlModelCheckpointId("model2")) in catalog
        assert CompositeArtifactId(ArtifactStoreId("store2"), MlModelCheckpointId("model3")) in catalog

        for composite_id, checkpoint in catalog.items():
            assert isinstance(checkpoint, MlModelCheckpoint)
            assert checkpoint.display_name == "Test Model"


def test_get_artifacts_catalog_with_error(sample_artifact_stores_config: Any) -> None:
    """Test get_artifacts_catalog raises when there's a network error"""
    with patch("httpx.get") as mock_get:
        mock_get.side_effect = httpx.HTTPError("Network error")
        with pytest.raises(httpx.HTTPError):
            get_artifacts_catalog(sample_artifact_stores_config)


def test_get_artifacts_catalog_unsupported_method() -> None:
    """Test get_artifacts_catalog with unsupported store method raises"""
    from typing import Literal, cast

    config: ArtifactStoresConfig = {
        ArtifactStoreId("store1"): ArtifactStoreConfig(
            url="https://example.com/artifacts.json",
            method="file",
        ),
    }
    # Temporarily change method to something unsupported
    config[ArtifactStoreId("store1")].method = cast(Literal["file"], "unsupported")

    with pytest.raises(CascadeInternalError):
        get_artifacts_catalog(config)


def test_get_artifacts_catalog_from_local_file(tmpdir_path: Path, sample_checkpoint: Any) -> None:
    """Test that get_artifacts_catalog loads from a local JSON file when the URL is a valid file path"""
    store_data = {
        "display_name": "Local Store",
        "artifacts": {
            "local_model": sample_checkpoint.model_dump(),
        },
    }

    catalog_file = tmpdir_path / "artifacts.json"
    catalog_file.write_text(json.dumps(store_data))

    config: ArtifactStoresConfig = {
        ArtifactStoreId("local_store"): ArtifactStoreConfig(
            url=f"file://{catalog_file}",
            method="file",
        ),
    }

    catalog = get_artifacts_catalog(config)

    assert len(catalog) == 1
    composite_id = CompositeArtifactId(ArtifactStoreId("local_store"), MlModelCheckpointId("local_model"))
    assert composite_id in catalog
    assert catalog[composite_id].display_name == "Test Model"


def test_list_local_storage_empty(tmpdir_path: Path, sample_checkpoint: Any) -> None:
    """Test list_local_storage with no artifacts"""
    catalog: ArtifactCatalog = pmap(
        {
            CompositeArtifactId(ArtifactStoreId("store1"), MlModelCheckpointId("model1")): sample_checkpoint,
        }
    )

    result = list_local_storage(catalog, tmpdir_path)
    assert result == []


def test_list_local_storage_nonexistent_dir(tmpdir_path: Path, sample_checkpoint: Any) -> None:
    """Test list_local_storage with nonexistent artifacts directory"""
    catalog: ArtifactCatalog = pmap(
        {
            CompositeArtifactId(ArtifactStoreId("store1"), MlModelCheckpointId("model1")): sample_checkpoint,
        }
    )

    nonexistent_dir = tmpdir_path / "nonexistent"
    result = list_local_storage(catalog, nonexistent_dir)
    assert result == []


def test_list_local_storage_with_artifacts(tmpdir_path: Path, sample_checkpoint: Any) -> None:
    """Test list_local_storage with existing artifacts as files"""
    catalog: ArtifactCatalog = pmap(
        {
            CompositeArtifactId(ArtifactStoreId("store1"), MlModelCheckpointId("model1.ckpt")): sample_checkpoint,
            CompositeArtifactId(ArtifactStoreId("store1"), MlModelCheckpointId("model2.ckpt")): sample_checkpoint,
            CompositeArtifactId(ArtifactStoreId("store2"), MlModelCheckpointId("model3.ckpt")): sample_checkpoint,
        }
    )

    # Create artifact files (not directories)
    artifacts_base = tmpdir_path / "artifacts"
    store1_dir = artifacts_base / "store1"
    store2_dir = artifacts_base / "store2"
    store1_dir.mkdir(parents=True)
    store2_dir.mkdir(parents=True)

    (store1_dir / "model1.ckpt").touch()
    (store1_dir / "model2.ckpt").touch()
    (store2_dir / "model3.ckpt").touch()

    result = list_local_storage(catalog, tmpdir_path)

    assert len(result) == 3
    assert CompositeArtifactId(ArtifactStoreId("store1"), MlModelCheckpointId("model1.ckpt")) in result
    assert CompositeArtifactId(ArtifactStoreId("store1"), MlModelCheckpointId("model2.ckpt")) in result
    assert CompositeArtifactId(ArtifactStoreId("store2"), MlModelCheckpointId("model3.ckpt")) in result


def test_list_local_storage_with_unknown_store(tmpdir_path: Path, sample_checkpoint: Any) -> None:
    """Test list_local_storage with unknown store directory"""
    catalog: ArtifactCatalog = pmap(
        {
            CompositeArtifactId(ArtifactStoreId("store1"), MlModelCheckpointId("model1.ckpt")): sample_checkpoint,
        }
    )

    # Create artifacts with known and unknown stores
    artifacts_base = tmpdir_path / "artifacts"
    store1_dir = artifacts_base / "store1"
    unknown_dir = artifacts_base / "unknown_store"
    store1_dir.mkdir(parents=True)
    unknown_dir.mkdir(parents=True)

    (store1_dir / "model1.ckpt").touch()
    (unknown_dir / "model2.ckpt").touch()

    result = list_local_storage(catalog, tmpdir_path)

    assert len(result) == 1
    assert CompositeArtifactId(ArtifactStoreId("store1"), MlModelCheckpointId("model1.ckpt")) in result


def test_list_local_storage_with_unknown_checkpoint(tmpdir_path: Path, sample_checkpoint: Any) -> None:
    """Test list_local_storage with unknown checkpoint in known store"""
    catalog: ArtifactCatalog = pmap(
        {
            CompositeArtifactId(ArtifactStoreId("store1"), MlModelCheckpointId("model1.ckpt")): sample_checkpoint,
        }
    )

    # Create artifacts with known and unknown checkpoints
    artifacts_base = tmpdir_path / "artifacts"
    store1_dir = artifacts_base / "store1"
    store1_dir.mkdir(parents=True)

    (store1_dir / "model1.ckpt").touch()
    (store1_dir / "unknown_model.ckpt").touch()

    result = list_local_storage(catalog, tmpdir_path)

    assert len(result) == 1
    assert CompositeArtifactId(ArtifactStoreId("store1"), MlModelCheckpointId("model1.ckpt")) in result


def test_get_artifact_local_path(tmpdir_path: Path) -> None:
    """Test get_artifact_local_path returns correct path"""
    composite_id = CompositeArtifactId(ArtifactStoreId("store1"), MlModelCheckpointId("model1.ckpt"))
    path = get_artifact_local_path(composite_id, tmpdir_path)

    expected = tmpdir_path / "artifacts" / "store1" / "model1.ckpt"
    assert path == expected


def test_get_artifact_local_path_with_string_dir(tmpdir_path: Path) -> None:
    """Test get_artifact_local_path with Path directory path"""
    composite_id = CompositeArtifactId(ArtifactStoreId("store1"), MlModelCheckpointId("model1.ckpt"))
    path = get_artifact_local_path(composite_id, tmpdir_path)

    expected = tmpdir_path / "artifacts" / "store1" / "model1.ckpt"
    assert path == expected


def test_get_artifact_local_path_invalid_characters() -> None:
    """Test get_artifact_local_path raises on invalid path characters"""
    tmpdir = Path("/tmp")
    invalid_ids = [
        CompositeArtifactId(ArtifactStoreId("../etc"), MlModelCheckpointId("model1.ckpt")),
        CompositeArtifactId(ArtifactStoreId("store1"), MlModelCheckpointId("../../../etc/passwd")),
        CompositeArtifactId(ArtifactStoreId("store/sub"), MlModelCheckpointId("model1.ckpt")),
        CompositeArtifactId(ArtifactStoreId("store1"), MlModelCheckpointId("model/sub")),
        CompositeArtifactId(ArtifactStoreId("store\\sub"), MlModelCheckpointId("model1.ckpt")),
        CompositeArtifactId(ArtifactStoreId("store1"), MlModelCheckpointId("model\x00")),
    ]

    for invalid_id in invalid_ids:
        with pytest.raises(ValueError, match="Invalid characters in artifact ID"):
            get_artifact_local_path(invalid_id, tmpdir)


def test_download_artifact_success(tmpdir_path: Path, sample_checkpoint: Any) -> None:
    """Test successful artifact download"""
    composite_id = CompositeArtifactId(ArtifactStoreId("store1"), MlModelCheckpointId("model1.ckpt"))

    mock_content = b"fake checkpoint data"

    with patch("httpx.Client") as mock_client_class:
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.headers = {"Content-Length": str(len(mock_content))}
        mock_response.iter_bytes.return_value = [mock_content]
        mock_response.raise_for_status = MagicMock()

        mock_client.__enter__.return_value = mock_client
        mock_client.stream.return_value.__enter__.return_value = mock_response
        mock_client_class.return_value = mock_client

        download_artifact(composite_id, sample_checkpoint, tmpdir_path)

        # Verify the file was downloaded
        artifact_path = get_artifact_local_path(composite_id, tmpdir_path)

        assert artifact_path.exists()
        assert artifact_path.read_bytes() == mock_content


def test_download_artifact_creates_directory(tmpdir_path: Path, sample_checkpoint: Any) -> None:
    """Test download_artifact creates necessary parent directory"""
    composite_id = CompositeArtifactId(ArtifactStoreId("store1"), MlModelCheckpointId("model1.ckpt"))

    mock_content = b"fake checkpoint data"

    with patch("httpx.Client") as mock_client_class:
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.headers = {"Content-Length": str(len(mock_content))}
        mock_response.iter_bytes.return_value = [mock_content]
        mock_response.raise_for_status = MagicMock()

        mock_client.__enter__.return_value = mock_client
        mock_client.stream.return_value.__enter__.return_value = mock_response
        mock_client_class.return_value = mock_client

        download_artifact(composite_id, sample_checkpoint, tmpdir_path)

        artifact_path = get_artifact_local_path(composite_id, tmpdir_path)
        assert artifact_path.exists()
        assert artifact_path.is_file()
        assert artifact_path.parent.is_dir()


def test_download_artifact_http_error(tmpdir_path: Path, sample_checkpoint: Any) -> None:
    """Test download_artifact handles HTTP errors"""
    composite_id = CompositeArtifactId(ArtifactStoreId("store1"), MlModelCheckpointId("model1.ckpt"))

    with patch("httpx.Client") as mock_client_class:
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.raise_for_status.side_effect = httpx.HTTPStatusError("404 Not Found", request=MagicMock(), response=MagicMock())

        mock_client.__enter__.return_value = mock_client
        mock_client.stream.return_value.__enter__.return_value = mock_response
        mock_client_class.return_value = mock_client

        with pytest.raises(httpx.HTTPStatusError):
            download_artifact(composite_id, sample_checkpoint, tmpdir_path)


def test_download_artifact_chunked_download(tmpdir_path: Path, sample_checkpoint: Any) -> None:
    """Test download_artifact handles chunked downloads"""
    composite_id = CompositeArtifactId(ArtifactStoreId("store1"), MlModelCheckpointId("model1.ckpt"))

    # Simulate chunked download
    chunk1 = b"chunk1"
    chunk2 = b"chunk2"
    chunk3 = b"chunk3"
    total_content = chunk1 + chunk2 + chunk3

    with patch("httpx.Client") as mock_client_class:
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.headers = {"Content-Length": str(len(total_content))}
        mock_response.iter_bytes.return_value = [chunk1, chunk2, chunk3]
        mock_response.raise_for_status = MagicMock()

        mock_client.__enter__.return_value = mock_client
        mock_client.stream.return_value.__enter__.return_value = mock_response
        mock_client_class.return_value = mock_client

        download_artifact(composite_id, sample_checkpoint, tmpdir_path)

        # Verify all chunks were written
        artifact_path = get_artifact_local_path(composite_id, tmpdir_path)

        assert artifact_path.exists()
        assert artifact_path.read_bytes() == total_content
