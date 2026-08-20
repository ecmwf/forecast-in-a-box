# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for plugin status utility functions -- status_brief, plugins_ready, catalogue_view."""

from collections.abc import Generator
from unittest.mock import MagicMock, patch

import pytest
from fiab_core.fable import PluginCompositeId, PluginId, PluginStoreId
from pyrsistent import pmap

from forecastbox.domain.plugin.state import PluginManager
from forecastbox.domain.plugin.status import catalogue_view, plugins_ready, status_brief

_PLUGIN_ID = PluginCompositeId(store=PluginStoreId("store"), local=PluginId("plugin"))


@pytest.fixture(autouse=True)
def _reset_plugin_state() -> Generator[None, None, None]:
    PluginManager.plugins = pmap()
    yield
    PluginManager.plugins = pmap()


def test_status_brief_ok() -> None:
    with patch("forecastbox.domain.plugin.status.PluginManager") as mock_pm:
        mock_pm.updater_error = None
        mock_pm.operation_in_progress = False
        assert status_brief() == "ok"


def test_status_brief_running() -> None:
    with patch("forecastbox.domain.plugin.status.PluginManager") as mock_pm:
        mock_pm.updater_error = None
        mock_pm.operation_in_progress = True
        assert status_brief() == "running"


def test_status_brief_failure() -> None:
    with patch("forecastbox.domain.plugin.status.PluginManager") as mock_pm:
        mock_pm.updater_error = "some error"
        mock_pm.operation_in_progress = False
        result = status_brief()
        assert result.startswith("failure:")
        assert "some error" in result


def test_plugins_ready_true_when_ok() -> None:
    with patch("forecastbox.domain.plugin.status.PluginManager") as mock_pm:
        mock_pm.updater_error = None
        mock_pm.operation_in_progress = False
        assert plugins_ready() is True


def test_plugins_ready_false_when_running() -> None:
    with patch("forecastbox.domain.plugin.status.PluginManager") as mock_pm:
        mock_pm.updater_error = None
        mock_pm.operation_in_progress = True
        assert plugins_ready() is False


def test_plugins_ready_false_when_failed() -> None:
    with patch("forecastbox.domain.plugin.status.PluginManager") as mock_pm:
        mock_pm.updater_error = "crash"
        mock_pm.operation_in_progress = False
        assert plugins_ready() is False


# ---------------------------------------------------------------------------
# catalogue_view
# ---------------------------------------------------------------------------


def test_catalogue_view_returns_snapshot_of_published_plugins() -> None:
    plugin = MagicMock()
    plugin.catalogue = "fake-catalogue"
    PluginManager.plugins = pmap({_PLUGIN_ID: plugin})

    result = catalogue_view()

    assert result == {_PLUGIN_ID: "fake-catalogue"}


def test_catalogue_view_returns_false_when_lock_not_acquired() -> None:
    busy_lock = PluginManager.lock
    busy_lock.acquire()
    try:
        assert catalogue_view() is False
    finally:
        busy_lock.release()
