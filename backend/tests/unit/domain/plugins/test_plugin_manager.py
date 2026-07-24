# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for PluginManager utility functions and sync template ingestion."""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fiab_core.fable import PluginCompositeId, PluginId, PluginStoreId

from forecastbox.domain.plugin.manager import PluginManager, _ingest_plugin_templates, plugins_ready, status_brief


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


def test_plugin_manager_has_no_stored_loop_and_ingestion_uses_jobs_db_helper() -> None:
    assert not hasattr(PluginManager, "loop")

    plugin_id = PluginCompositeId(store=PluginStoreId("test"), local=PluginId("plugin"))
    plugin = MagicMock(blueprint_templates=())
    state = SimpleNamespace(asset_ingest_needed=True, excluded_templates=[], glyph_remapping={})
    seen: list[str] = []

    def fake_jobs_db_result(task_name: str, task: object) -> object:
        del task
        seen.append(task_name)
        if task_name == "plugin.get-state":
            return state
        return None

    with patch("forecastbox.domain.plugin.manager._jobs_db_result", side_effect=fake_jobs_db_result):
        _ingest_plugin_templates(plugin_id, plugin)

    assert seen == [
        "plugin.get-state",
        "plugin.clear-asset-ingest-needed",
        "plugin.update-template-errors",
    ]
