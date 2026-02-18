# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""API for internal artifact management -- downloading artifact catalogs and individual artifacts.

Synchronization is handled by ArtifactManager with a single lock protecting shared state:
- artifact catalog (available artifacts from remote stores)
- locally available artifacts set
- background thread running I/O operations

At most one thread at a time performs download/catalog operations.
"""

import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from forecastbox.api.artifacts.base import ArtifactCatalog, CompositeArtifactId, MlModelDetail, MlModelOverview
from forecastbox.api.artifacts.io import download_artifact, get_artifacts_catalog, list_local_storage
from forecastbox.config import config
from forecastbox.ecpyutil import timed_acquire

logger = logging.getLogger(__name__)


class ArtifactManager:
    lock: threading.Lock = threading.Lock()
    catalog: ArtifactCatalog = {}
    locally_available: set[CompositeArtifactId] = set()
    executor: ThreadPoolExecutor | None = None
    refresh_error: str | None = None


def _refresh_catalog_task() -> None:
    """Background task to refresh catalog and local artifact list."""
    try:
        logger.info("Starting artifact catalog refresh")
        catalog = get_artifacts_catalog(config.product.artifact_stores)
        local_artifacts = list_local_storage(catalog, Path(config.api.data_path))

        with timed_acquire(ArtifactManager.lock, 60) as result:
            if not result:
                raise ValueError("failed to acquire the shared lock")
            ArtifactManager.catalog = catalog
            ArtifactManager.locally_available = set(local_artifacts)
        logger.info(f"Artifact catalog refreshed: {len(catalog)} total, {len(local_artifacts)} local")
    except Exception as e:
        logger.exception(f"catalog refresh failed with {repr(e)}")
        with timed_acquire(ArtifactManager.lock, 5) as _:
            ArtifactManager.refresh_error = repr(e)


def submit_refresh_catalog() -> None:
    """Submit catalog refresh task to background executor."""
    with timed_acquire(ArtifactManager.lock, 0.2) as result:
        if not result:
            logger.error("failed to submit refresh_catalog")
            ArtifactManager.refresh_error = "failed to submit refresh_catalog"
        elif ArtifactManager.executor is None:
            ArtifactManager.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="artifact-io")
            ArtifactManager.executor.submit(_refresh_catalog_task)
        else:
            ArtifactManager.executor.submit(_refresh_catalog_task)


def _download_artifact_task(composite_id: CompositeArtifactId) -> None:
    """Background task to download a single artifact."""
    try:
        logger.info(f"Starting download for artifact {composite_id}")
        with timed_acquire(ArtifactManager.lock, 1) as result:
            if not result:
                raise ValueError("failed to acquire lock for catalog access")
            catalog = ArtifactManager.catalog

        download_artifact(composite_id, catalog, Path(config.api.data_path))

        with timed_acquire(ArtifactManager.lock, 5) as result:
            if not result:
                logger.error("failed to acquire lock to update locally_available")
            else:
                ArtifactManager.locally_available.add(composite_id)
        logger.info(f"Successfully downloaded artifact {composite_id}")
    except Exception as e:
        logger.exception(f"artifact download failed for {composite_id}: {repr(e)}")


def submit_artifact_download(composite_id: CompositeArtifactId) -> str:
    """Submit artifact download task. Returns empty string on success, error message on failure."""
    with timed_acquire(ArtifactManager.lock, 0.5) as result:
        if not result:
            return "artifact manager is busy"
        if composite_id not in ArtifactManager.catalog:
            return f"artifact {composite_id} not found in catalog"
        if composite_id in ArtifactManager.locally_available:
            return f"artifact {composite_id} already downloaded"
        if ArtifactManager.executor is None:
            ArtifactManager.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="artifact-io")

    ArtifactManager.executor.submit(_download_artifact_task, composite_id)
    return ""


def join_artifact_manager(timeout_sec: int) -> None:
    """Wait for background executor to finish pending tasks."""
    barrier = (time.perf_counter_ns() / 1e9) + timeout_sec
    with timed_acquire(ArtifactManager.lock, timeout_sec) as result:
        if not result:
            logger.error("failed to lock for joining artifact manager")
        else:
            if ArtifactManager.executor is not None:
                budget = barrier - (time.perf_counter_ns() / 1e9)
                ArtifactManager.executor.shutdown(wait=True, cancel_futures=False)
                logger.info("artifact manager executor joined")


def list_models() -> list[MlModelOverview]:
    """List all available models with overview information."""
    with timed_acquire(ArtifactManager.lock, 1.0) as result:
        if not result:
            return []

        overviews = []
        for composite_id, checkpoint in ArtifactManager.catalog.items():
            overview = MlModelOverview(
                composite_id=composite_id,
                display_name=checkpoint.display_name,
                display_author=checkpoint.display_author,
                disk_size_bytes=checkpoint.disk_size_bytes,
                supported_platforms=checkpoint.supported_platforms,
                is_available=composite_id in ArtifactManager.locally_available,
            )
            overviews.append(overview)

        return overviews


def get_model_details(composite_id: CompositeArtifactId) -> MlModelDetail | None:
    """Get detailed information for a specific model."""
    with timed_acquire(ArtifactManager.lock, 1.0) as result:
        if not result:
            return None

        checkpoint = ArtifactManager.catalog.get(composite_id)
        if checkpoint is None:
            return None

        detail = MlModelDetail(
            composite_id=composite_id,
            display_name=checkpoint.display_name,
            display_author=checkpoint.display_author,
            display_description=checkpoint.display_description,
            url=checkpoint.url,
            disk_size_bytes=checkpoint.disk_size_bytes,
            pip_package_constraints=checkpoint.pip_package_constraints,
            supported_platforms=checkpoint.supported_platforms,
            output_characteristics=checkpoint.output_characteristics,
            input_characteristics=checkpoint.input_characteristics,
            is_available=composite_id in ArtifactManager.locally_available,
        )

        return detail
