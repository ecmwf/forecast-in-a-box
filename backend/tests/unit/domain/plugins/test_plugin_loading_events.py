# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for the template-event emission in domain.plugin.loading."""

from collections.abc import Generator
from concurrent.futures import Future
from unittest.mock import MagicMock, patch

import pytest
from fiab_core.fable import PluginCompositeId, PluginId, PluginStoreId
from pyrsistent import pmap

import forecastbox.domain.plugin.loading as loading
from forecastbox.domain.plugin.events import PluginTemplatesChangedEvent, PluginTemplatesRemovedEvent
from forecastbox.domain.plugin.exceptions import PluginTemplateIngestFailed
from forecastbox.domain.plugin.state import PluginManager
from forecastbox.utility.dispatcher import Event

_ID1 = PluginCompositeId(store=PluginStoreId("s"), local=PluginId("p1"))
_ID2 = PluginCompositeId(store=PluginStoreId("s"), local=PluginId("p2"))


@pytest.fixture(autouse=True)
def _reset() -> Generator[None, None, None]:
    PluginManager.plugins = pmap()
    PluginManager.errors = pmap()
    yield
    PluginManager.plugins = pmap()
    PluginManager.errors = pmap()


def _receipt(error: BaseException | None) -> Future:
    future: Future = Future()
    if error is None:
        future.set_result(None)
    else:
        future.set_exception(error)
    return future


def test_unload_single_publishes_only_after_successful_receipt() -> None:
    calls: list[str] = []
    with (
        patch.object(loading, "submit_event", side_effect=lambda e: calls.append("emit") or _receipt(None)),
        patch.object(loading, "publish_unloaded", side_effect=lambda i: calls.append("publish") or True),
    ):
        loading.unload_single(_ID1)
    assert calls == ["emit", "publish"]


def test_unload_single_does_not_publish_when_receipt_fails() -> None:
    with (
        patch.object(loading, "submit_event", return_value=_receipt(RuntimeError("x"))),
        patch.object(loading, "publish_unloaded") as publish,
    ):
        with pytest.raises(RuntimeError):
            loading.unload_single(_ID1)
    publish.assert_not_called()


def test_uninstall_keeps_db_state_when_removal_fails() -> None:
    with (
        patch.object(loading, "submit_event", return_value=_receipt(RuntimeError("x"))),
        patch.object(loading, "publish_unloaded"),
        patch.object(loading, "delete_plugin_state") as delete,
    ):
        with pytest.raises(RuntimeError):
            loading.uninstall_plugin_sync(_ID1)
    delete.assert_not_called()


def test_uninstall_deletes_state_after_success() -> None:
    with (
        patch.object(loading, "submit_event", return_value=_receipt(None)) as submit,
        patch.object(loading, "publish_unloaded", return_value=True),
        patch.object(loading, "delete_plugin_state") as delete,
    ):
        loading.uninstall_plugin_sync(_ID1)
    delete.assert_called_once()
    (event,) = submit.call_args.args
    assert isinstance(event.payload, PluginTemplatesRemovedEvent)


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
    receipts = [_receipt(RuntimeError("boom1")), _receipt(RuntimeError("boom2"))]
    emitted: list[Event] = []

    def _submit(event: Event) -> Future:
        emitted.append(event)
        return receipts.pop(0)

    with (
        patch.object(loading, "check_environment_baseline"),
        patch.object(loading, "get_all_plugin_states_by_id", return_value=states),
        patch.object(loading, "try_import", return_value=object()),
        patch.object(loading, "_load_single", return_value=MagicMock(t=loaded, e=None)),
        patch.object(loading, "try_version", return_value="1.0"),
        patch.object(loading, "get_plugin_state", return_value=states[_ID1]),
        patch.object(loading, "publish_bulk_snapshot", return_value=True),
        patch.object(loading, "submit_event", side_effect=_submit),
        patch.object(loading, "notify_failure") as notify,
    ):
        with pytest.raises(PluginTemplateIngestFailed) as info:
            loading.load_plugins()
    assert [type(e.payload) for e in emitted] == [PluginTemplatesChangedEvent, PluginTemplatesChangedEvent]
    assert notify.call_count == 2
    message = str(info.value)
    assert PluginCompositeId.to_str(_ID1) in message and PluginCompositeId.to_str(_ID2) in message
