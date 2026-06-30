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
Pyrsistent immutable structures are used for shared state (plugins, errors),
making reads safe without locks. The lock is only acquired when swapping the
top-level structure pointers on writes. Plugin versions and timestamps are
persisted in the DB and read back by status_full; they are not held in memory.

There is at most one thread at any time doing any pip/importlib operations,
thus inside these updater threads we don't need any other critical sections.
We pay attention not to block forever on acquiring when inquiring for status
or when running the initial plugin load -- but inside the updater threads,
we lock for longer.
"""

import asyncio
import importlib
import logging
import re
import threading
import time
from concurrent.futures import Future
from typing import Literal

from cascade.low.func import Either, assert_never
from fiab_core.fable import BlockFactoryCatalogue, PluginCompositeId
from fiab_core.plugin import Plugin
from packaging.version import Version
from pyrsistent import pmap
from pyrsistent.typing import PMap

from forecastbox.domain.plugin.compatibility import install_plugin_compatibly
from forecastbox.domain.plugin.db import get_all_plugin_states, upsert_plugin_state
from forecastbox.utility.concurrent import delayed_thread, timed_acquire
from forecastbox.utility.config import PluginSettings, PluginsSettings, config, config_edit_lock
from forecastbox.utility.packages import try_import, try_version
from forecastbox.utility.pydantic import FiabBaseModel
from forecastbox.utility.time import value_dt2str

logger = logging.getLogger(__name__)


class PluginManager:
    lock: threading.Lock = threading.Lock()
    plugins: PMap[PluginCompositeId, Plugin] = pmap()
    errors: PMap[PluginCompositeId, str] = pmap()
    updater: threading.Thread | None = None
    updater_error: str | None = None
    loop: asyncio.AbstractEventLoop | None = None


def load_single(plugin: PluginSettings) -> Plugin | str:
    errors = []
    plugin_impl = try_import(plugin.module_name)
    if plugin_impl is None:
        errors.append(f"failed to import plugin {plugin.module_name}")
    elif not hasattr(plugin_impl, "plugin"):
        errors.append(f"plugin {plugin.module_name} does not have a `plugin` attribute")
    try:
        maybe_plugin = getattr(plugin_impl, "plugin")()
        if not isinstance(maybe_plugin, Plugin):
            errors.append(f"plugin {plugin.module_name}'s `plugin()` does not give a Plugin")
        else:
            return maybe_plugin
    except Exception as e:
        errors.append("failed to invoke plugin(): {repr(e)}")
    return "\n".join(errors)


def _run_async_from_thread(coro: object) -> object:  # type: ignore[type-arg]
    """Dispatch *coro* to the event loop stashed on PluginManager and block until done."""
    loop = PluginManager.loop
    if loop is None:
        # TODO -- send an event to bring down the whole app, not just the thread in question
        raise RuntimeError("PluginManager.loop is not set; cannot dispatch DB write from updater thread")
    return asyncio.run_coroutine_threadsafe(coro, loop).result()  # type: ignore[arg-type]


def _version_from_install(installed: dict[str, str], module_name: str) -> str | None:
    """Look up a plugin's newly-installed version from the pip install output dict.

    Normalises names per PEP 503 (``[-_.]+`` → ``-``, lowercase) before comparing,
    so ``fiab_plugin_test`` matches ``fiab-plugin-test`` in the pip output.
    """
    target = re.sub(r"[-_.]+", "-", module_name).lower()
    for name, ver in installed.items():
        if re.sub(r"[-_.]+", "-", name).lower() == target:
            return ver
    return None


async def _ingest_plugin_templates(plugin_id: PluginCompositeId, plugin: Plugin) -> None:
    """Upsert each blueprint template exposed by the plugin into the DB.

    Excluded templates (per ``PluginState.excluded_templates``) are skipped and
    any existing plugin-owned blueprint row with that ``display_name`` is
    soft-deleted.  Non-excluded templates have their glyph names rewritten by
    ``remap_builder_glyphs`` when a non-empty ``glyph_remapping`` is stored for
    the plugin, then are upserted as normal.

    Uses lazy imports to avoid circular dependencies between the plugin and
    blueprint domains.  A failure on any single template is logged and skipped
    so the remaining templates are still ingested.
    Note: these imports are a breach of the dependency hierarchy (plugin domain
    depending on blueprint domain), and will be fixed later by refactoring into events.
    """
    from forecastbox.domain.blueprint.db import find_plugin_template_id, soft_delete_plugin_template, upsert_blueprint
    from forecastbox.domain.blueprint.service import remap_builder_glyphs, template_to_builder
    from forecastbox.domain.plugin.db import get_plugin_settings
    from forecastbox.utility.auth import AuthContext

    plugin_id_str = PluginCompositeId.to_str(plugin_id)
    auth = AuthContext(user_id=plugin_id_str, is_admin=True)

    excluded_templates, glyph_remapping = await get_plugin_settings(plugin_id_str)
    excluded_set = set(excluded_templates)

    for template in plugin.blueprint_templates:
        try:
            if template.display_name in excluded_set:
                await soft_delete_plugin_template(created_by=plugin_id_str, display_name=template.display_name)
                logger.debug(f"soft-deleted excluded template {template.display_name!r} from plugin {plugin_id_str!r}")
                continue
            existing_id = await find_plugin_template_id(created_by=plugin_id_str, display_name=template.display_name)
            builder = template_to_builder(template, plugin_id)
            if glyph_remapping:
                builder = remap_builder_glyphs(builder, glyph_remapping)
            await upsert_blueprint(
                auth_context=auth,
                blueprint_id=existing_id,
                source="plugin_template",
                created_by=plugin_id_str,
                builder=builder.model_dump(mode="json"),
                display_name=template.display_name,
                display_description=template.display_description,
            )
            logger.debug(f"ingested template {template.display_name!r} from plugin {plugin_id_str!r}")
        except Exception as e:
            logger.error(f"failed to ingest template {template.display_name!r} from plugin {plugin_id_str!r}: {repr(e)}")


def load_plugins(plugins: PluginsSettings) -> None:
    logger.info("starting initial plugin load")
    try:
        lookup = {}
        errors = {}
        for pluginKey, pluginSettings in plugins.items():
            if not pluginSettings.enabled:
                continue
            plugin_id_str = PluginCompositeId.to_str(pluginKey)
            installed_versions: dict[str, str] = {}
            install_error: str | None = None
            # NOTE consider running all pip invocations at once -- worse error reporting but better perf
            if pluginSettings.update_strategy == "auto":
                logger.info(f"auto-updating {pluginSettings.module_name}")
                result = install_plugin_compatibly(pluginSettings.pip_source, None)
                if result.e:
                    install_error = result.e
                else:
                    installed_versions = result.t or {}
            else:
                if try_import(pluginSettings.module_name) is None:
                    logger.info(f"installing {pluginSettings.module_name} for the first time")
                    result = install_plugin_compatibly(pluginSettings.pip_source, None)
                    if result.e:
                        install_error = result.e
                    else:
                        installed_versions = result.t or {}

            if install_error is not None:
                logger.error(f"install failed for {pluginKey}: {install_error}")
                _run_async_from_thread(upsert_plugin_state(plugin_id=plugin_id_str, version="install failed", install_error=install_error))
                errors[pluginKey] = install_error
                continue

            if pluginKey in lookup:
                errors[pluginKey] = f"plugin {pluginKey} is provided by more than just {pluginSettings.pip_source}"
            else:
                plugin_result = load_single(pluginSettings)
                logger.debug(f"plugin {pluginKey} loaded with success: {isinstance(plugin_result, Plugin)}")
                if isinstance(plugin_result, Plugin):
                    lookup[pluginKey] = plugin_result
                elif isinstance(plugin_result, str):
                    errors[pluginKey] = plugin_result
                else:
                    assert_never(plugin_result)
                version_str = _version_from_install(installed_versions, pluginSettings.module_name) or try_version(
                    pluginSettings.pip_source, pluginSettings.module_name
                )
                _run_async_from_thread(upsert_plugin_state(plugin_id=plugin_id_str, version=version_str, install_error=None))
                if isinstance(plugin_result, Plugin):
                    _run_async_from_thread(_ingest_plugin_templates(pluginKey, plugin_result))

        with timed_acquire(PluginManager.lock, 60) as lock_result:
            if not lock_result:
                raise ValueError("failed to acquire the shared lock")
            PluginManager.plugins = pmap(lookup)
            PluginManager.errors = pmap(errors)
        logger.debug("global plugin loading finished")
    except Exception as e:
        logger.exception(f"updating thread failed with {repr(e)}")
        with timed_acquire(PluginManager.lock, 5) as _:
            # NOTE we ignore result -- we rather corrupt than deadlock
            PluginManager.updater_error = repr(e)


def update_single(pluginId: PluginCompositeId, pluginSettings: PluginSettings, install: bool, version: Version | None) -> None:
    plugin_id_str = PluginCompositeId.to_str(pluginId)
    try:
        installed_versions: dict[str, str] = {}
        if install:
            install_result = install_plugin_compatibly(pluginSettings.pip_source, version)
            if install_result.e:
                _run_async_from_thread(
                    upsert_plugin_state(plugin_id=plugin_id_str, version="install failed", install_error=install_result.e)
                )
                raise RuntimeError(f"install failed for {pluginId}: {install_result.e}")
            installed_versions = install_result.t or {}
        # NOTE we need to recommend in the docs to re-launch app after this change, this wont cover all cases
        importlib.reload(importlib.import_module(pluginSettings.module_name))
        plugin_impl = try_import(pluginSettings.module_name)
        result = load_single(pluginSettings)
        logger.debug(f"plugin {pluginId} loaded with success: {isinstance(result, Plugin)}")
        version_str = _version_from_install(installed_versions, pluginSettings.module_name) or try_version(
            pluginSettings.pip_source, pluginSettings.module_name
        )
        with timed_acquire(PluginManager.lock, 60) as acquire_result:
            if not acquire_result:
                raise ValueError("failed to acquire the shared lock")
            if isinstance(result, Plugin):
                PluginManager.plugins = PluginManager.plugins.set(pluginId, result)
            elif isinstance(result, str):
                PluginManager.errors = PluginManager.errors.set(pluginId, result)
            else:
                assert_never(result)
        _run_async_from_thread(upsert_plugin_state(plugin_id=plugin_id_str, version=version_str, install_error=None))
        if isinstance(result, Plugin):
            _run_async_from_thread(_ingest_plugin_templates(pluginId, result))
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


def submit_load_plugins(start_after: Future[None]) -> None:
    with timed_acquire(PluginManager.lock, 0.2) as result:
        if not result:
            logger.error("failed to submit load_plugins")
            # NOTE we ignore result -- we rather corrupt than deadlock
            PluginManager.updater_error = "failed to submit load_plugins"
        elif PluginManager.updater is not None:
            raise TypeError("attempted to submit load_plugins but updater is already in progress")
        else:
            PluginManager.updater = delayed_thread(start_after, load_plugins, (config.external.plugins,))
            PluginManager.updater.start()


class PluginsStatus(FiabBaseModel):
    # TODO Change these fields to use pyrsistent types (PMap) instead of dict once we solve pydantic serialization.
    # However, no immediate hotfix is needed as this class is constructed with a lock, ie, consistently
    updater_status: Literal["ok", "running", "retrieving"] | str
    plugin_errors: dict[PluginCompositeId, str]
    plugin_versions: dict[PluginCompositeId, str]
    plugin_updatedatetime: dict[PluginCompositeId, str]


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


async def status_full() -> PluginsStatus:
    with timed_acquire(PluginManager.lock, 0.2) as result:
        if not result:
            status = "retrieving"
            plugin_errors: dict[PluginCompositeId, str] = {}
        else:
            status = status_brief()
            plugin_errors = dict(PluginManager.errors)
    plugin_versions: dict[PluginCompositeId, str] = {}
    plugin_updatedatetime: dict[PluginCompositeId, str] = {}
    try:
        states = await get_all_plugin_states()
        for state in states:
            try:
                plugin_id = PluginCompositeId.from_str(state.plugin_id)  # type: ignore[arg-type]
            except Exception:
                logger.warning(f"could not parse plugin_id {state.plugin_id!r} from DB; skipping")
                continue
            if state.install_error is not None:  # type: ignore[misc]
                existing = plugin_errors.get(plugin_id)
                plugin_errors[plugin_id] = (
                    f"{existing}; {state.install_error}" if existing else state.install_error  # type: ignore[misc]
                )
            plugin_versions[plugin_id] = state.plugin_version  # type: ignore[assignment]
            plugin_updatedatetime[plugin_id] = value_dt2str(state.updated_at)  # type: ignore[arg-type]
    except Exception:
        logger.warning("failed to load plugin states from DB; status may be incomplete", exc_info=True)
    return PluginsStatus(
        updater_status=status,
        plugin_errors=plugin_errors,
        plugin_versions=plugin_versions,
        plugin_updatedatetime=plugin_updatedatetime,
    )


def catalogue_view() -> dict[PluginCompositeId, BlockFactoryCatalogue] | bool:
    with timed_acquire(PluginManager.lock, 1.0) as result:
        if not result:
            return False
        else:
            return {plugin_id: plugin.catalogue for plugin_id, plugin in PluginManager.plugins.items()}


def submit_update_single(pluginId: PluginCompositeId, install: bool, version: Version | None) -> str:
    pluginSettings = config.external.plugins.get(pluginId, None)
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
            PluginManager.updater = threading.Thread(target=update_single, args=(pluginId, pluginSettings, install, version))
            PluginManager.updater.start()
    return ""


def uninstall_plugin(pluginId: PluginCompositeId) -> None:
    if pluginId not in config.external.plugins:
        raise ValueError(f"plugin {pluginId} not installed")
    with timed_acquire(config_edit_lock, 5) as result:
        if not result:
            raise ValueError("failed to acquire the shared lock")
        config.external.plugins.pop(pluginId)
        config.save_to_file()
    unload_single(pluginId)


def modify_enabled(pluginId: PluginCompositeId, isEnabled: bool) -> None:
    with timed_acquire(config_edit_lock, 5) as result:
        if not result:
            raise ValueError("failed to acquire the shared lock")
        config.external.plugins[pluginId].enabled = isEnabled
        config.save_to_file()
    if not isEnabled:
        unload_single(pluginId)
    else:
        submit_update_single(pluginId, install=False, version=None)


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
