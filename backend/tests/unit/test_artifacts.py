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
from pathlib import Path
from unittest.mock import MagicMock, patch

import httpx
import pytest
from fiab_core.artifacts import MlModelCheckpoint

from forecastbox.api.artifacts import (
    ArtifactCatalog,
    CompositeArtifactId,
    download_artifact,
    get_artifact_local_path,
    get_artifacts_catalog,
    list_local_storage,
)
from forecastbox.config import ArtifactStoreConfig, ArtifactStoresConfig


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
        output_characteristics=["u", "v"],
        input_characteristics=["input_source"],
    )


@pytest.fixture
def sample_artifact_stores_config() -> ArtifactStoresConfig:
    """Sample artifact stores configuration"""
    return {
        "store1": ArtifactStoreConfig(
            url="https://example.com/artifacts.json",
            method="file",
        ),
        "store2": ArtifactStoreConfig(
            url="https://example.com/artifacts2.json",
            method="file",
        ),
    }


@pytest.fixture
def tmpdir_path():
    """Create a temporary directory for testing"""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


def test_composite_artifact_id():
    """Test CompositeArtifactId creation and hashing"""
    id1 = CompositeArtifactId(artifact_store_id="store1", ml_model_checkpoint_id="model1")
    id2 = CompositeArtifactId(artifact_store_id="store1", ml_model_checkpoint_id="model1")
    id3 = CompositeArtifactId(artifact_store_id="store1", ml_model_checkpoint_id="model2")

    assert id1 == id2
    assert id1 != id3
    assert hash(id1) == hash(id2)
    assert hash(id1) != hash(id3)

    # Test as dict key
    test_dict = {id1: "value1", id3: "value2"}
    assert test_dict[id2] == "value1"


def test_get_artifacts_catalog(sample_artifact_stores_config, sample_checkpoint):
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

    with patch("httpx.get") as mock_get:
        mock_responses = []
        for data in [store1_data, store2_data]:
            mock_response = MagicMock()
            mock_response.json.return_value = data
            mock_response.raise_for_status = MagicMock()
            mock_responses.append(mock_response)

        mock_get.side_effect = mock_responses

        catalog = get_artifacts_catalog(sample_artifact_stores_config)

        assert len(catalog) == 3
        assert CompositeArtifactId("store1", "model1") in catalog
        assert CompositeArtifactId("store1", "model2") in catalog
        assert CompositeArtifactId("store2", "model3") in catalog

        for composite_id, checkpoint in catalog.items():
            assert isinstance(checkpoint, MlModelCheckpoint)
            assert checkpoint.display_name == "Test Model"


def test_get_artifacts_catalog_with_error(sample_artifact_stores_config):
    """Test get_artifacts_catalog handles errors gracefully"""
    with patch("httpx.get") as mock_get:
        mock_get.side_effect = httpx.HTTPError("Network error")
        catalog = get_artifacts_catalog(sample_artifact_stores_config)
        assert len(catalog) == 0


def test_get_artifacts_catalog_unsupported_method():
    """Test get_artifacts_catalog with unsupported store method"""
    config = {
        "store1": ArtifactStoreConfig(
            url="https://example.com/artifacts.json",
            method="file",  # type: ignore
        ),
    }
    # Temporarily change method to something unsupported
    config["store1"].method = "unsupported"  # type: ignore

    catalog = get_artifacts_catalog(config)
    assert len(catalog) == 0


def test_list_local_storage_empty(tmpdir_path, sample_checkpoint):
    """Test list_local_storage with no artifacts"""
    catalog: ArtifactCatalog = {
        CompositeArtifactId("store1", "model1"): sample_checkpoint,
    }

    result = list_local_storage(catalog, tmpdir_path)
    assert result == []


def test_list_local_storage_nonexistent_dir(tmpdir_path, sample_checkpoint):
    """Test list_local_storage with nonexistent artifacts directory"""
    catalog: ArtifactCatalog = {
        CompositeArtifactId("store1", "model1"): sample_checkpoint,
    }

    nonexistent_dir = tmpdir_path / "nonexistent"
    result = list_local_storage(catalog, nonexistent_dir)
    assert result == []


def test_list_local_storage_with_artifacts(tmpdir_path, sample_checkpoint):
    """Test list_local_storage with existing artifacts"""
    catalog: ArtifactCatalog = {
        CompositeArtifactId("store1", "model1"): sample_checkpoint,
        CompositeArtifactId("store1", "model2"): sample_checkpoint,
        CompositeArtifactId("store2", "model3"): sample_checkpoint,
    }

    # Create artifact directories
    artifacts_base = tmpdir_path / "artifacts"
    (artifacts_base / "store1" / "model1").mkdir(parents=True)
    (artifacts_base / "store1" / "model2").mkdir(parents=True)
    (artifacts_base / "store2" / "model3").mkdir(parents=True)

    result = list_local_storage(catalog, tmpdir_path)

    assert len(result) == 3
    assert CompositeArtifactId("store1", "model1") in result
    assert CompositeArtifactId("store1", "model2") in result
    assert CompositeArtifactId("store2", "model3") in result


