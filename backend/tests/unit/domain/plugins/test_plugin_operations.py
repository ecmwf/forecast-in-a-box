# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for the plugin-operation submission boundary in domain.plugin.submit.

Covers reservation/rollback, the submit_after-based initial-load continuation, the
managed-operation wrapper's error/notification behaviour, and that update/unload/
uninstall use the correct pool/task names without creating or joining a thread.
"""

from collections.abc import Callable, Generator
from concurrent.futures import Future
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fiab_core.fable import PluginCompositeId, PluginId, PluginStoreId
from pyrsistent import pmap

import forecastbox.domain.plugin.submit as submit_module
from forecastbox.domain.plugin.errors import PluginErrors
from forecastbox.domain.plugin.events import (
    PluginInstalledEvent,
    PluginSettingsAppliedEvent,
    PluginUninstalledEvent,
    PluginUnloadedEvent,
    PluginUpdatedEvent,
)
from forecastbox.domain.plugin.state import PluginManager
from forecastbox.domain.plugin.status import plugins_ready
from forecastbox.utility.concurrency.manager import ConcurrentPools, SubmissionRejected

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


# ---------------------------------------------------------------------------
# submit_load_all / initial load continuation
# ---------------------------------------------------------------------------


def test_submit_load_all_uses_submit_after_not_delayed_thread() -> None:
    catalog_future: Future[None] = Future()
    assert not hasattr(submit_module, "delayed_thread")
    with patch.object(submit_module.execution_manager, "submit_after") as mock_submit_after:
        submit_module.submit_load_all(catalog_future)
    mock_submit_after.assert_called_once()
    args, kwargs = mock_submit_after.call_args
    assert args[0] is catalog_future
    assert args[1] == ConcurrentPools.PluginManagement
    assert args[2] == "plugin.initial-load"
    assert PluginManager.operation_in_progress is True
    assert plugins_ready() is False


def test_failed_catalog_dependency_leaves_not_ready_and_does_not_run_loader() -> None:
    catalog_future: Future[None] = Future()
    ran_loader = False

    def _fake_run_initial_load(plugins: object) -> None:
        nonlocal ran_loader
        ran_loader = True

    with (
        patch.object(submit_module.execution_manager, "submit_after") as mock_submit_after,
        patch.object(submit_module, "_run_load_all", side_effect=_fake_run_initial_load),
    ):
        submit_module.submit_load_all(catalog_future)
        # Simulate the dependency failing -- the real ExecutionManager.submit_after would not
        # invoke the task in this case; only our own done-callback runs.
        catalog_future.set_exception(RuntimeError("catalog refresh boom"))

    mock_submit_after.assert_called_once()
    assert ran_loader is False
    assert plugins_ready() is False
    assert PluginManager.updater_error is not None
    assert "catalog refresh boom" in PluginManager.updater_error


# ---------------------------------------------------------------------------
# _run_managed wrapper
# ---------------------------------------------------------------------------


def test_run_managed_records_error_notifies_and_reraises_on_unexpected_exception() -> None:
    PluginManager.operation_in_progress = True

    def _boom() -> None:
        raise RuntimeError("worker exploded")

    with patch.object(submit_module, "_notify_failure") as mock_notify:
        with pytest.raises(RuntimeError):
            submit_module._run_managed("Some trigger", _boom)

    mock_notify.assert_called_once()
    trigger_arg, message_arg = mock_notify.call_args.args
    assert trigger_arg == "Some trigger"
    assert "worker exploded" in message_arg
    assert PluginManager.updater_error is not None
    assert PluginManager.operation_in_progress is False


def test_run_managed_finishes_ok_on_normal_completion() -> None:
    PluginManager.operation_in_progress = True
    submit_module._run_managed("trigger", lambda: None)
    assert PluginManager.operation_in_progress is False
    assert PluginManager.updater_error is None


def test_run_managed_notifies_success_when_on_success_given() -> None:
    PluginManager.operation_in_progress = True
    payload = PluginUninstalledEvent(plugin_id="store/plugin")
    with patch.object(submit_module, "_notify_success") as mock_notify:
        submit_module._run_managed("trigger", lambda: None, ("plugin.uninstalled", payload))
    mock_notify.assert_called_once_with("plugin.uninstalled", payload)


def test_run_managed_does_not_notify_success_on_failure() -> None:
    PluginManager.operation_in_progress = True
    payload = PluginUninstalledEvent(plugin_id="store/plugin")

    def _boom() -> None:
        raise RuntimeError("boom")

    with patch.object(submit_module, "_notify_success") as mock_notify:
        with pytest.raises(RuntimeError):
            submit_module._run_managed("trigger", _boom, ("plugin.uninstalled", payload))
    mock_notify.assert_not_called()


def test_run_managed_does_not_convert_per_plugin_errors_to_global_failure() -> None:
    """A worker that records per-plugin PluginErrors without raising is a normal completion."""
    PluginManager.operation_in_progress = True

    def _worker_with_per_plugin_error() -> None:
        PluginManager.errors = PluginManager.errors.set(_PLUGIN_ID, PluginErrors([]))

    submit_module._run_managed("trigger", _worker_with_per_plugin_error)
    assert PluginManager.updater_error is None
    assert PluginManager.operation_in_progress is False


# ---------------------------------------------------------------------------
# submit_update_single
# ---------------------------------------------------------------------------


def _fake_config_with_plugin() -> MagicMock:
    settings = MagicMock()
    fake_config = MagicMock()
    fake_config.external.plugins = {_PLUGIN_ID: settings}
    return fake_config


@pytest.mark.asyncio
async def test_submit_update_single_uses_plugin_management_pool_and_task_name() -> None:
    with (
        patch.object(submit_module, "config", _fake_config_with_plugin()),
        patch.object(submit_module.execution_manager, "awaitable_submit", new=AsyncMock()) as mock_submit,
    ):
        result = await submit_module.submit_update_single(_PLUGIN_ID, install=True, version=None)
    assert result == ""
    mock_submit.assert_called_once()
    args, _ = mock_submit.call_args
    assert args[0] == ConcurrentPools.PluginManagement
    assert args[1] == "plugin.update"


@pytest.mark.asyncio
async def test_submit_update_single_rejects_overlapping_operation() -> None:
    PluginManager.operation_in_progress = True
    with patch.object(submit_module, "config", _fake_config_with_plugin()):
        result = await submit_module.submit_update_single(_PLUGIN_ID, install=True, version=None)
    assert "not idle" in result


@pytest.mark.asyncio
async def test_submit_update_single_rolls_back_reservation_on_submission_rejected() -> None:
    with (
        patch.object(submit_module, "config", _fake_config_with_plugin()),
        patch.object(submit_module.execution_manager, "awaitable_submit", side_effect=SubmissionRejected("pool full")),
    ):
        with pytest.raises(SubmissionRejected):
            await submit_module.submit_update_single(_PLUGIN_ID, install=True, version=None)
    assert PluginManager.operation_in_progress is False


@pytest.mark.asyncio
async def test_submit_update_single_blocked_by_existing_global_failure() -> None:
    PluginManager.updater_error = "prior failure"
    with patch.object(submit_module, "config", _fake_config_with_plugin()):
        result = await submit_module.submit_update_single(_PLUGIN_ID, install=True, version=None)
    assert "failed" in result


@pytest.mark.asyncio
async def test_submit_update_single_emits_updated_event_by_default() -> None:
    with (
        patch.object(submit_module, "config", _fake_config_with_plugin()),
        patch.object(submit_module.execution_manager, "awaitable_submit") as mock_await_submit,
    ):

        async def _run(pool_name: object, task_name: object, task: Callable[[], object]) -> None:
            task()

        mock_await_submit.side_effect = _run
        with patch.object(submit_module, "update_single"), patch.object(submit_module, "_notify_success") as mock_notify:
            await submit_module.submit_update_single(_PLUGIN_ID, install=True, version=None)
    mock_notify.assert_called_once()
    event_name, payload = mock_notify.call_args.args
    assert event_name == "plugin.updated"
    assert isinstance(payload, PluginUpdatedEvent)
    assert payload.plugin_id == PluginCompositeId.to_str(_PLUGIN_ID)


@pytest.mark.asyncio
async def test_submit_update_single_emits_installed_event_when_is_new_install() -> None:
    with (
        patch.object(submit_module, "config", _fake_config_with_plugin()),
        patch.object(submit_module.execution_manager, "awaitable_submit") as mock_await_submit,
    ):

        async def _run(pool_name: object, task_name: object, task: Callable[[], object]) -> None:
            task()

        mock_await_submit.side_effect = _run
        with patch.object(submit_module, "update_single"), patch.object(submit_module, "_notify_success") as mock_notify:
            await submit_module.submit_update_single(_PLUGIN_ID, install=True, version=None, is_new_install=True)
    mock_notify.assert_called_once()
    event_name, payload = mock_notify.call_args.args
    assert event_name == "plugin.installed"
    assert isinstance(payload, PluginInstalledEvent)


@pytest.mark.asyncio
async def test_submit_update_single_emits_settings_applied_event_when_not_installing() -> None:
    with (
        patch.object(submit_module, "config", _fake_config_with_plugin()),
        patch.object(submit_module.execution_manager, "awaitable_submit") as mock_await_submit,
    ):

        async def _run(pool_name: object, task_name: object, task: Callable[[], object]) -> None:
            task()

        mock_await_submit.side_effect = _run
        with patch.object(submit_module, "update_single"), patch.object(submit_module, "_notify_success") as mock_notify:
            await submit_module.submit_update_single(_PLUGIN_ID, install=False, version=None)
    mock_notify.assert_called_once()
    event_name, payload = mock_notify.call_args.args
    assert event_name == "plugin.settings_applied"
    assert isinstance(payload, PluginSettingsAppliedEvent)


# ---------------------------------------------------------------------------
# submit_unload_single / submit_uninstall_single -- available after a failed update
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_submit_unload_single_available_after_prior_update_failure() -> None:
    PluginManager.updater_error = "prior failure"
    with (
        patch.object(submit_module.execution_manager, "awaitable_submit") as mock_await_submit,
        patch.object(submit_module, "unload_single") as mock_unload_single,
    ):

        async def _run(pool_name: object, task_name: object, task: Callable[[], object]) -> None:
            task()

        mock_await_submit.side_effect = _run
        with patch.object(submit_module, "_notify_success") as mock_notify:
            await submit_module.submit_unload_single(_PLUGIN_ID)
    mock_unload_single.assert_called_once_with(_PLUGIN_ID)
    mock_await_submit.assert_called_once()
    args, _ = mock_await_submit.call_args
    assert args[0] == ConcurrentPools.PluginManagement
    assert args[1] == "plugin.unload"
    mock_notify.assert_called_once()
    event_name, payload = mock_notify.call_args.args
    assert event_name == "plugin.unloaded"
    assert isinstance(payload, PluginUnloadedEvent)


@pytest.mark.asyncio
async def test_submit_unload_single_rejects_overlapping_operation() -> None:
    PluginManager.operation_in_progress = True
    with pytest.raises(SubmissionRejected):
        await submit_module.submit_unload_single(_PLUGIN_ID)


@pytest.mark.asyncio
async def test_submit_uninstall_single_uses_plugin_management_pool_and_task_name() -> None:
    fake_config = _fake_config_with_plugin()
    with (
        patch.object(submit_module, "config", fake_config),
        patch.object(submit_module.execution_manager, "awaitable_submit") as mock_await_submit,
        patch.object(submit_module, "uninstall_plugin_sync") as mock_uninstall_sync,
    ):

        async def _run(pool_name: object, task_name: object, task: Callable[[], object]) -> None:
            task()

        mock_await_submit.side_effect = _run
        with patch.object(submit_module, "_notify_success") as mock_notify:
            await submit_module.submit_uninstall_single(_PLUGIN_ID)
    mock_uninstall_sync.assert_called_once_with(_PLUGIN_ID)
    mock_await_submit.assert_called_once()
    args, _ = mock_await_submit.call_args
    assert args[0] == ConcurrentPools.PluginManagement
    assert args[1] == "plugin.uninstall"
    mock_notify.assert_called_once()
    event_name, payload = mock_notify.call_args.args
    assert event_name == "plugin.uninstalled"
    assert isinstance(payload, PluginUninstalledEvent)


@pytest.mark.asyncio
async def test_submit_uninstall_single_rolls_back_reservation_on_submission_rejected() -> None:
    fake_config = _fake_config_with_plugin()
    with (
        patch.object(submit_module, "config", fake_config),
        patch.object(submit_module.execution_manager, "awaitable_submit", side_effect=SubmissionRejected("pool full")),
    ):
        with pytest.raises(SubmissionRejected):
            await submit_module.submit_uninstall_single(_PLUGIN_ID)
    assert PluginManager.operation_in_progress is False
