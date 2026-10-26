# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""API for internal artifact management -- downloading artifact catalogs and individual artifacts.

Shared state (artifact catalog, locally available artifacts set, ongoing downloads) is held in
ArtifactManager as immutable pyrsistent values, published under one short lock; reads are lock-free.

Catalog refresh and downloads run on `ConcurrentPools.ArtifactIo`, which has exactly one worker, for two reasons:
- catalog refresh publishes `locally_available` from a storage listing taken earlier in the same task, so a
  download completing in between would be overwritten unless refresh and downloads are serialized,
- downloads share one lazily created SSH command handle for `ssh://` data paths.

Model deletion currently runs on the caller's thread.
"""

import logging
import threading
import urllib.parse
from concurrent.futures import Future
from functools import partial

from cascade.low.func import Either
from pyrsistent import pmap, pset
from pyrsistent.typing import PMap, PSet

from forecastbox.domain.artifact.base import ArtifactCatalog, CompositeArtifactId, MlModelDetail, MlModelOverview
from forecastbox.domain.artifact.catalog import get_artifacts_catalog
from forecastbox.domain.artifact.events import ArtifactDownloadFinishedEvent
from forecastbox.domain.artifact.io import delete_artifact, download_artifact, list_storage
from forecastbox.utility import tunnel
from forecastbox.utility.concurrency.manager import ConcurrentPools, SubmissionRejected, TaskName, execution_manager
from forecastbox.utility.concurrency.synchronization import timed_acquire
from forecastbox.utility.config import config
from forecastbox.utility.dispatcher import Event, EventName, submit_event
from forecastbox.utility.tunnel import CommandHandle

logger = logging.getLogger(__name__)

timeout_acquire_request = 1  # aggressive timeout, we dont want to block async worker for long
timeout_acquire_task = 10  # leisure timeout, this is a background thread and it can wait
timeout_acquire_error = 2  # something failed, report quickly so that can be joined


class ArtifactManager:
    lock: threading.Lock = threading.Lock()
    ssh_handle_lock: threading.Lock = threading.Lock()
    catalog: ArtifactCatalog = pmap()
    locally_available: PSet[CompositeArtifactId] = pset()
    ongoing_downloads: PMap[CompositeArtifactId, int | str] = pmap()
    refresh_error: str | None = None
    ssh_handle: CommandHandle | None = None

    @classmethod
    def _get_or_create_ssh_handle(cls, timeout: int) -> CommandHandle:
        """Return an alive CommandHandle for the configured SSH data_path, creating or reconnecting as needed."""
        with timed_acquire(cls.ssh_handle_lock, timeout) as result:
            if not result:
                raise ValueError("failed to acquire SSH handle lock")
            if cls.ssh_handle is not None:
                if tunnel.status_cmd(cls.ssh_handle):
                    return cls.ssh_handle
                # Stale handle -- attempt graceful close before replacing
                try:
                    tunnel.disconnect(cls.ssh_handle)
                except Exception as e:
                    logger.warning(f"Could not disconnect stale SSH handle: {e}")
            parsed = urllib.parse.urlparse(config.backend.data_path)
            cls.ssh_handle = tunnel.connect(parsed.netloc)
            return cls.ssh_handle


def _ssh_handle_if_needed(timeout: int = timeout_acquire_task) -> CommandHandle | None:
    """Return SSH handle if data_path uses ssh:// scheme, else None."""
    parsed = urllib.parse.urlparse(config.backend.data_path)
    if parsed.scheme == "ssh":
        return ArtifactManager._get_or_create_ssh_handle(timeout)
    return None


def refresh_catalog() -> None:
    """Fetch the catalog and list local storage, then publish both atomically under the state lock.
    Records `refresh_error` and re-raises on failure."""
    try:
        logger.info("Starting artifact catalog refresh")
        catalog = get_artifacts_catalog(config.external.artifact_stores)
        handle = _ssh_handle_if_needed()
        local_artifacts = list_storage(catalog, config.backend.data_path, handle)

        with timed_acquire(ArtifactManager.lock, timeout_acquire_task) as result:
            if not result:
                raise ValueError("failed to acquire the shared lock")
            ArtifactManager.catalog = catalog
            ArtifactManager.locally_available = pset(local_artifacts)
            ArtifactManager.refresh_error = None
        logger.info(f"Artifact catalog refreshed: {len(catalog)} total, {len(local_artifacts)} local")
    except Exception as e:
        logger.exception(f"catalog refresh failed with {repr(e)}")
        with timed_acquire(ArtifactManager.lock, timeout_acquire_error) as _:
            ArtifactManager.refresh_error = repr(e)
        raise


def submit_refresh_catalog() -> Future[None]:
    """Submit the catalog refresh to the artifact-io pool. The returned Future resolves when the refresh completes.
    Raises SubmissionRejected if the task cannot be enqueued."""
    return execution_manager.submit_unmonitored(
        ConcurrentPools.ArtifactIo,
        TaskName("artifact.catalog.refresh"),
        refresh_catalog,
    )


