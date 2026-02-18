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

All the methods here are blocking -- see manager for nonblocking invocations
"""

import logging
import shutil
import tempfile
from pathlib import Path

import httpx
from cascade.low.func import assert_never
from fiab_core.artifacts import MlModelCheckpoint

from forecastbox.api.artifacts.base import ArtifactCatalog, CompositeArtifactId, artifacts_subdir, get_artifact_local_path
from forecastbox.config import ArtifactStoreId, ArtifactStoresConfig

logger = logging.getLogger(__name__)


def get_artifacts_catalog(artifact_stores_config: ArtifactStoresConfig) -> ArtifactCatalog:
    """Query each artifact store and return a composed catalog of all available artifacts."""
    catalog: ArtifactCatalog = {}

    for store_id, store_config in artifact_stores_config.items():
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
            assert_never(store_config.method)

    return catalog


def list_local_storage(artifacts_catalog: ArtifactCatalog, data_dir: Path) -> list[CompositeArtifactId]:
    """List locally stored artifacts by traversing the artifacts directory under data_dir/artifacts/{store_id}/{checkpoint_id}."""
    artifacts_base = data_dir / artifacts_subdir

    if not artifacts_base.exists():
        return []

    local_artifacts: list[CompositeArtifactId] = []
    known_store_ids = {artifact_id.artifact_store_id for artifact_id in artifacts_catalog.keys()}

    for store_item in artifacts_base.iterdir():
        if not store_item.is_dir():
            logger.warning(f"Found non-directory item in artifacts directory: {store_item.name}")
            continue

        store_id = store_item.name

        if store_id not in known_store_ids:
            logger.warning(f"Found unknown artifact store directory: {store_id}")
            continue

        for checkpoint_item in store_item.iterdir():
            if checkpoint_item.is_dir():
                logger.warning(f"Found directory instead of file for checkpoint: {checkpoint_item.name}")
                continue

            checkpoint_id = checkpoint_item.name
            composite_id = CompositeArtifactId(artifact_store_id=store_id, ml_model_checkpoint_id=checkpoint_id)

            if composite_id in artifacts_catalog:
                local_artifacts.append(composite_id)
            else:
                logger.warning(f"Found local artifact not in catalog: {composite_id}")

    return local_artifacts


def download_artifact(composite_id: CompositeArtifactId, artifacts_catalog: ArtifactCatalog, data_dir: Path) -> None:
    """Download an artifact from its remote URL to local storage, raising KeyError if not found in catalog or httpx.HTTPError if download fails."""
    if composite_id not in artifacts_catalog:
        raise KeyError(f"Artifact not found in catalog: {composite_id}")

    checkpoint = artifacts_catalog[composite_id]
    artifact_path = get_artifact_local_path(composite_id, data_dir)
    artifact_path.parent.mkdir(parents=True, exist_ok=True)

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
            shutil.move(str(temp_path), str(artifact_path))
            logger.info(f"Successfully downloaded artifact {composite_id} to {artifact_path}")

    except Exception as e:
        # Clean up temp file if it exists
        if temp_path.exists():
            temp_path.unlink()
        logger.error(f"Failed to download artifact {composite_id}: {e}")
        raise
