# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for the template hook invocation in domain.plugin.loading."""

from collections.abc import Generator
from unittest.mock import MagicMock, patch

import pytest
from fiab_core.fable import PluginCompositeId, PluginId, PluginStoreId
from pyrsistent import pmap

import forecastbox.domain.plugin.loading as loading
import forecastbox.entrypoint.initializers as initializers
from forecastbox.domain.plugin.exceptions import PluginTemplateHooksNotRegistered, PluginTemplateIngestFailed
from forecastbox.domain.plugin.state import PluginManager
from forecastbox.domain.plugin.template_hooks import TemplateHooks, _TemplateHooksSlot, get_template_hooks, register_template_hooks

_ID1 = PluginCompositeId(store=PluginStoreId("s"), local=PluginId("p1"))
_ID2 = PluginCompositeId(store=PluginStoreId("s"), local=PluginId("p2"))


@pytest.fixture(autouse=True)
def _reset() -> Generator[None, None, None]:
    PluginManager.plugins = pmap()
    PluginManager.errors = pmap()
    previous = _TemplateHooksSlot.hooks
    yield
    PluginManager.plugins = pmap()
    PluginManager.errors = pmap()
    _TemplateHooksSlot.hooks = previous


def _register(on_changed: MagicMock | None = None, on_removed: MagicMock | None = None) -> TemplateHooks:
    hooks = TemplateHooks(on_changed=on_changed or MagicMock(), on_removed=on_removed or MagicMock())
    register_template_hooks(hooks)
    return hooks


def test_get_template_hooks_raises_when_not_registered() -> None:
    _TemplateHooksSlot.hooks = None
    with pytest.raises(PluginTemplateHooksNotRegistered):
        get_template_hooks()


def test_unload_single_publishes_only_after_successful_removal() -> None:
    calls: list[str] = []
    _register(on_removed=MagicMock(side_effect=lambda i: calls.append("remove")))
    with patch.object(loading, "publish_unloaded", side_effect=lambda i: calls.append("publish") or True):
        loading.unload_single(_ID1)
    assert calls == ["remove", "publish"]


def test_unload_single_does_not_publish_when_removal_fails() -> None:
    _register(on_removed=MagicMock(side_effect=RuntimeError("x")))
    with patch.object(loading, "publish_unloaded") as publish:
        with pytest.raises(RuntimeError):
            loading.unload_single(_ID1)
    publish.assert_not_called()


def test_uninstall_keeps_db_state_when_removal_fails() -> None:
    _register(on_removed=MagicMock(side_effect=RuntimeError("x")))
    with (
        patch.object(loading, "publish_unloaded"),
        patch.object(loading, "delete_plugin_state") as delete,
    ):
        with pytest.raises(RuntimeError):
            loading.uninstall_plugin_sync(_ID1)
    delete.assert_not_called()


def test_uninstall_deletes_state_after_success() -> None:
    hooks = _register()
    with (
        patch.object(loading, "publish_unloaded", return_value=True),
        patch.object(loading, "delete_plugin_state") as delete,
    ):
        loading.uninstall_plugin_sync(_ID1)
    delete.assert_called_once()
    hooks.on_removed.assert_called_once_with(_ID1)  # type: ignore[attr-defined]


def _db_state(plugin_id: PluginCompositeId) -> MagicMock:
    state = MagicMock()
    state.plugin_id = PluginCompositeId.to_str(plugin_id)
    state.enabled = True
    state.plugin_version = "1.0"
    settings = MagicMock(update_strategy="manual", module_name="mod", pip_source="src")
    state.to_settings.return_value = settings
    return state


def test_load_plugins_continues_after_failure_and_aggregates() -> None:
    states = {_ID1: _db_state(_ID1), _ID2: _db_state(_ID2)}
    loaded = MagicMock()
    on_changed = MagicMock(side_effect=[RuntimeError("boom1"), RuntimeError("boom2")])
    _register(on_changed=on_changed)

    with (
        patch.object(loading, "check_environment_baseline"),
        patch.object(loading, "get_all_plugin_states_by_id", return_value=states),
        patch.object(loading, "try_import", return_value=object()),
        patch.object(loading, "_load_single", return_value=MagicMock(t=loaded, e=None)),
        patch.object(loading, "try_version", return_value="1.0"),
        patch.object(loading, "get_plugin_state", return_value=states[_ID1]),
        patch.object(loading, "publish_bulk_snapshot", return_value=True),
        patch.object(loading, "notify_failure") as notify,
    ):
        with pytest.raises(PluginTemplateIngestFailed) as info:
            loading.load_plugins()
    assert [c.args[0] for c in on_changed.call_args_list] == [_ID1, _ID2]
    assert notify.call_count == 2
    message = str(info.value)
    assert PluginCompositeId.to_str(_ID1) in message and PluginCompositeId.to_str(_ID2) in message


def test_update_single_raises_when_ingest_hook_fails() -> None:
    _register(on_changed=MagicMock(side_effect=RuntimeError("boom")))
    settings = MagicMock(update_strategy="manual", module_name="mod", pip_source="src")
    with (
        patch.object(loading, "get_plugin_state", return_value=None),
        patch.object(loading, "upsert_plugin_state"),
        patch.object(loading.importlib, "import_module"),
        patch.object(loading.importlib, "reload"),
        patch.object(loading, "_load_single", return_value=MagicMock(t=MagicMock(), e=None)),
        patch.object(loading, "try_version", return_value="1.0"),
        patch.object(loading, "notify_failure"),
    ):
        with pytest.raises(PluginTemplateIngestFailed):
            loading.update_single(_ID1, settings, install=False, version=None)
    assert _ID1 in PluginManager.plugins


def test_update_single_works_without_runtime_via_entrypoint_registration() -> None:
    """Guards warmup: with no execution manager pools or event dispatcher running, the hooks registered
    by the shared entrypoint registration function must suffice for a plugin (re)load."""
    _TemplateHooksSlot.hooks = None
    ingest = MagicMock()
    settings = MagicMock(update_strategy="manual", module_name="mod", pip_source="src")
    with patch.object(initializers, "ingest_plugin_templates", ingest):
        initializers.register_providers()
    with (
        patch.object(loading, "get_plugin_state", return_value=None),
        patch.object(loading, "upsert_plugin_state"),
        patch.object(loading.importlib, "import_module"),
        patch.object(loading.importlib, "reload"),
        patch.object(loading, "_load_single", return_value=MagicMock(t=MagicMock(), e=None)),
        patch.object(loading, "try_version", return_value="1.0"),
    ):
        loading.update_single(_ID1, settings, install=False, version=None)
    ingest.assert_called_once_with(_ID1)
