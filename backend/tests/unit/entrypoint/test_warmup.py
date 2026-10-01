# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for the plugin-installing warmup entrypoint.

Covers reliance on `config.external.default_plugins`, the ordering of the preparation steps,
the fallback to a configured plugin when the stores do not know it, the application of
`config.external.default_plugins_settings` overrides, and the recoverable/non-recoverable
failure distinction of the install loop.
"""

import asyncio
from collections.abc import Iterator
from concurrent.futures import Future
from typing import Awaitable, Generator
from unittest.mock import MagicMock, call, patch

import pytest
from fiab_core.fable import PluginCompositeId, PluginId, PluginStoreId

import forecastbox.entrypoint.warmup as warmup_module
from forecastbox.domain.plugin.exceptions import PluginEnvironmentAlreadyBroken
from forecastbox.domain.plugin.settings import PluginSettings
from forecastbox.utility.config import DefaultPluginSettings
from forecastbox.utility.packages import PackagesError

_ALPHA = PluginCompositeId(store=PluginStoreId("store"), local=PluginId("alpha"))
_BETA = PluginCompositeId(store=PluginStoreId("store"), local=PluginId("beta"))
_SETTINGS = PluginSettings(pip_source="fiab-plugin-alpha", module_name="fiab_plugin_alpha")


def _run_coro_without_touching_global_loop(coro: Generator | Awaitable) -> None:
    """Stand-in for `asyncio.run` used by the tests.

    `asyncio.run` creates a fresh event loop and, on exit, resets the current event loop of
    the thread to `None` (`asyncio.set_event_loop(None)`). That is harmless for the real
    entrypoint, which runs in a dedicated process, but is disruptive here: this module's unit
    tests run in-process together with the rest of the suite, and pytest-asyncio's fixtures
    call `asyncio.get_event_loop()` to save/restore the "current" loop around each async test.
    Once that loop is `None`, `get_event_loop()` transparently creates a brand new one to hand
    back, which is never used and never closed, and only gets garbage collected at some later,
    arbitrary point -- surfacing as an unclosed-event-loop `ResourceWarning`/unraisable exception
    at session teardown, unrelated to whichever test happened to be running then.

    Running the coroutine on a throwaway loop that never touches `asyncio.set_event_loop` avoids
    that side effect while still exercising the same coroutine.
    """
    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(coro)
    finally:
        loop.close()


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
        patch.object(warmup_module, "resolve_plugin_from_store", parent.resolve_plugin_from_store),
        patch.object(warmup_module, "update_single", parent.update_single),
        patch.object(warmup_module, "upsert_plugin_state", parent.upsert_plugin_state),
        patch.object(warmup_module, "unload_single", parent.unload_single),
        # NOTE see `_run_coro_without_touching_global_loop` for why we do not let the real
        # `asyncio.run` execute here
        patch.object(warmup_module.asyncio, "run", _run_coro_without_touching_global_loop),
    ):
        # NOTE start_db_schema is awaited by the warmup, hence it must return an awaitable
        async def _noop() -> None:
            return None

        parent.start_db_schema.side_effect = lambda: _noop()
        parent.submit_refresh_catalog.return_value = catalog_future
        parent.resolve_plugin_from_store.return_value = _SETTINGS
        yield {"parent": parent}


def test_defaults_to_configured_default_plugins(warmup_mocks: dict[str, MagicMock]) -> None:
    parent = warmup_mocks["parent"]
    with patch.object(warmup_module.config.external, "default_plugins", [_ALPHA]):
        warmup_module.warmup()
    parent.update_single.assert_called_once_with(_ALPHA, _SETTINGS, install=True, version=None)


def test_multiple_default_plugins_are_installed_in_order(warmup_mocks: dict[str, MagicMock]) -> None:
    parent = warmup_mocks["parent"]
    with patch.object(warmup_module.config.external, "default_plugins", [_ALPHA, _BETA]):
        warmup_module.warmup()
    assert [call.args[0] for call in parent.update_single.call_args_list] == [_ALPHA, _BETA]


def test_preparation_precedes_installation(warmup_mocks: dict[str, MagicMock]) -> None:
    parent = warmup_mocks["parent"]
    with patch.object(warmup_module.config.external, "default_plugins", [_ALPHA]):
        warmup_module.warmup()
    ordering = [call[0] for call in parent.mock_calls if not call[0].startswith("submit_refresh_catalog.")]
    assert ordering.index("start_db_schema") < ordering.index("update_single")
    assert ordering.index("start_artifact_provider") < ordering.index("update_single")
    assert ordering.index("initialize_stores") < ordering.index("update_single")
    assert ordering.index("update_single") < ordering.index("join_artifact_manager")


def test_unknown_to_store_falls_back_to_db(warmup_mocks: dict[str, MagicMock]) -> None:
    parent = warmup_mocks["parent"]
    parent.resolve_plugin_from_store.side_effect = ValueError("plugin with id alpha not known to store store")
    db_state = MagicMock()
    db_state.to_settings.return_value = _SETTINGS
    with (
        patch.object(warmup_module, "get_plugin_state", return_value=db_state),
        patch.object(warmup_module.config.external, "default_plugins", [_ALPHA]),
    ):
        warmup_module.warmup()
    parent.update_single.assert_called_once_with(_ALPHA, _SETTINGS, install=True, version=None)


def test_unknown_plugin_fails(warmup_mocks: dict[str, MagicMock]) -> None:
    parent = warmup_mocks["parent"]
    parent.resolve_plugin_from_store.side_effect = ValueError("plugin with id alpha not known to store store")
    with (
        patch.object(warmup_module, "get_plugin_state", return_value=None),
        patch.object(warmup_module.config.external, "default_plugins", [_ALPHA]),
    ):
        with pytest.raises(SystemExit):
            warmup_module.warmup()
    parent.update_single.assert_not_called()


def test_recoverable_failure_continues_and_exits_nonzero(warmup_mocks: dict[str, MagicMock]) -> None:
    parent = warmup_mocks["parent"]
    parent.update_single.side_effect = [RuntimeError("install failed for alpha"), None]
    with patch.object(warmup_module.config.external, "default_plugins", [_ALPHA, _BETA]):
        with pytest.raises(SystemExit) as exit_info:
            warmup_module.warmup()
    assert exit_info.value.code != 0
    assert [call.args[0] for call in parent.update_single.call_args_list] == [_ALPHA, _BETA]
    parent.join_artifact_manager.assert_called_once()


@pytest.mark.parametrize("error", [PluginEnvironmentAlreadyBroken("uv pip check failed"), PackagesError("cannot freeze")])
def test_environment_failure_aborts_immediately(warmup_mocks: dict[str, MagicMock], error: Exception) -> None:
    parent = warmup_mocks["parent"]
    parent.update_single.side_effect = error
    with patch.object(warmup_module.config.external, "default_plugins", [_ALPHA, _BETA]):
        with pytest.raises(type(error)):
            warmup_module.warmup()
    assert [call.args[0] for call in parent.update_single.call_args_list] == [_ALPHA]
    parent.join_artifact_manager.assert_called_once()


def test_no_settings_override_skips_settings_application(warmup_mocks: dict[str, MagicMock]) -> None:
    parent = warmup_mocks["parent"]
    with (
        patch.object(warmup_module.config.external, "default_plugins", [_ALPHA]),
        patch.object(warmup_module.config.external, "default_plugins_settings", {}),
    ):
        warmup_module.warmup()
    parent.upsert_plugin_state.assert_not_called()
    parent.unload_single.assert_not_called()
    parent.update_single.assert_called_once_with(_ALPHA, _SETTINGS, install=True, version=None)


def test_settings_override_is_persisted_and_reingested(warmup_mocks: dict[str, MagicMock]) -> None:
    parent = warmup_mocks["parent"]
    override = DefaultPluginSettings(excluded_templates=["foo"], glyph_remapping={"a": "b"})
    with (
        patch.object(warmup_module.config.external, "default_plugins", [_ALPHA]),
        patch.object(warmup_module.config.external, "default_plugins_settings", {_ALPHA: override}),
    ):
        warmup_module.warmup()
    parent.upsert_plugin_state.assert_called_once_with(
        plugin_id="store:alpha",
        enabled=None,
        excluded_templates=["foo"],
        glyph_remapping={"a": "b"},
        update_strategy=None,
    )
    parent.unload_single.assert_not_called()
    # NOTE second call re-loads/re-ingests the plugin so the overridden exclusions/remapping apply
    assert parent.update_single.call_args_list == [
        call(_ALPHA, _SETTINGS, install=True, version=None),
        call(_ALPHA, _SETTINGS, install=False, version=None),
    ]


def test_settings_override_disabling_plugin_unloads_instead_of_reingesting(warmup_mocks: dict[str, MagicMock]) -> None:
    parent = warmup_mocks["parent"]
    override = DefaultPluginSettings(is_enabled=False)
    with (
        patch.object(warmup_module.config.external, "default_plugins", [_ALPHA]),
        patch.object(warmup_module.config.external, "default_plugins_settings", {_ALPHA: override}),
    ):
        warmup_module.warmup()
    parent.upsert_plugin_state.assert_called_once_with(
        plugin_id="store:alpha",
        enabled=False,
        excluded_templates=None,
        glyph_remapping=None,
        update_strategy=None,
    )
    parent.unload_single.assert_called_once_with(_ALPHA)
    parent.update_single.assert_called_once_with(_ALPHA, _SETTINGS, install=True, version=None)
