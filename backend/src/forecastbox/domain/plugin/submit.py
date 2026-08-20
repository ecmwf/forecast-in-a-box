# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""API for submitting venv-mutating operations in a safe manner to the bounded
``ConcurrentPools.PluginManagement``.

Assumed to be invoked from the plugins router in API, and during application startup.

``ConcurrentPools.PluginManagement`` is registered with exactly one worker. This is a
correctness boundary, not merely an I/O pool: pip installation, module reload/import,
and plugin catalogue publication all mutate process-global state, so at most one such
operation may run at a time. ``domain.plugin.state.reserve_operation`` enforces this at
the domain level (rejecting a second concurrent operation) in addition to the pool's own
single worker, since a rejected/queued submission is not enough on its own to prevent two
operations from being simultaneously "in flight" from the domain's point of view.

Every managed operation is wrapped by ``_run_managed`` so that an unexpected exception
is recorded both in the domain-facing error/notification surface (``updater_error`` and
``PluginGlobalErrorEvent``) and in the execution manager's own bounded monitored-failure
history (by re-raising after recording). Per-plugin install/load outcomes represented as
``PluginErrors`` are not managed-operation failures; they are normal completions handled
entirely inside ``domain.plugin.loading``.
"""

import logging
from collections.abc import Callable
from concurrent.futures import Future
from functools import partial

from fiab_core.fable import PluginCompositeId
from packaging.version import Version

from forecastbox.domain.plugin.events import (
    PluginGlobalErrorEvent,
    PluginInstalledEvent,
    PluginSettingsAppliedEvent,
    PluginSuccessNotification,
    PluginUninstalledEvent,
    PluginUnloadedEvent,
    PluginUpdatedEvent,
)
from forecastbox.domain.plugin.exceptions import PluginEnvironmentAlreadyBroken
from forecastbox.domain.plugin.loading import load_plugins as _load_plugins
from forecastbox.domain.plugin.loading import uninstall_plugin_sync, unload_single, update_single
from forecastbox.domain.plugin.state import PluginManager, finish_ok, finish_with_error, release_reservation, reserve_operation
from forecastbox.utility.concurrency.manager import ConcurrentPools, SubmissionRejected, TaskName, execution_manager
from forecastbox.utility.config import PluginsSettings, config
from forecastbox.utility.dispatcher import Event, EventName, submit_event

logger = logging.getLogger(__name__)


def _notify_failure(trigger: str, message: str) -> None:
    try:
        submit_event(
            Event(
                name=EventName("plugin.global_error"),
                payload=PluginGlobalErrorEvent(trigger=trigger, error=message),
            )
        )
    except Exception as e:
        logger.exception(f"failed to submit plugin global-error notification for {trigger!r}: {repr(e)}")


def _notify_success(payload: PluginSuccessNotification) -> None:
    notification = payload.as_client_notification()
    suffix = notification.sourceDomainEvent[len("plugin") :]
    event_name = "plugin." + suffix[:1].lower() + suffix[1:]
    try:
        submit_event(Event(name=EventName(event_name), payload=payload))
    except Exception as e:
        logger.exception(f"failed to submit plugin success notification {event_name!r}: {repr(e)}")


def _run_managed(trigger: str, worker: Callable[[], None], on_success: PluginSuccessNotification | None = None) -> None:
    """Run one managed plugin operation assuming its reservation has already been made.

    On normal completion, marks the operation idle and, if ``on_success`` was provided,
    emits it as a client notification. On an unexpected exception, records
    ``updater_error``, emits the existing ``PluginGlobalErrorEvent`` notification, and
    re-raises so the execution manager records the failure in its own monitored history.
    """
    try:
        worker()
    except PluginEnvironmentAlreadyBroken as e:
        # NOTE this exception is handled separately for cleaner logging -- no need for the full trace
        logger.error(f"{trigger} refused: {e}")
        finish_with_error(str(e))
        _notify_failure(trigger, str(e))
        raise
    except Exception as e:
        logger.exception(f"{trigger} failed with {repr(e)}")
        finish_with_error(repr(e))
        _notify_failure(trigger, repr(e))
        raise
    else:
        finish_ok()
        if on_success is not None:
            _notify_success(on_success)


def _run_load_all(plugins: PluginsSettings) -> None:
    _run_managed("Initial plugin load", partial(_load_plugins, plugins))


def submit_load_all(start_after: Future[None]) -> None:
    """Reserve and submit the initial load-all-plugins operation"""
    result = reserve_operation()
    if not result.accepted:
        logger.error(f"failed to submit load_plugins: {result.reason}")
        finish_with_error(f"failed to submit load_plugins: {result.reason}")
        return

    def _record_dependency_failure(done: Future[None]) -> None:
        # NOTE this is just a rollback -- we reserve prior to submit, but the callable
        # would *not* be executed if the prerequisite has failed, hence would not rollback
        # on its own.
        try:
            done.result()
        except BaseException as error:
            finish_with_error(f"catalog refresh dependency failed: {repr(error)}")

    start_after.add_done_callback(_record_dependency_failure)
    execution_manager.submit_after(
        start_after,
        ConcurrentPools.PluginManagement,
        TaskName("plugin.initial-load"),
        partial(_run_load_all, config.external.plugins),
    )


async def submit_update_single(pluginId: PluginCompositeId, install: bool, version: Version | None) -> str:
    """Reserve and submit an install/update/reload operation for one plugin.

    The success notification emitted depends on the situation: a settings-only change
    (``install=False``, from ``POST /plugin/settings``) is reported as settings-applied;
    otherwise, if the plugin is already present in ``PluginManager.plugins`` it is reported
    as an update, and if not, as a fresh install.
    """
    pluginSettings = config.external.plugins.get(pluginId, None)
    if pluginSettings is None:
        return f"plugin {pluginId} not configured"
    result = reserve_operation()
    if not result.accepted:
        return result.reason
    trigger = f"Update of plugin {pluginId}"
    plugin_id_str = PluginCompositeId.to_str(pluginId)
    on_success: PluginSuccessNotification
    if not install:
        on_success = PluginSettingsAppliedEvent(plugin_id=plugin_id_str)
    elif pluginId in PluginManager.plugins:
        on_success = PluginUpdatedEvent(plugin_id=plugin_id_str)
    else:
        on_success = PluginInstalledEvent(plugin_id=plugin_id_str)
    try:
        await execution_manager.awaitable_submit(
            ConcurrentPools.PluginManagement,
            TaskName("plugin.update"),
            partial(_run_managed, trigger, partial(update_single, pluginId, pluginSettings, install, version), on_success),
        )
    except SubmissionRejected:
        release_reservation()
        raise
    return ""


async def submit_unload_single(pluginId: PluginCompositeId) -> None:
    """Reserve and await an unload operation. The caller (route) owns success/failure
    reporting; a recorded global ``updater_error`` does not block this cleanup path.
    """
    result = reserve_operation(refuse_on_error=False)
    if not result.accepted:
        raise SubmissionRejected(result.reason)
    trigger = f"Unload of plugin {pluginId}"
    on_success = PluginUnloadedEvent(plugin_id=PluginCompositeId.to_str(pluginId))
    try:
        await execution_manager.awaitable_submit(
            ConcurrentPools.PluginManagement,
            TaskName("plugin.unload"),
            partial(_run_managed, trigger, partial(unload_single, pluginId), on_success),
        )
    except SubmissionRejected:
        release_reservation()
        raise


async def submit_uninstall_single(pluginId: PluginCompositeId) -> None:
    logger.debug(f"about to uninstall {pluginId=}")
    if pluginId not in config.external.plugins:
        raise ValueError(f"plugin {pluginId} not installed")
    result = reserve_operation(refuse_on_error=False)
    if not result.accepted:
        raise SubmissionRejected(result.reason)
    trigger = f"Uninstall of plugin {pluginId}"
    on_success = PluginUninstalledEvent(plugin_id=PluginCompositeId.to_str(pluginId))
    try:
        await execution_manager.awaitable_submit(
            ConcurrentPools.PluginManagement,
            TaskName("plugin.uninstall"),
            partial(_run_managed, trigger, partial(uninstall_plugin_sync, pluginId), on_success),
        )
    except SubmissionRejected:
        release_reservation()
        raise
