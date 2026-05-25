# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""
Downloading and managing artifacts such as ml model checkpoints.

All the methods here are blocking -- see manager for nonblocking invocations.
Supports both local (file://) and remote (ssh://) data directories.
"""

import logging
import shlex
import shutil
import subprocess
import tempfile
import urllib.parse
from collections.abc import Callable
from pathlib import Path

import httpx
from fiab_core.artifacts import ArtifactLocalId, ArtifactResolved, ArtifactStoreId

from forecastbox.domain.artifact.base import ArtifactCatalog, CompositeArtifactId, artifacts_subdir, get_artifact_local_path
from forecastbox.utility import tunnel
from forecastbox.utility.tunnel import CommandHandle

logger = logging.getLogger(__name__)


def _parse_data_dir_url(data_dir_url: str) -> tuple[str, str, str]:
    """Parse a data_dir URL into (scheme, netloc, path). Raises ValueError on error."""
    if "://" not in data_dir_url:
        raise ValueError(f"Invalid data_dir URL (missing scheme): {data_dir_url}")
    parsed = urllib.parse.urlparse(data_dir_url)
    if not parsed.scheme:
        raise ValueError(f"Invalid data_dir URL (no scheme): {data_dir_url}")
    return parsed.scheme, parsed.netloc, parsed.path


# ---------------------------------------------------------------------------
# Listing
# ---------------------------------------------------------------------------


def _enumerate_artifacts_local(data_dir: str) -> list[tuple[str, str]]:
    """Return (store_id, artifact_id) pairs from local filesystem."""
    artifacts_base = Path(data_dir) / artifacts_subdir
    if not artifacts_base.exists():
        return []

    entries: list[tuple[str, str]] = []
    for store_item in artifacts_base.iterdir():
        if not store_item.is_dir():
            logger.warning(f"Found non-directory item in artifacts directory: {store_item.name}")
            continue
        store_id = store_item.name
        for checkpoint_item in store_item.iterdir():
            if checkpoint_item.is_dir():
                logger.warning(f"Found directory instead of file for checkpoint: {checkpoint_item.name}")
                continue
            entries.append((store_id, checkpoint_item.name))
    return entries


def _enumerate_artifacts_remote(path: str, handle: CommandHandle) -> list[tuple[str, str]]:
    """Return (store_id, artifact_id) pairs from a remote host via SSH."""
    artifacts_base = path.rstrip("/") + "/" + artifacts_subdir
    cmd = f"find {shlex.quote(artifacts_base)} -mindepth 2 -maxdepth 2 -not -type d 2>/dev/null || true"
    result = tunnel.run(handle, cmd)

    prefix = artifacts_base.rstrip("/") + "/"
    entries: list[tuple[str, str]] = []
    for line in result.stdout.splitlines():
        line = line.strip()
        if not line or not line.startswith(prefix):
            continue
        rest = line[len(prefix) :]
        parts = rest.split("/", 1)
        if len(parts) == 2:
            entries.append((parts[0], parts[1]))
    return entries


def _match_artifacts_to_catalog(catalog: ArtifactCatalog, entries: list[tuple[str, str]]) -> list[CompositeArtifactId]:
    """Filter (store_id, artifact_id) pairs against the catalog, returning matching CompositeArtifactIds."""
    known_store_ids = {artifact_id.artifact_store_id for artifact_id in catalog.keys()}
    result: list[CompositeArtifactId] = []
    for store_id, checkpoint_id in entries:
        if store_id not in known_store_ids:
            logger.warning(f"Found unknown artifact store directory: {store_id}")
            continue
        composite_id = CompositeArtifactId(
            artifact_store_id=ArtifactStoreId(store_id),
            artifact_local_id=ArtifactLocalId(checkpoint_id),
        )
        if composite_id in catalog:
            result.append(composite_id)
        else:
            logger.warning(f"Found local artifact not in catalog: {composite_id}")
    return result


def list_storage(catalog: ArtifactCatalog, data_dir_url: str, handle: CommandHandle | None = None) -> list[CompositeArtifactId]:
    """List stored artifacts at the given data_dir_url (file:// or ssh://)."""
    scheme, _netloc, path = _parse_data_dir_url(data_dir_url)
    if scheme == "file":
        entries = _enumerate_artifacts_local(path)
    elif scheme == "ssh":
        if handle is None:
            raise ValueError("SSH handle required for ssh:// data_dir_url")
        entries = _enumerate_artifacts_remote(path, handle)
    else:
        raise NotImplementedError(f"Unsupported data_dir scheme: {scheme!r}")
    return _match_artifacts_to_catalog(catalog, entries)


# ---------------------------------------------------------------------------
# Downloading
# ---------------------------------------------------------------------------


def _download_artifact_local(
    composite_id: CompositeArtifactId,
    artifact: ArtifactResolved,
    data_dir_url: str,
    progress_callback: Callable[[int], None] | None = None,
) -> None:
    """Download an artifact from its remote URL to local storage."""
    checkpoint = artifact.store_info
    artifact_path = get_artifact_local_path(composite_id, data_dir_url)
    artifact_path.parent.mkdir(parents=True, exist_ok=True)

    temp_file = tempfile.NamedTemporaryFile(prefix="artifact_", suffix=".ckpt", delete=False)
    temp_path = Path(temp_file.name)
    temp_file.close()

    try:
        with httpx.Client(follow_redirects=True, timeout=300.0) as client:
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
                            if total > 0:
                                progress = int(float(downloaded) / total * 100)
                                logger.debug(f"Download progress: {progress}%")
                                if progress_callback:
                                    progress_callback(progress)

        logger.debug(f"Download completed for {composite_id}, total bytes: {downloaded}")
        shutil.move(str(temp_path), str(artifact_path))
        logger.info(f"Successfully downloaded artifact {composite_id} to {artifact_path}")

    except Exception as e:
        if temp_path.exists():
            temp_path.unlink()
        logger.error(f"Failed to download artifact {composite_id}: {e}")
        raise


def _download_artifact_remote(
    composite_id: CompositeArtifactId,
    artifact: ArtifactResolved,
    data_dir_url: str,
    handle: CommandHandle,
) -> None:
    """Download an artifact from its HTTP URL to remote storage via SSH curl."""
    checkpoint = artifact.store_info
    artifact_path = get_artifact_local_path(composite_id, data_dir_url)
    temp_path = str(artifact_path) + ".tmp"

    logger.debug(f"Starting remote download for {composite_id} from {checkpoint.url}")

    tunnel.run(handle, f"mkdir -p {shlex.quote(str(artifact_path.parent))}")

    curl_cmd = f"curl -fsSL -o {shlex.quote(temp_path)} {shlex.quote(checkpoint.url)} && mv {shlex.quote(temp_path)} {shlex.quote(str(artifact_path))}"
    try:
        tunnel.run(handle, curl_cmd)
    except subprocess.CalledProcessError as e:
        try:
            tunnel.run(handle, f"rm -f {shlex.quote(temp_path)}")
        except Exception as cleanup_err:
            logger.warning(f"Could not clean up remote temp file {temp_path!r}: {cleanup_err}")
        logger.error(f"Failed remote download for {composite_id}: {e.stderr}")
        raise

    logger.info(f"Successfully downloaded artifact {composite_id} to {artifact_path} on {handle.host}")


def download_artifact(
    composite_id: CompositeArtifactId,
    artifact: ArtifactResolved,
    data_dir_url: str,
    handle: CommandHandle | None = None,
    progress_callback: Callable[[int], None] | None = None,
) -> None:
    """Download an artifact to local or remote storage, dispatching on the data_dir_url scheme.
    `handle` required for `ssh://` scheme."""
    scheme, _netloc, path = _parse_data_dir_url(data_dir_url)
    if scheme == "file":
        _download_artifact_local(composite_id, artifact, data_dir_url, progress_callback)
    elif scheme == "ssh":
        if handle is None:
            raise ValueError("SSH handle required for ssh:// data_dir_url")
        _download_artifact_remote(composite_id, artifact, data_dir_url, handle)
    else:
        raise NotImplementedError(f"Unsupported data_dir scheme: {scheme!r}")


# ---------------------------------------------------------------------------
# Deleting
# ---------------------------------------------------------------------------


def _delete_artifact_local(composite_id: CompositeArtifactId, data_dir_url: str) -> None:
    """Delete a locally stored artifact file."""
    artifact_path = get_artifact_local_path(composite_id, data_dir_url)
    if not artifact_path.exists():
        raise FileNotFoundError(f"Artifact file not found: {artifact_path}")
    artifact_path.unlink()
    logger.info(f"Deleted artifact {composite_id} from {artifact_path}")


def _delete_artifact_remote(composite_id: CompositeArtifactId, data_dir_url: str, handle: CommandHandle) -> None:
    """Delete a remotely stored artifact file via SSH."""
    artifact_path = str(get_artifact_local_path(composite_id, data_dir_url))
    try:
        tunnel.run(handle, f"rm {shlex.quote(artifact_path)}")
    except subprocess.CalledProcessError as e:
        stderr = (e.stderr or "").lower()
        if "no such file or directory" in stderr:
            raise FileNotFoundError(f"Artifact file not found on remote: {artifact_path}") from e
        raise
    logger.info(f"Deleted remote artifact {composite_id} at {artifact_path} on {handle.host}")


def delete_artifact(
    composite_id: CompositeArtifactId,
    data_dir_url: str,
    handle: CommandHandle | None = None,
) -> None:
    """Delete an artifact from local or remote storage, dispatching on the data_dir_url scheme."""
    scheme, _netloc, _path = _parse_data_dir_url(data_dir_url)
    if scheme == "file":
        _delete_artifact_local(composite_id, data_dir_url)
    elif scheme == "ssh":
        if handle is None:
            raise ValueError("SSH handle required for ssh:// data_dir_url")
        _delete_artifact_remote(composite_id, data_dir_url, handle)
    else:
        raise NotImplementedError(f"Unsupported data_dir scheme: {scheme!r}")
