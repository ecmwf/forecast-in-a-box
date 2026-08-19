# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for domain.plugin.state's reservation/publication helpers."""

from collections.abc import Generator

import pytest
from fiab_core.fable import PluginCompositeId, PluginId, PluginStoreId
from pyrsistent import pmap

from forecastbox.domain.plugin import state as state_module
from forecastbox.domain.plugin.errors import PluginErrors
from forecastbox.domain.plugin.state import PluginManager, reserve_operation

_PLUGIN_ID = PluginCompositeId(store=PluginStoreId("store"), local=PluginId("plugin"))


@pytest.fixture(autouse=True)
def _reset_plugin_state() -> Generator[None, None, None]:
    PluginManager.plugins = pmap()
    PluginManager.errors = pmap()
    PluginManager.operation_in_progress = False
    PluginManager.updater_error = None
    yield
    PluginManager.plugins = pmap()
    PluginManager.errors = pmap()
    PluginManager.operation_in_progress = False
    PluginManager.updater_error = None


def test_reserve_operation_succeeds_when_idle() -> None:
    result = state_module.reserve_operation()
    assert result.accepted is True
    assert PluginManager.operation_in_progress is True


def test_reserve_operation_rejects_when_already_in_progress() -> None:
    PluginManager.operation_in_progress = True
    result = reserve_operation()
    assert result.accepted is False
    assert PluginManager.operation_in_progress is True


def test_reserve_operation_blocked_by_error_by_default() -> None:
    PluginManager.updater_error = "boom"
    result = reserve_operation()
    assert result.accepted is False


def test_reserve_operation_ignores_error_when_block_on_error_false() -> None:
    PluginManager.updater_error = "boom"
    result = reserve_operation(block_on_error=False)
    assert result.accepted is True


def test_release_reservation_clears_in_progress_without_recording_error() -> None:
    PluginManager.operation_in_progress = True
    state_module.release_reservation()
    assert PluginManager.operation_in_progress is False
    assert PluginManager.updater_error is None


def test_finish_ok_clears_in_progress() -> None:
    PluginManager.operation_in_progress = True
    state_module.finish_ok()
    assert PluginManager.operation_in_progress is False
    assert PluginManager.updater_error is None


def test_finish_with_error_records_message_and_clears_in_progress() -> None:
    PluginManager.operation_in_progress = True
    state_module.finish_with_error("kaboom")
    assert PluginManager.operation_in_progress is False
    assert PluginManager.updater_error == "kaboom"


def test_publish_bulk_snapshot_replaces_maps_atomically() -> None:
    errs = PluginErrors([])
    ok = state_module.publish_bulk_snapshot({_PLUGIN_ID: object()}, {_PLUGIN_ID: errs})  # type: ignore[arg-type]
    assert ok is True
    assert _PLUGIN_ID in PluginManager.plugins
    assert PluginManager.errors[_PLUGIN_ID] == errs


def test_publish_single_snapshot_sets_and_clears_errors() -> None:
    plugin = object()
    state_module.publish_single_snapshot(_PLUGIN_ID, plugin, PluginErrors([]))  # type: ignore[arg-type]
    assert PluginManager.plugins[_PLUGIN_ID] is plugin
    assert _PLUGIN_ID not in PluginManager.errors


def test_publish_unloaded_removes_plugin_and_errors() -> None:
    state_module.publish_bulk_snapshot({_PLUGIN_ID: object()}, {_PLUGIN_ID: PluginErrors([])})  # type: ignore[arg-type]
    ok = state_module.publish_unloaded(_PLUGIN_ID)
    assert ok is True
    assert _PLUGIN_ID not in PluginManager.plugins
    assert _PLUGIN_ID not in PluginManager.errors
