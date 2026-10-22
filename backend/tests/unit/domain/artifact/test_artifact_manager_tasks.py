# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for the pool submission and download task behaviour of domain.artifact.manager."""

from collections.abc import Callable, Generator
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from fiab_core.artifacts import ArtifactLocalId, ArtifactStoreId, CompositeArtifactId
from pyrsistent import pmap, pset

import forecastbox.domain.artifact.manager as manager
from forecastbox.domain.artifact.events import ArtifactDownloadFinishedEvent
from forecastbox.domain.artifact.manager import ArtifactManager, submit_artifact_download, submit_refresh_catalog
from forecastbox.utility.concurrency.manager import ConcurrentPools, SubmissionRejected, TaskName, execution_manager


@pytest.fixture
def artifact_id() -> Any:
    return CompositeArtifactId(artifact_store_id=ArtifactStoreId("store"), artifact_local_id=ArtifactLocalId("model"))


@pytest.fixture(autouse=True)
def _reset_state() -> Generator[None, None, None]:
    saved = (ArtifactManager.catalog, ArtifactManager.locally_available, ArtifactManager.ongoing_downloads)
    yield
    ArtifactManager.catalog, ArtifactManager.locally_available, ArtifactManager.ongoing_downloads = saved


def _events(submit_event: MagicMock) -> list[ArtifactDownloadFinishedEvent]:
    return [c.args[0].payload for c in submit_event.call_args_list]


def test_no_executor_attribute() -> None:
    assert not hasattr(ArtifactManager, "executor")


def test_submit_refresh_catalog_uses_artifact_pool() -> None:
    recorded: list[tuple[Any, Any, Callable[[], Any]]] = []
    with patch.object(execution_manager, "submit_unmonitored", side_effect=lambda p, n, t: recorded.append((p, n, t))):
        submit_refresh_catalog()
    assert len(recorded) == 1
    assert recorded[0][0] == ConcurrentPools.ArtifactIo
    assert recorded[0][1] == TaskName("artifact.catalog.refresh")
    assert recorded[0][2] is manager.refresh_catalog


def _setup_catalog(artifact_id: Any) -> None:
    ArtifactManager.catalog = pmap({artifact_id: MagicMock()})
    ArtifactManager.locally_available = pset()
    ArtifactManager.ongoing_downloads = pmap()


def test_submit_download_submits_monitored_task(artifact_id: Any) -> None:
    _setup_catalog(artifact_id)
    recorded: list[tuple[Any, Any]] = []
    with patch.object(execution_manager, "submit_monitored", side_effect=lambda p, n, t: recorded.append((p, n))):
        result = submit_artifact_download(artifact_id)
    assert result.t == 0 and result.e is None
    assert recorded == [(ConcurrentPools.ArtifactIo, TaskName("artifact.download"))]
    assert ArtifactManager.ongoing_downloads[artifact_id] == 0


def test_rejected_submission_rolls_back_reservation(artifact_id: Any) -> None:
    _setup_catalog(artifact_id)
    with patch.object(execution_manager, "submit_monitored", side_effect=SubmissionRejected("full")):
        with pytest.raises(SubmissionRejected):
            submit_artifact_download(artifact_id)
    assert artifact_id not in ArtifactManager.ongoing_downloads


def test_successful_download_publishes_and_notifies(artifact_id: Any) -> None:
    _setup_catalog(artifact_id)
    with patch.object(manager, "download_artifact"), patch.object(manager, "submit_event") as submit_event:
        result = submit_artifact_download(artifact_id)
        assert result.e is None
    assert artifact_id in ArtifactManager.locally_available
    assert artifact_id not in ArtifactManager.ongoing_downloads
    events = _events(submit_event)
    assert len(events) == 1 and events[0].is_success is True


def test_failed_download_records_failure_notifies_and_reraises(artifact_id: Any) -> None:
    _setup_catalog(artifact_id)
    ArtifactManager.ongoing_downloads = pmap({artifact_id: 0})
    with (
        patch.object(manager, "download_artifact", side_effect=RuntimeError("dl boom")),
        patch.object(manager, "submit_event") as submit_event,
    ):
        with pytest.raises(RuntimeError, match="dl boom"):
            manager._download_artifact_task(artifact_id)
    failure = ArtifactManager.ongoing_downloads[artifact_id]
    assert isinstance(failure, str) and "dl boom" in failure
    assert artifact_id not in ArtifactManager.locally_available
    events = _events(submit_event)
    assert len(events) == 1 and events[0].is_success is False
