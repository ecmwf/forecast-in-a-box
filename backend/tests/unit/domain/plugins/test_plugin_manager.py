# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for PluginManager utility functions -- status_brief and plugins_ready."""

from unittest.mock import MagicMock, patch

from forecastbox.domain.plugin.manager import plugins_ready, status_brief


def _make_manager(*, updater_error: str | None, alive: bool) -> MagicMock:
    mock = MagicMock()
    mock.updater_error = updater_error
    mock.updater = MagicMock(is_alive=MagicMock(return_value=alive))
    return mock


def test_status_brief_ok() -> None:
    with patch("forecastbox.domain.plugin.manager.PluginManager") as mock_pm:
        mock_pm.updater_error = None
        mock_pm.updater = MagicMock(is_alive=MagicMock(return_value=False))
        assert status_brief() == "ok"


def test_status_brief_running() -> None:
    with patch("forecastbox.domain.plugin.manager.PluginManager") as mock_pm:
        mock_pm.updater_error = None
        mock_pm.updater = MagicMock(is_alive=MagicMock(return_value=True))
        assert status_brief() == "running"


def test_status_brief_failure() -> None:
    with patch("forecastbox.domain.plugin.manager.PluginManager") as mock_pm:
        mock_pm.updater_error = "some error"
        mock_pm.updater = MagicMock(is_alive=MagicMock(return_value=False))
        result = status_brief()
        assert result.startswith("failure:")
        assert "some error" in result


def test_plugins_ready_true_when_ok() -> None:
    with patch("forecastbox.domain.plugin.manager.PluginManager") as mock_pm:
        mock_pm.updater_error = None
        mock_pm.updater = MagicMock(is_alive=MagicMock(return_value=False))
        assert plugins_ready() is True


def test_plugins_ready_false_when_running() -> None:
    with patch("forecastbox.domain.plugin.manager.PluginManager") as mock_pm:
        mock_pm.updater_error = None
        mock_pm.updater = MagicMock(is_alive=MagicMock(return_value=True))
        assert plugins_ready() is False


def test_plugins_ready_false_when_failed() -> None:
    with patch("forecastbox.domain.plugin.manager.PluginManager") as mock_pm:
        mock_pm.updater_error = "crash"
        mock_pm.updater = MagicMock(is_alive=MagicMock(return_value=False))
        assert plugins_ready() is False
