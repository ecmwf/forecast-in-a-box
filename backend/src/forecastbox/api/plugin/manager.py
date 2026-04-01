# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""API for internal plugin management -- importing configured plugins, invoking
pip install.

Assumed to be invoked from the plugins router in API, and during application
startup.

The synchronization logic is handled by a PluginManager with a single lock.
Pyrsistent immutable structures are used for shared state (plugins, versions,
errors, updatedate), making reads safe without locks. The lock is only acquired
when swapping the top-level structure pointers on writes.

There is at most one thread at any time doing any pip/importlib operations,
thus inside these updater threads we don't need any other critical sections.
We pay attention not to block forever on acquiring when inquiring for status
or when running the initial plugin load -- but inside the updater threads,
we lock for longer.
"""

import datetime as dt
import importlib
import importlib.metadata
import logging
import pathlib
import subprocess
import threading
import time
from concurrent.futures import Future
from types import ModuleType
from typing import Iterator, Literal

from cascade.low.func import assert_never
from fiab_core.fable import BlockFactoryCatalogue, PluginCompositeId
from fiab_core.plugin import Plugin
from pydantic import BaseModel
from pyrsistent import pmap
from pyrsistent.typing import PMap

from forecastbox.ecpyutil import delayed_thread, timed_acquire
from forecastbox.utility.config import PluginSettings, PluginsSettings, config, config_edit_lock

logger = logging.getLogger(__name__)


def _try_import(module_name: str) -> ModuleType | None:
    try:
        return importlib.import_module(module_name)
    except ModuleNotFoundError:
        return None


def _try_version(pluginSettings: PluginSettings) -> str:
    try:
        return importlib.metadata.version(pluginSettings.pip_source)
    except importlib.metadata.PackageNotFoundError:
        module = _try_import(pluginSettings.module_name)
        if module is not None:
            if hasattr(module, "_version"):
                version = module._version
                if isinstance(version, str):
                    return version
        return "unknown"


def _try_updatedate(pluginSettings: PluginSettings) -> str:
    try:
        dist = importlib.metadata.distribution(pluginSettings.pip_source)
    except importlib.metadata.PackageNotFoundError:
        return "unknown"
    if dist.files is None:
        return "unknown"
    try:
        mtdf = next(f for f in dist.files if f.name == "METADATA")
    except StopIteration:
        return "unknown"
    try:
        path = pathlib.Path(mtdf.locate())
        install_time = dt.datetime.fromtimestamp(path.stat().st_ctime)
        return install_time.strftime("%Y/%m/%d")
    except Exception:  # too much could happen -- file not exist, no rights, malformed ts, etc
        return "unknown"


def _try_install(pip_source: str) -> None:
    install_command = ["uv", "pip", "install", "--upgrade"] + (pip_source.split(" ", 1) if pip_source.startswith("-e") else [pip_source])
    try:
        result = subprocess.run(install_command, check=False, capture_output=True)
    except FileNotFoundError as ex:
        logger.error(f"installing {pip_source} failure: {repr(ex)}")
    if result.returncode != 0:
        msg = f"installing {pip_source} failure: {result.returncode}. Stderr: {result.stderr}, Stdout: {result.stdout}, Args: {result.args}"
        logger.error(msg)


class PluginManager:
    lock: threading.Lock = threading.Lock()
    plugins: PMap[PluginCompositeId, Plugin] = pmap()
    versions: PMap[PluginCompositeId, str] = pmap()
    errors: PMap[PluginCompositeId, str] = pmap()
    updatedate: PMap[PluginCompositeId, str] = pmap()
    updater: threading.Thread | None = None
    updater_error: str | None = None


def load_single(plugin: PluginSettings) -> Plugin | str:
    errors = []
    plugin_impl = _try_import(plugin.module_name)
    if plugin_impl is None:
        errors.append(f"failed to import plugin {plugin.module_name}")
    elif not hasattr(plugin_impl, "plugin"):
        errors.append(f"plugin {plugin.module_name} does not have a `plugin` attribute")
    elif not isinstance(getattr(plugin_impl, "plugin"), Plugin):
        errors.append(f"plugin {plugin.module_name}'s `plugin` is not a Plugin")
    else:
        return getattr(plugin_impl, "plugin")
    return "\n".join(errors)


def load_plugins(plugins: PluginsSettings) -> None:
    logger.info("starting initial plugin load")
    try:
        lookup = {}
        errors = {}
        versions = {}
        updatedate = {}
        for pluginKey, pluginSettings in plugins.items():
            if not pluginSettings.enabled:
                continue
            # NOTE consider running all pip invocations at once -- worse error reporting but better perf
            if pluginSettings.update_strategy == "auto":
                logger.info(f"auto-updating {pluginSettings.module_name}")
                _try_install(pluginSettings.pip_source)
            else:
                if _try_import(pluginSettings.module_name) is None:
                    logger.info(f"installing {pluginSettings.module_name} for the first time")
                    _try_install(pluginSettings.pip_source)

            if pluginKey in lookup:
                errors[pluginKey] = f"plugin {pluginKey} is provided by more than just {pluginSettings.pip_source}"
            else:
                result = load_single(pluginSettings)
                logger.debug(f"plugin {pluginKey} loaded with success: {isinstance(result, Plugin)}")
                if isinstance(result, Plugin):
                    lookup[pluginKey] = result
                elif isinstance(result, str):
                    errors[pluginKey] = result
                else:
                    assert_never(result)
                versions[pluginKey] = _try_version(pluginSettings)
                updatedate[pluginKey] = _try_updatedate(pluginSettings)

        with timed_acquire(PluginManager.lock, 60) as result:
            if not result:
                raise ValueError("failed to acquire the shared lock")
            PluginManager.plugins = pmap(lookup)
            PluginManager.errors = pmap(errors)
            PluginManager.versions = pmap(versions)
            PluginManager.updatedate = pmap(updatedate)
        logger.debug("global plugin loading finished")
    except Exception as e:
        logger.exception(f"updating thread failed with {repr(e)}")
        with timed_acquire(PluginManager.lock, 5) as _:
            # NOTE we ignore result -- we rather corrupt than deadlock
            PluginManager.updater_error = repr(e)


def update_single(pluginId: PluginCompositeId, pluginSettings: PluginSettings, isUpdate: bool) -> None:
    try:
        if isUpdate:
            _try_install(pluginSettings.pip_source)
        # NOTE we need to recommend in the docs to re-launch app after this change, this wont cover all cases
        importlib.reload(importlib.import_module(pluginSettings.module_name))
        plugin_impl = _try_import(pluginSettings.module_name)
        result = load_single(pluginSettings)
        logger.debug(f"plugin {pluginId} loaded with success: {isinstance(result, Plugin)}")
        with timed_acquire(PluginManager.lock, 60) as acquire_result:
            if not acquire_result:
                raise ValueError("failed to acquire the shared lock")
            if isinstance(result, Plugin):
                PluginManager.plugins = PluginManager.plugins.set(pluginId, result)
            elif isinstance(result, str):
                PluginManager.errors = PluginManager.errors.set(pluginId, result)
            else:
                assert_never(result)
            PluginManager.versions = PluginManager.versions.set(pluginId, _try_version(pluginSettings))
            PluginManager.updatedate = PluginManager.updatedate.set(pluginId, _try_updatedate(pluginSettings))
        logger.debug(f"single plugin loading finished: {pluginId}")
    except Exception as e:
        logger.exception(f"updating thread failed with {repr(e)}")
        with timed_acquire(PluginManager.lock, 5) as _:
            # NOTE we ignore result -- we rather corrupt than deadlock
            PluginManager.updater_error = repr(e)


def unload_single(pluginId: PluginCompositeId) -> None:
    with timed_acquire(PluginManager.lock, 5) as result:
        if not result:
            logger.warning("failed to acquire lock for unload_single")
            return
        if pluginId in PluginManager.plugins:
            PluginManager.plugins = PluginManager.plugins.remove(pluginId)
        if pluginId in PluginManager.errors:
            PluginManager.errors = PluginManager.errors.remove(pluginId)
        if pluginId in PluginManager.versions:
            PluginManager.versions = PluginManager.versions.remove(pluginId)


def submit_load_plugins(start_after: Future[None]) -> None:
    with timed_acquire(PluginManager.lock, 0.2) as result:
        if not result:
            logger.error("failed to submit load_plugins")
            # NOTE we ignore result -- we rather corrupt than deadlock
            PluginManager.updater_error = "failed to submit load_plugins"
        elif PluginManager.updater is not None:
            raise TypeError("attempted to submit load_plugins but updater is already in progress")
        else:
            PluginManager.updater = delayed_thread(start_after, load_plugins, (config.product.plugins,))
            PluginManager.updater.start()


class PluginsStatus(BaseModel):
    # TODO: Change these fields to use pyrsistent types (PMap) instead of dict once we solve pydantic serialization
    updater_status: Literal["ok", "running", "retrieving"] | str
    plugin_errors: dict[PluginCompositeId, str]
    plugin_versions: dict[PluginCompositeId, str]
    plugin_updatedate: dict[PluginCompositeId, str]


def status_brief() -> str:
    # NOTE this may be called without locking, we don't risk collection mutation during iteration
    if PluginManager.updater_error is not None:
        return f"failure: {PluginManager.updater_error}"
    elif PluginManager.updater.is_alive():
        return "running"
    else:
        return "ok"


def plugins_ready() -> bool:
    return status_brief() == "ok"


def status_full() -> PluginsStatus:
    with timed_acquire(PluginManager.lock, 0.2) as result:
        if not result:
            status = "retrieving"
            plugin_errors = {}
            plugin_versions = {}
            plugin_updatedate = {}
        else:
            status = status_brief()
            plugin_errors = dict(PluginManager.errors)
            plugin_versions = dict(PluginManager.versions)
            plugin_updatedate = dict(PluginManager.updatedate)
    return PluginsStatus(
        updater_status=status,
        plugin_errors=plugin_errors,
        plugin_versions=plugin_versions,
        plugin_updatedate=plugin_updatedate,
    )


def catalogue_view() -> dict[PluginCompositeId, BlockFactoryCatalogue] | bool:
    with timed_acquire(PluginManager.lock, 1.0) as result:
        if not result:
            return False
        else:
            return {plugin_id: plugin.catalogue for plugin_id, plugin in PluginManager.plugins.items()}


def submit_update_single(pluginId: PluginCompositeId, isUpdate: bool) -> str:
    pluginSettings = config.product.plugins.get(pluginId, None)
    if pluginSettings is None:
        return f"plugin {pluginId} not configured"
    else:
        with timed_acquire(PluginManager.lock, 0.5) as result:
            if not result:
                return "plugin updater is not idle"
            if PluginManager.updater_error is not None:
                logger.warning(f"refusing to update_single because of {PluginManager.updater_error}")
                return "plugin updater has failed"
            if PluginManager.updater is not None:
                if PluginManager.updater.is_alive():
                    return "plugin updater is not idle"
                else:
                    PluginManager.updater.join(0)
                    # we join despite thread not being alive to ensure resource collection
            PluginManager.updater = threading.Thread(target=update_single, args=(pluginId, pluginSettings, isUpdate))
            PluginManager.updater.start()
    return ""


def uninstall_plugin(pluginId: PluginCompositeId) -> None:
    if pluginId not in config.product.plugins:
        raise ValueError(f"plugin {pluginId} not installed")
    with timed_acquire(config_edit_lock, 5) as result:
        if not result:
            raise ValueError("failed to acquire the shared lock")
        config.product.plugins.pop(pluginId)
        config.save_to_file()
    unload_single(pluginId)


def modify_enabled(pluginId: PluginCompositeId, isEnabled: bool) -> None:
    with timed_acquire(config_edit_lock, 5) as result:
        if not result:
            raise ValueError("failed to acquire the shared lock")
        config.product.plugins[pluginId].enabled = isEnabled
        config.save_to_file()
    if not isEnabled:
        unload_single(pluginId)
    else:
        submit_update_single(pluginId, isUpdate=False)


def join_updater_thread(timeout_sec: int) -> None:
    # TODO candidate for ecpyutil, duplicated in plugin.store
    barrier = (time.perf_counter_ns() / 1e9) + timeout_sec
    with timed_acquire(PluginManager.lock, timeout_sec) as result:
        if not result:
            logger.error("failed to lock for joining updater thread")
        else:
            if PluginManager.updater is not None:
                budget = barrier - (time.perf_counter_ns() / 1e9)
                PluginManager.updater.join(budget)
                if PluginManager.updater.is_alive():
                    logger.error("failed to join PluginManager updater thread")