def test_list_local_storage_with_unknown_store(tmpdir_path, sample_checkpoint):
    """Test list_local_storage with unknown store directory"""
    catalog: ArtifactCatalog = {
        CompositeArtifactId("store1", "model1"): sample_checkpoint,
    }

    # Create artifacts with known and unknown stores
    artifacts_base = tmpdir_path / "artifacts"
    (artifacts_base / "store1" / "model1").mkdir(parents=True)
    (artifacts_base / "unknown_store" / "model2").mkdir(parents=True)

    result = list_local_storage(catalog, tmpdir_path)

    assert len(result) == 1
    assert CompositeArtifactId("store1", "model1") in result


def test_list_local_storage_with_unknown_checkpoint(tmpdir_path, sample_checkpoint):
    """Test list_local_storage with unknown checkpoint in known store"""
    catalog: ArtifactCatalog = {
        CompositeArtifactId("store1", "model1"): sample_checkpoint,
    }

    # Create artifacts with known and unknown checkpoints
    artifacts_base = tmpdir_path / "artifacts"
    (artifacts_base / "store1" / "model1").mkdir(parents=True)
    (artifacts_base / "store1" / "unknown_model").mkdir(parents=True)

    result = list_local_storage(catalog, tmpdir_path)

    assert len(result) == 1
    assert CompositeArtifactId("store1", "model1") in result


def test_get_artifact_local_path(tmpdir_path):
    """Test get_artifact_local_path returns correct path"""
    composite_id = CompositeArtifactId("store1", "model1")
    path = get_artifact_local_path(composite_id, tmpdir_path)

    expected = tmpdir_path / "artifacts" / "store1" / "model1"
    assert path == expected


def test_get_artifact_local_path_with_string_dir(tmpdir_path):
    """Test get_artifact_local_path with string directory path"""
    composite_id = CompositeArtifactId("store1", "model1")
    path = get_artifact_local_path(composite_id, str(tmpdir_path))

    expected = tmpdir_path / "artifacts" / "store1" / "model1"
    assert path == expected


def test_get_artifact_local_path_invalid_characters():
    """Test get_artifact_local_path raises on invalid path characters"""
    invalid_ids = [
        CompositeArtifactId("../etc", "model1"),
        CompositeArtifactId("store1", "../../../etc/passwd"),
        CompositeArtifactId("store/sub", "model1"),
        CompositeArtifactId("store1", "model/sub"),
        CompositeArtifactId("store\\sub", "model1"),
        CompositeArtifactId("store1", "model\x00"),
    ]

    for invalid_id in invalid_ids:
        with pytest.raises(ValueError, match="Invalid characters in artifact ID"):
            get_artifact_local_path(invalid_id, "/tmp")


def test_download_artifact_not_in_catalog(tmpdir_path, sample_checkpoint):
    """Test download_artifact raises when artifact not in catalog"""
    catalog: ArtifactCatalog = {}
    composite_id = CompositeArtifactId("store1", "model1")

    with pytest.raises(KeyError, match="Artifact not found in catalog"):
        download_artifact(composite_id, catalog, tmpdir_path)


def test_download_artifact_success(tmpdir_path, sample_checkpoint):
    """Test successful artifact download"""
    composite_id = CompositeArtifactId("store1", "model1")
    catalog: ArtifactCatalog = {composite_id: sample_checkpoint}

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

        download_artifact(composite_id, catalog, tmpdir_path)

        # Verify the file was downloaded
        artifact_path = get_artifact_local_path(composite_id, tmpdir_path)
        download_path = artifact_path / "checkpoint.ckpt"

        assert download_path.exists()
        assert download_path.read_bytes() == mock_content


def test_download_artifact_creates_directory(tmpdir_path, sample_checkpoint):
    """Test download_artifact creates necessary directories"""
    composite_id = CompositeArtifactId("store1", "model1")
    catalog: ArtifactCatalog = {composite_id: sample_checkpoint}

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

        download_artifact(composite_id, catalog, tmpdir_path)

        artifact_path = get_artifact_local_path(composite_id, tmpdir_path)
        assert artifact_path.exists()
        assert artifact_path.is_dir()


def test_download_artifact_http_error(tmpdir_path, sample_checkpoint):
    """Test download_artifact handles HTTP errors"""
    composite_id = CompositeArtifactId("store1", "model1")
    catalog: ArtifactCatalog = {composite_id: sample_checkpoint}

    with patch("httpx.Client") as mock_client_class:
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.raise_for_status.side_effect = httpx.HTTPStatusError("404 Not Found", request=MagicMock(), response=MagicMock())

        mock_client.__enter__.return_value = mock_client
        mock_client.stream.return_value.__enter__.return_value = mock_response
        mock_client_class.return_value = mock_client

        with pytest.raises(httpx.HTTPStatusError):
            download_artifact(composite_id, catalog, tmpdir_path)


def test_download_artifact_chunked_download(tmpdir_path, sample_checkpoint):
    """Test download_artifact handles chunked downloads"""
    composite_id = CompositeArtifactId("store1", "model1")
    catalog: ArtifactCatalog = {composite_id: sample_checkpoint}

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

        download_artifact(composite_id, catalog, tmpdir_path)

        # Verify all chunks were written
        artifact_path = get_artifact_local_path(composite_id, tmpdir_path)
        download_path = artifact_path / "checkpoint.ckpt"

        assert download_path.exists()
        assert download_path.read_bytes() == total_content
