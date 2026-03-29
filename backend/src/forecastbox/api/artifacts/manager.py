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
We use pyrsistent immutable structures for safe lock-free reads.
"""

import logging
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path

from cascade.low.func import Either
from pyrsistent import pmap, pset
from pyrsistent.typing import PMap, PSet

from forecastbox.api.artifacts.base import ArtifactCatalog, CompositeArtifactId, MlModelCheckpoint, MlModelDetail, MlModelOverview
from forecastbox.api.artifacts.io import delete_artifact, download_artifact, get_artifacts_catalog, list_local_storage
from forecastbox.ecpyutil import timed_acquire
from forecastbox.utility.config import config

logger = logging.getLogger(__name__)

# TODO consider rewriting all those managers with thread to utilize a single pool or at least a single
# thread dispatcher class, and only track Futures on each individual manager level

timeout_acquire_request = 1  # aggressive timeout, we dont want to block async worker for long
timeout_acquire_init = 5  # moderate timeout during init, just in case some python background business
timeout_acquire_task = 10  # leisure timeout, this is a background thread and it can wait
timeout_acquire_error = 2  # something failed, report quickly so that can be joined


class ArtifactManager:
    lock: threading.Lock = threading.Lock()
    catalog: ArtifactCatalog = pmap()
    locally_available: PSet[CompositeArtifactId] = pset()
    ongoing_downloads: PMap[CompositeArtifactId, int | str] = pmap()
    executor: ThreadPoolExecutor | None = None
    refresh_error: str | None = None

    @classmethod
    def _ensure_pool(cls):
        # Temporary method until we refactor for external thread pool/dispatcher.
        # Assumes lock held!
        if cls.executor is None:
            cls.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="artifact-io")


def _refresh_catalog_task() -> None:
    """Background task to refresh catalog and local artifact list."""
    try:
        logger.info("Starting artifact catalog refresh")
        catalog = get_artifacts_catalog(config.product.artifact_stores)
        local_artifacts = list_local_storage(catalog, Path(config.api.data_path))

        with timed_acquire(ArtifactManager.lock, timeout_acquire_task) as result:
            if not result:
                raise ValueError("failed to acquire the shared lock")
            ArtifactManager.catalog = catalog
            ArtifactManager.locally_available = pset(local_artifacts)
        logger.info(f"Artifact catalog refreshed: {len(catalog)} total, {len(local_artifacts)} local")
    except Exception as e:
        logger.exception(f"catalog refresh failed with {repr(e)}")
        with timed_acquire(ArtifactManager.lock, timeout_acquire_error) as _:
            ArtifactManager.refresh_error = repr(e)


def submit_refresh_catalog() -> Future[None]:  # ty: ignore[invalid-return-type]
    """Submit catalog refresh task to background executor. Returns a Future that resolves when the refresh completes."""
    with timed_acquire(ArtifactManager.lock, timeout_acquire_request) as result:
        if not result:
            logger.error("failed to submit refresh_catalog")
            ArtifactManager.refresh_error = "failed to submit refresh_catalog"
        ArtifactManager._ensure_pool()
        return ArtifactManager.executor.submit(_refresh_catalog_task)  # ty: ignore[call-non-callable]


def _download_artifact_task(composite_id: CompositeArtifactId) -> None:
    """Background task to download a single artifact."""
    try:
        logger.info(f"Starting download for artifact {composite_id}")
        # Read checkpoint without lock - safe with pyrsistent
        checkpoint = ArtifactManager.catalog.get(composite_id, None)
        if checkpoint is None:
            raise KeyError(f"Artifact not found in catalog: {composite_id}")

        def progress_callback(progress: int) -> None:
            report_artifact_download_progress(composite_id, progress=progress)

        download_artifact(composite_id, checkpoint, Path(config.api.data_path), progress_callback=progress_callback)

        with timed_acquire(ArtifactManager.lock, timeout_acquire_task) as result:
            if not result:
                logger.error("failed to acquire lock to update locally_available")
            else:
                ArtifactManager.locally_available = ArtifactManager.locally_available.add(composite_id)
                if composite_id in ArtifactManager.ongoing_downloads:
                    ArtifactManager.ongoing_downloads = ArtifactManager.ongoing_downloads.remove(composite_id)
                else:
                    logger.warning(f"expected {composite_id} to be in ongoing downloads")
        logger.info(f"Successfully downloaded artifact {composite_id}")
    except Exception as e:
        logger.exception(f"artifact download failed for {composite_id}: {repr(e)}")
        report_artifact_download_progress(composite_id, failure=repr(e))


def submit_artifact_download(composite_id: CompositeArtifactId) -> Either[int, str]:  # ty: ignore[invalid-type-arguments]
    """Submit artifact download task. Returns progress (0-100) on success or ongoing download, error message on failure."""
    with timed_acquire(ArtifactManager.lock, timeout_acquire_request) as result:
        if not result:
            return Either.error("Corresponding internal component is busy")
        if composite_id not in ArtifactManager.catalog:
            return Either.error(f"ArtifactId not found: {composite_id}")
        if composite_id in ArtifactManager.locally_available:
            return Either.ok(100)
        if composite_id in ArtifactManager.ongoing_downloads:
            progress = ArtifactManager.ongoing_downloads[composite_id]
            if isinstance(progress, int):
                return Either.ok(progress)
            else:
                return Either.error(progress)
        ArtifactManager._ensure_pool()
        ArtifactManager.ongoing_downloads = ArtifactManager.ongoing_downloads.set(composite_id, 0)

    ArtifactManager.executor.submit(_download_artifact_task, composite_id)
    return Either.ok(0)


def report_artifact_download_progress(composite_id: CompositeArtifactId, progress: int | None = None, failure: str | None = None) -> None:
    """Report progress or failure for an ongoing artifact download."""
    # NOTE we block shortly even though we are in a background thread because we dont
    # want to get a timeout on ongoing download
    with timed_acquire(ArtifactManager.lock, timeout_acquire_request) as result:
        if not result:
            logger.warning(f"Failed to acquire lock to report progress for {composite_id}")
            return

        if composite_id in ArtifactManager.ongoing_downloads:
            if failure is not None:
                ArtifactManager.ongoing_downloads = ArtifactManager.ongoing_downloads.set(composite_id, failure)
            elif progress is not None:
                ArtifactManager.ongoing_downloads = ArtifactManager.ongoing_downloads.set(composite_id, progress)
        else:
            logger.warning(f"Attempted to report {progress=}, {failure=}, but {composite_id=} not found")


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
    """List all available models with overview information. Raises TimeoutError if fails to acquire"""
    with timed_acquire(ArtifactManager.lock, timeout_acquire_request) as result:
        if not result:
            raise TimeoutError

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


def get_model_details(composite_id: CompositeArtifactId) -> MlModelDetail:
    """Get detailed information for a specific model. Raises KeyErorr if not present, TimeoutError if fails to acquire"""
    with timed_acquire(ArtifactManager.lock, timeout_acquire_request) as result:
        if not result:
            raise TimeoutError

        checkpoint = ArtifactManager.catalog[composite_id]

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


def delete_model(composite_id: CompositeArtifactId) -> Either[str, str]:  # ty: ignore[invalid-type-arguments]
    """Delete a locally available model. Returns confirmation message on success, error message on failure.
    Raises TimeoutError if lock cannot be acquired, KeyError if model not in catalog."""
    # Lock-free reads of pyrsistent structures are safe
    if composite_id not in ArtifactManager.catalog:
        raise KeyError(f"Model {composite_id} not found")

    with timed_acquire(ArtifactManager.lock, timeout_acquire_request) as result:
        if not result:
            raise TimeoutError
        if composite_id not in ArtifactManager.locally_available:
            return Either.error(f"Model {composite_id} is not locally available")
        if composite_id in ArtifactManager.ongoing_downloads:
            return Either.error(f"Model {composite_id} has an ongoing download")
        ArtifactManager.locally_available = ArtifactManager.locally_available.remove(composite_id)

    # TODO race condition possibility 1/ pop in one thread 2/ another request triggers a download
    # 3/ unlink happens while download is ongoing -> fix by making the delete two-step
    try:
        delete_artifact(composite_id, Path(config.api.data_path))
    except Exception as e:
        logger.exception(f"Failed to delete artifact {composite_id}: {repr(e)}")
        return Either.error(f"Failed to delete: {repr(e)}")

    logger.info(f"Successfully deleted model {composite_id}")
    return Either.ok(f"Model {composite_id} deleted")
