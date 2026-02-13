# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""
Downloading and managing artifacts such as ml model checkpoints
"""

import logging
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path

import httpx
from fiab_core.artifacts import MlModelCheckpoint, MlModelCheckpointId

from forecastbox.config import ArtifactStoreId, ArtifactStoresConfig

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class CompositeArtifactId:
    """Composite identifier for an artifact combining store and checkpoint IDs"""

    artifact_store_id: ArtifactStoreId
    ml_model_checkpoint_id: MlModelCheckpointId

    def __hash__(self) -> int:
        return hash((self.artifact_store_id, self.ml_model_checkpoint_id))


ArtifactCatalog = dict[CompositeArtifactId, MlModelCheckpoint]


def get_artifacts_catalog(artifact_stores_config: ArtifactStoresConfig) -> ArtifactCatalog:
    """
    Query each artifact store and return a composed catalog of all available artifacts.

    Args:
        artifact_stores_config: Configuration for all artifact stores

    Returns:
        Dictionary mapping composite artifact IDs to their checkpoint metadata
    """
    catalog: ArtifactCatalog = {}

    for store_id, store_config in artifact_stores_config.items():
        try:
            if store_config.method == "file":
                response = httpx.get(store_config.url, follow_redirects=True)
                response.raise_for_status()
                store_data = response.json()

                artifacts = store_data.get("artifacts", {})
                for checkpoint_id, checkpoint_data in artifacts.items():
                    composite_id = CompositeArtifactId(artifact_store_id=store_id, ml_model_checkpoint_id=checkpoint_id)
                    catalog[composite_id] = MlModelCheckpoint(**checkpoint_data)
                    logger.debug(f"Loaded artifact {composite_id} from store {store_id}")
            else:
                logger.warning(f"Unsupported artifact store method: {store_config.method}")
        except Exception as e:
            logger.error(f"Failed to load artifacts from store {store_id}: {e}")

    return catalog


def list_local_storage(artifacts_catalog: ArtifactCatalog, data_dir: str | Path) -> list[CompositeArtifactId]:
    """
    List locally stored artifacts by traversing the artifacts directory.

    Artifacts are stored under: data_dir/artifacts/{artifact_store_id}/{ml_model_checkpoint_id}/

    Args:
        artifacts_catalog: Catalog of known artifacts
        data_dir: Base data directory path

    Returns:
        List of composite artifact IDs found in local storage
    """
    data_path = Path(data_dir)
    artifacts_base = data_path / "artifacts"

    if not artifacts_base.exists():
        return []

    local_artifacts: list[CompositeArtifactId] = []
    known_store_ids = {artifact_id.artifact_store_id for artifact_id in artifacts_catalog.keys()}

    for store_dir in artifacts_base.iterdir():
        if not store_dir.is_dir():
            continue

        store_id = store_dir.name

        if store_id not in known_store_ids:
            logger.warning(f"Found unknown artifact store directory: {store_id}")
            continue

        for checkpoint_dir in store_dir.iterdir():
            if not checkpoint_dir.is_dir():
                continue

            checkpoint_id = checkpoint_dir.name
            composite_id = CompositeArtifactId(artifact_store_id=store_id, ml_model_checkpoint_id=checkpoint_id)

            if composite_id in artifacts_catalog:
                local_artifacts.append(composite_id)
            else:
                logger.warning(f"Found local artifact not in catalog: {composite_id}")

    return local_artifacts


def get_artifact_local_path(composite_id: CompositeArtifactId, data_dir: str | Path) -> Path:
    """
    Get the local filesystem path for an artifact.

    Args:
        composite_id: Composite artifact identifier
        data_dir: Base data directory path

    Returns:
        Path to the artifact directory

    Raises:
        ValueError: If the composite ID contains invalid path characters
    """
    # Validate that the IDs don't contain path traversal or invalid characters
    store_id = composite_id.artifact_store_id
    checkpoint_id = composite_id.ml_model_checkpoint_id

    invalid_chars = {"..", "/", "\\", "\0"}
    if any(char in store_id for char in invalid_chars) or any(char in checkpoint_id for char in invalid_chars):
        raise ValueError(f"Invalid characters in artifact ID: {composite_id}")

    data_path = Path(data_dir)
    artifact_path = data_path / "artifacts" / store_id / checkpoint_id

    return artifact_path


def download_artifact(composite_id: CompositeArtifactId, artifacts_catalog: ArtifactCatalog, data_dir: str | Path) -> None:
    """
    Download an artifact from its remote URL to local storage.

    Args:
        composite_id: Composite artifact identifier
        artifacts_catalog: Catalog containing artifact metadata
        data_dir: Base data directory path

    Raises:
        KeyError: If the artifact is not found in the catalog
        httpx.HTTPError: If the download fails
    """
    if composite_id not in artifacts_catalog:
        raise KeyError(f"Artifact not found in catalog: {composite_id}")

    checkpoint = artifacts_catalog[composite_id]
    artifact_path = get_artifact_local_path(composite_id, data_dir)
    artifact_path.mkdir(parents=True, exist_ok=True)

    # Download to a temporary file first, then move to final location
    download_path = artifact_path / "checkpoint.ckpt"

    try:
        temp_file = tempfile.NamedTemporaryFile(prefix="artifact_", suffix=".ckpt", delete=False)
        temp_path = Path(temp_file.name)
        temp_file.close()

        with httpx.Client(follow_redirects=True) as client:
            logger.debug(f"Starting download for {composite_id} from {checkpoint.url} to {temp_path}")
            with client.stream("GET", checkpoint.url) as response:
                response.raise_for_status()
                total = int(response.headers.get("Content-Length", 0))
                downloaded = 0
                chunk_size = 1024 * 1024  # 1MB chunks

                with open(temp_path, "wb") as file:
                    for chunk in response.iter_bytes(chunk_size):
                        if chunk:
                            file.write(chunk)
                            downloaded += len(chunk)
                            # TODO report progress
                            if total > 0:
                                progress = float(downloaded) / total * 100
                                logger.debug(f"Download progress: {progress:.1f}%")

            logger.debug(f"Download completed for {composite_id}, total bytes: {downloaded}")
            shutil.move(str(temp_path), str(download_path))
            logger.info(f"Successfully downloaded artifact {composite_id} to {download_path}")

    except Exception as e:
        # Clean up temp file if it exists
        if temp_path.exists():
            temp_path.unlink()
        logger.error(f"Failed to download artifact {composite_id}: {e}")
        raise
