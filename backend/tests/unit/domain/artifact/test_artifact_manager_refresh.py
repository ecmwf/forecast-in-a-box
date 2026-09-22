# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Focused unit tests for domain.artifact.manager's catalog-refresh future contract.

``submit_refresh_catalog()`` is the startup dependency that
``domain.plugin.manager.submit_load_plugins`` waits on via ``submit_after``. A
failed refresh must both retain the existing ``ArtifactManager.refresh_error``
behaviour and leave the returned ``Future`` carrying the exception, so that
dependents can observe the failure through the future's own contract.
"""

from collections.abc import Generator
from unittest.mock import patch

import pytest

from forecastbox.domain.artifact.manager import ArtifactManager, _refresh_catalog_task, submit_refresh_catalog


@pytest.fixture(autouse=True)
def _reset_artifact_manager() -> Generator[None, None, None]:
    ArtifactManager.refresh_error = None
    yield
    ArtifactManager.refresh_error = None


def test_refresh_catalog_task_reraises_and_retains_refresh_error() -> None:
    with patch("forecastbox.domain.artifact.manager.get_artifacts_catalog", side_effect=RuntimeError("catalog boom")):
        with pytest.raises(RuntimeError, match="catalog boom"):
            _refresh_catalog_task()
    assert ArtifactManager.refresh_error is not None
    assert "catalog boom" in ArtifactManager.refresh_error


def test_submit_refresh_catalog_future_carries_exception_on_failure() -> None:
    with patch("forecastbox.domain.artifact.manager.get_artifacts_catalog", side_effect=RuntimeError("catalog boom")):
        future = submit_refresh_catalog()
        with pytest.raises(RuntimeError, match="catalog boom"):
            future.result(timeout=5)
    assert ArtifactManager.refresh_error is not None
    assert "catalog boom" in ArtifactManager.refresh_error