def _download_and_publish(composite_id: CompositeArtifactId) -> None:
    """Download a single artifact and publish it as locally available."""
    logger.info(f"Starting download for artifact {composite_id}")
    # Read checkpoint without lock - safe with pyrsistent
    checkpoint = ArtifactManager.catalog.get(composite_id, None)
    if checkpoint is None:
        raise KeyError(f"Artifact not found in catalog: {composite_id}")

    def progress_callback(progress: int) -> None:
        report_artifact_download_progress(composite_id, progress=progress)

    handle = _ssh_handle_if_needed()
    download_artifact(composite_id, checkpoint, config.backend.data_path, handle=handle, progress_callback=progress_callback)

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


def _notify_download_finished(composite_id: CompositeArtifactId, is_success: bool) -> None:
    try:
        submit_event(
            Event(
                name=EventName("artifact.downloaded"),
                payload=ArtifactDownloadFinishedEvent(composite_id=composite_id, is_success=is_success),
            )
        )
    except Exception as e:
        logger.exception(f"failed to submit download-completed notification for {composite_id}: {repr(e)}")


def _download_artifact_task(composite_id: CompositeArtifactId) -> None:
    """Download a single artifact, recording the outcome in the domain state and notifying.
    Re-raises download failures after recording them."""
    try:
        _download_and_publish(composite_id)
    except Exception as e:
        logger.exception(f"artifact download failed for {composite_id}: {repr(e)}")
        report_artifact_download_progress(composite_id, failure=repr(e))
        _notify_download_finished(composite_id, is_success=False)
        raise
    _notify_download_finished(composite_id, is_success=True)


def submit_artifact_download(composite_id: CompositeArtifactId, retry: bool = False) -> Either[int, str]:  # ty: ignore[invalid-type-arguments]
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
            elif not retry:
                return Either.error(progress)
            logger.debug(f"Retrying artifact download for {composite_id}")
        ArtifactManager.ongoing_downloads = ArtifactManager.ongoing_downloads.set(composite_id, 0)

    try:
        execution_manager.submit_monitored(
            ConcurrentPools.ArtifactIo,
            TaskName("artifact.download"),
            partial(_download_artifact_task, composite_id),
        )
    except SubmissionRejected:
        # roll back the reservation so the artifact is not stuck "in progress"
        with timed_acquire(ArtifactManager.lock, timeout_acquire_task) as result:
            if not result:
                logger.error(f"failed to acquire lock to roll back the download reservation of {composite_id}")
            elif composite_id in ArtifactManager.ongoing_downloads:
                ArtifactManager.ongoing_downloads = ArtifactManager.ongoing_downloads.remove(composite_id)
        raise
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


def list_models() -> list[MlModelOverview]:
    """List all available models with overview information. Raises TimeoutError if fails to acquire"""
    with timed_acquire(ArtifactManager.lock, timeout_acquire_request) as result:
        if not result:
            raise TimeoutError

        overviews = []
        for composite_id, artifact in ArtifactManager.catalog.items():
            if artifact.artifact_type != "AnemoiCheckpoint":
                continue
            common = artifact.common
            overview = MlModelOverview(
                composite_id=composite_id,
                display_name=common.display_name,
                display_author=common.display_author,
                disk_size_bytes=common.disk_size_bytes,
                supported_platforms=common.supported_platforms,
                tags=common.tags,
                is_available=composite_id in ArtifactManager.locally_available,
                is_locally_compatible=artifact.is_locally_compatible,
                local_compatibility_detail=artifact.local_compatibility_detail,
            )
            overviews.append(overview)

        return overviews


def get_model_details(composite_id: CompositeArtifactId) -> MlModelDetail:
    """Get detailed information for a specific model. Raises KeyErorr if not present, TimeoutError if fails to acquire"""
    with timed_acquire(ArtifactManager.lock, timeout_acquire_request) as result:
        if not result:
            raise TimeoutError

        artifact = ArtifactManager.catalog[composite_id]
        if artifact.artifact_type != "AnemoiCheckpoint":
            raise KeyError(f"Artifact {composite_id} is not an AnemoiCheckpoint")
        checkpoint = artifact.specific
        common = artifact.common

        detail = MlModelDetail(
            composite_id=composite_id,
            display_name=common.display_name,
            display_author=common.display_author,
            display_description=common.display_description,
            url=common.url,
            disk_size_bytes=common.disk_size_bytes,
            pip_package_constraints=checkpoint.pip_package_constraints,
            supported_platforms=common.supported_platforms,
            tags=common.tags,
            input_qube=checkpoint.input_qube,
            output_qube=checkpoint.output_qube,
            input_characteristics=checkpoint.input_characteristics,
            is_available=composite_id in ArtifactManager.locally_available,
            is_locally_compatible=artifact.is_locally_compatible,
            local_compatibility_detail=artifact.local_compatibility_detail,
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
    # TODO delete is now blocking operation, possibly taking some time -- we may want to switch
    # to a submit-based one. Do not forget to emit a notification after completion/failure then
    handle = _ssh_handle_if_needed()
    try:
        delete_artifact(composite_id, config.backend.data_path, handle=handle)
    except Exception as e:
        logger.exception(f"Failed to delete artifact {composite_id}: {repr(e)}")
        return Either.error(f"Failed to delete: {repr(e)}")

    logger.info(f"Successfully deleted model {composite_id}")
    return Either.ok(f"Model {composite_id} deleted")
