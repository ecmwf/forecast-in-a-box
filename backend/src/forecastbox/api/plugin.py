# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""API for internal plugin management -- importing configured plugins, invoking
pip installed.

Assumed to be invoked from the plugins router in API, and during application
startup.

The synchronization logic is handled by a PluginManager with a single lock,
which is locked whenever we read/write the shared status, which consists of
 - what plugin versions are loaded,
 - which plugins failed to load and with what error,
 - whether there is a background thread running an update.
In particular, there is at most one thread at any time doing any pip/importlib
operations, thus inside these updater thread we dont need any other critical
sections. We pay attention not to block forever on acquiring when inquiring
for status or when running the initial plugin load -- but inside the updater
threads, we lock for long.
"""

# NOTE this is not really healthy design, we lock too much just for the sake
# of possible runtime updates which are dubious anyway.
# Replace the Plugins dict lock with an atomic reference, and the dict itself
# with a pyrsistent map or smth like that

import importlib
import importlib.metadata
import logging
import subprocess
import threading
import time
from contextlib import contextmanager
from types import ModuleType
from typing import Iterator, Literal

from cascade.low.func import assert_never
from fiab_core.fable import BlockFactoryCatalogue
from fiab_core.plugin import Plugin
from pydantic import BaseModel

from forecastbox.api.types.fable import PluginId
from forecastbox.config import PluginSettings, config

logger = logging.getLogger(__name__)


def _try_import(module_name: str) -> ModuleType | None:
    try:
        return importlib.import_module(module_name)
    except ModuleNotFoundError:
        return None


def _try_install(pip_source: str) -> None:
    install_command = lambda name: ["uv", "pip", "install", "--upgrade", name]
    try:
        result = subprocess.run(install_command(pip_source), check=False, capture_output=True)
    except FileNotFoundError as ex:
        logger.error(f"installing {pip_source} failure: {repr(ex)}")
    if result.returncode != 0:
        msg = f"installing {pip_source} failure: {result.returncode}. Stderr: {result.stderr}, Stdout: {result.stdout}, Args: {result.args}"
        logger.error(msg)


class PluginManager:
    lock: threading.Lock = threading.Lock()
    plugins: dict[PluginId, Plugin] = {}
    errors: dict[PluginId, str] = {}
    updater: threading.Thread | None = None
    updater_error: str | None = None


@contextmanager
def timed_acquire(lock: threading.Lock, timeout: float) -> Iterator[bool]:
    # TODO move to ecpyutil
    result = lock.acquire(timeout=timeout)
    try:
        yield result
    finally:
        if result:
            lock.release()


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


def load_plugins(plugins: list[PluginSettings]) -> None:
    logger.info("starting initial plugin load")
    try:
        lookup = {}
        errors = {}
        for plugin in plugins:
            # TODO consider running all pip invocations at once -- worse error reporting but better perf
            if plugin.update_strategy == "auto":
                logger.info(f"auto-updating {plugin.module_name}")
                _try_install(plugin.pip_source)
            else:
                if _try_import(plugin.module_name) is None:
                    logger.info(f"installing {plugin.module_name} for the first time")
                    _try_install(plugin.pip_source)

            if plugin.module_name in plugins:
                errors[plugin.module_name] = f"plugin {plugin.module_name} is provided by more than just {plugin.pip_source}"
            else:
                result = load_single(plugin)
                logger.debug(f"plugin {plugin} loaded with success: {isinstance(result, Plugin)}")
                if isinstance(result, Plugin):
                    lookup[plugin.module_name] = result
                elif isinstance(result, str):
                    errors[plugin.module_name] = result
                else:
                    assert_never(result)

        with timed_acquire(PluginManager.lock, 60) as result:
            if not result:
                raise ValueError("failed to acquire the shared lock")
            PluginManager.plugins = lookup
            PluginManager.errors = errors
        logger.debug("global plugin loading finished")
    except Exception as e:
        logger.exception(f"updating thread failed with {repr(e)}")
        with timed_acquire(PluginManager.lock, 5) as _:
            # NOTE we ignore result -- we rather corrupt than deadlock
            PluginManager.updater_error = repr(e)


def update_single(plugin: PluginSettings) -> None:
    try:
        if plugin.module_name not in PluginManager.plugins:
            result = "attempted to update but was not installed"
        else:
            _try_install(plugin.pip_source)
            # NOTE we recommend in the docs to re-launch app after an update, this need not cover all cases
            importlib.reload(importlib.import_module(plugin.module_name))
            plugin_impl = _try_import(plugin.module_name)
            result = load_single(plugin)
            logger.debug(f"plugin {plugin} loaded with success: {isinstance(result, Plugin)}")
        with timed_acquire(PluginManager.lock, 60) as acquire_result:
            if not acquire_result:
                raise ValueError("failed to acquire the shared lock")
            if isinstance(result, Plugin):
                PluginManager.plugins[plugin.module_name] = result
            elif isinstance(result, str):
                PluginManager.errors[plugin.module_name] = result
            else:
                assert_never(result)
        logger.debug("single plugin loading finished: {plugin.module_name}")
    except Exception as e:
        logger.exception(f"updating thread failed with {repr(e)}")
        with timed_acquire(PluginManager.lock, 5) as _:
            # NOTE we ignore result -- we rather corrupt than deadlock
            PluginManager.updater_error = repr(e)


def submit_load_plugins():
    with timed_acquire(PluginManager.lock, 0.2) as result:
        if not result:
            logger.error("failed to submit load_plugins")
            # NOTE we ignore result -- we rather corrupt than deadlock
            PluginManager.updater_error = "failed to submit load_plugins"
        elif PluginManager.updater is not None:
            raise TypeError("attempted to submit load_plugins but updater is already in progress")
        else:
            PluginManager.updater = threading.Thread(target=load_plugins, args=(config.product.plugins,))
            PluginManager.updater.start()


class PluginsStatus(BaseModel):
    updater_status: Literal["ok", "running", "retrieving"] | str
    plugin_errors: dict[str, str]
    plugin_versions: dict[str, str]


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
        else:
            status = status_brief()
            plugin_errors = {plugin: error for plugin, error in PluginManager.errors.items()}
            plugin_versions = {}
            for plugin in PluginManager.plugins.keys():
                try:
                    plugin_versions[plugin] = importlib.metadata.version(plugin)
                except importlib.metadata.PackageNotFoundError:
                    plugin_errors[plugin] = f"failed to determine version of {plugin}"
    return PluginsStatus(
        updater_status=status,
        plugin_errors=plugin_errors,
        plugin_versions=plugin_versions,
    )


def catalogue_view() -> dict[PluginId, BlockFactoryCatalogue] | bool:
    with timed_acquire(PluginManager.lock, 1.0) as result:
        if not result:
            return False
        else:
            return {plugin_id: plugin.catalogue for plugin_id, plugin in PluginManager.plugins.items()}


def submit_update_single(plugin_name: str) -> str:
    # NOTE consider caching this lookup
    lookup = {e.module_name: e.pip_source for e in config.product.plugins}
    if plugin_name not in lookup:
        return f"plugin {plugin_name} not configured"
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
            PluginManager.updater = threading.Thread(target=update_single, args=(lookup[plugin_name],))
            PluginManager.updater.start()
    return ""


def join_updater_thread(timeout_sec: int) -> None:
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
