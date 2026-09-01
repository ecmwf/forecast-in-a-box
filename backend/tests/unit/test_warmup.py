# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for the plugin-installing warmup entrypoint.

Covers the `-p` argument parsing, the ordering of the preparation steps, the fallback to a
configured plugin when the stores do not know it, and the recoverable/non-recoverable failure
distinction of the install loop.
"""

from collections.abc import Iterator
from concurrent.futures import Future
from unittest.mock import MagicMock, patch

import pytest
from fiab_core.fable import PluginCompositeId, PluginId, PluginStoreId

import forecastbox.entrypoint.warmup as warmup_module
from forecastbox.domain.plugin.exceptions import PluginEnvironmentAlreadyBroken
from forecastbox.utility.config import PluginSettings
from forecastbox.utility.packages import PackagesError

_ALPHA = PluginCompositeId(store=PluginStoreId("store"), local=PluginId("alpha"))
_BETA = PluginCompositeId(store=PluginStoreId("store"), local=PluginId("beta"))
_SETTINGS = PluginSettings(pip_source="fiab-plugin-alpha", module_name="fiab_plugin_alpha")


@pytest.fixture
def warmup_mocks() -> Iterator[dict[str, MagicMock]]:
    """Replace every side-effecting step of the warmup with a mock recording into a shared parent"""
    parent = MagicMock()
    catalog_future: Future[None] = Future()
    catalog_future.set_result(None)
    with (
        patch.object(warmup_module, "setup_process", parent.setup_process),
        patch.object(warmup_module, "validate_runtime", parent.validate_runtime),
        patch.object(warmup_module, "start_db_schema", parent.start_db_schema),
        patch.object(warmup_module, "start_artifact_provider", parent.start_artifact_provider),
        patch.object(warmup_module, "submit_refresh_catalog", parent.submit_refresh_catalog),
        patch.object(warmup_module, "initialize_stores", parent.initialize_stores),
        patch.object(warmup_module, "join_artifact_manager", parent.join_artifact_manager),
        patch.object(warmup_module, "register_plugin_from_store", parent.register_plugin_from_store),
        patch.object(warmup_module, "update_single", parent.update_single),
    ):
        # NOTE start_db_schema is awaited by the warmup, hence it must return an awaitable
        async def _noop() -> None:
            return None

        parent.start_db_schema.side_effect = lambda: _noop()
        parent.submit_refresh_catalog.return_value = catalog_future
        parent.register_plugin_from_store.return_value = _SETTINGS
        yield {"parent": parent}


def test_defaults_to_configured_default_plugins(warmup_mocks: dict[str, MagicMock]) -> None:
    parent = warmup_mocks["parent"]
    with patch.object(warmup_module, "_default_plugins", lambda: {_ALPHA: _SETTINGS}):
        warmup_module.warmup()
    parent.update_single.assert_called_once_with(_ALPHA, _SETTINGS, install=True, version=None)


def test_explicit_plugins_are_installed_in_order(warmup_mocks: dict[str, MagicMock]) -> None:
    parent = warmup_mocks["parent"]
    warmup_module.warmup(plugin=("store:alpha", "store:beta"))
    assert [call.args[0] for call in parent.update_single.call_args_list] == [_ALPHA, _BETA]
    # a single -p arrives as a plain string
    parent.update_single.reset_mock()
    warmup_module.warmup(plugin="store:beta")
    parent.update_single.assert_called_once_with(_BETA, _SETTINGS, install=True, version=None)


def test_preparation_precedes_installation(warmup_mocks: dict[str, MagicMock]) -> None:
    parent = warmup_mocks["parent"]
    warmup_module.warmup(plugin="store:alpha")
    ordering = [call[0] for call in parent.mock_calls if not call[0].startswith("submit_refresh_catalog.")]
    assert ordering.index("start_db_schema") < ordering.index("update_single")
    assert ordering.index("start_artifact_provider") < ordering.index("update_single")
    assert ordering.index("initialize_stores") < ordering.index("update_single")
    assert ordering.index("update_single") < ordering.index("join_artifact_manager")


def test_invalid_plugin_id_is_rejected(warmup_mocks: dict[str, MagicMock]) -> None:
    parent = warmup_mocks["parent"]
    with pytest.raises(ValueError):
        warmup_module.warmup(plugin="no-store-prefix")
    parent.update_single.assert_not_called()


def test_unknown_to_store_falls_back_to_config(warmup_mocks: dict[str, MagicMock]) -> None:
    parent = warmup_mocks["parent"]
    parent.register_plugin_from_store.side_effect = ValueError("plugin with id alpha not known to store store")
    with patch.dict(warmup_module.config.external.plugins, {_ALPHA: _SETTINGS}, clear=False):
        warmup_module.warmup(plugin="store:alpha")
    parent.update_single.assert_called_once_with(_ALPHA, _SETTINGS, install=True, version=None)


def test_unknown_plugin_fails(warmup_mocks: dict[str, MagicMock]) -> None:
    parent = warmup_mocks["parent"]
    parent.register_plugin_from_store.side_effect = ValueError("plugin with id alpha not known to store store")
    with pytest.raises(SystemExit):
        warmup_module.warmup(plugin="store:alpha")
    parent.update_single.assert_not_called()


def test_recoverable_failure_continues_and_exits_nonzero(warmup_mocks: dict[str, MagicMock]) -> None:
    parent = warmup_mocks["parent"]
    parent.update_single.side_effect = [RuntimeError("install failed for alpha"), None]
    with pytest.raises(SystemExit) as exit_info:
        warmup_module.warmup(plugin=("store:alpha", "store:beta"))
    assert exit_info.value.code != 0
    assert [call.args[0] for call in parent.update_single.call_args_list] == [_ALPHA, _BETA]
    parent.join_artifact_manager.assert_called_once()


@pytest.mark.parametrize("error", [PluginEnvironmentAlreadyBroken("uv pip check failed"), PackagesError("cannot freeze")])
def test_environment_failure_aborts_immediately(warmup_mocks: dict[str, MagicMock], error: Exception) -> None:
    parent = warmup_mocks["parent"]
    parent.update_single.side_effect = error
    with pytest.raises(type(error)):
        warmup_module.warmup(plugin=("store:alpha", "store:beta"))
    assert [call.args[0] for call in parent.update_single.call_args_list] == [_ALPHA]
    parent.join_artifact_manager.assert_called_once()
