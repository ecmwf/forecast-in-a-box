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
persisted in the DB and read back via domain.plugin.detail; they are not held in memory.

There is at most one thread at any time doing any pip/importlib operations,
thus inside these updater threads we don't need any other critical sections.
We pay attention not to block forever on acquiring when inquiring for status
or when running the initial plugin load -- but inside the updater threads,
we lock for longer.
"""

import importlib
import logging
import re
import threading
import time
from collections.abc import Callable
from concurrent.futures import Future
from functools import partial
from typing import TypeVar

from cascade.low.func import Either
from fiab_core.fable import BlockFactoryCatalogue, PluginCompositeId
from fiab_core.plugin import Plugin
from packaging.version import Version
from pyrsistent import pmap
from pyrsistent.typing import PMap

from forecastbox.domain.glyphs import global_db
from forecastbox.domain.plugin.compatibility import install_plugin_compatibly
from forecastbox.domain.plugin.db import (
    clear_asset_ingest_needed,
    get_plugin_state,
    update_template_errors,
    upsert_plugin_state,
)
from forecastbox.domain.plugin.errors import PluginError, PluginErrors
from forecastbox.utility.auth import AuthContext
from forecastbox.utility.concurrency.manager import TaskName, execution_manager
from forecastbox.utility.concurrency.synchronization import delayed_thread, timed_acquire
from forecastbox.utility.config import ConcurrentPools, PluginSettings, PluginsSettings, config, config_edit_lock
from forecastbox.utility.packages import try_import, try_version

logger = logging.getLogger(__name__)
T = TypeVar("T")


class PluginManager:
    lock: threading.Lock = threading.Lock()
    plugins: PMap[PluginCompositeId, Plugin] = pmap()
    errors: PMap[PluginCompositeId, PluginErrors] = pmap()
    updater: threading.Thread | None = None
    updater_error: str | None = None


def _jobs_db_result(task_name: str, task: Callable[[], T]) -> T:
    return execution_manager.submit_unmonitored(ConcurrentPools.JobsDb, TaskName(task_name), task).result()


async def _await_jobs_db(task_name: str, task: Callable[[], T]) -> T:
    return await execution_manager.awaitable_submit(ConcurrentPools.JobsDb, TaskName(task_name), task)


def load_single(plugin: PluginSettings) -> Either[Plugin, str]:  # type: ignore[invalid-argument]
    errors = []
    plugin_impl = try_import(plugin.module_name)
    if plugin_impl is None:
        errors.append(f"failed to import plugin {plugin.module_name}")
    elif not hasattr(plugin_impl, "plugin"):
        errors.append(f"plugin {plugin.module_name} does not have a `plugin` attribute")
    else:
        try:
            maybe_plugin = getattr(plugin_impl, "plugin")()
            if not isinstance(maybe_plugin, Plugin):
                errors.append(f"plugin {plugin.module_name}'s `plugin()` does not give a Plugin")
            else:
                return Either.ok(maybe_plugin)
        except Exception as e:
            errors.append(f"failed to invoke plugin(): {repr(e)}")
    return Either.error("\n".join(errors))


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


def _ingest_plugin_templates(plugin_id: PluginCompositeId, plugin: Plugin) -> None:
    """Upsert each blueprint template exposed by the plugin into the DB.

    Skips ingestion entirely if ``asset_ingest_needed`` is not set on the plugin's
    DB state row.  When ingestion does run, the flag is cleared *before* ingesting so
    that a partial failure does not trigger a spurious re-ingest; per-template errors
    are persisted via ``update_template_errors`` regardless.

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
    from forecastbox.domain.blueprint.service import (
        remap_builder_glyphs,
        resolve_builder_with_examples,
        template_to_builder,
        validate_expand_sync,
    )

    plugin_id_str = PluginCompositeId.to_str(plugin_id)

    state = _jobs_db_result("plugin.get-state", partial(get_plugin_state, plugin_id_str))
    if state is None:
        raise RuntimeError(
            f"_ingest_plugin_templates called for {plugin_id_str!r} but no PluginState row exists; "
            "this is a programming error -- upsert_plugin_state must be called before ingestion"
        )
    if not state.asset_ingest_needed:
        logger.debug(f"skipping template ingestion for {plugin_id_str!r}: asset_ingest_needed is False")
        return

    _jobs_db_result("plugin.clear-asset-ingest-needed", partial(clear_asset_ingest_needed, plugin_id=plugin_id_str))

    auth = AuthContext(user_id=plugin_id_str, is_admin=True)

    excluded_set = set(state.excluded_templates) if state.excluded_templates else set()  # type: ignore[arg-type]
    glyph_remapping: dict[str, str] = dict(state.glyph_remapping) if state.glyph_remapping else {}  # type: ignore[arg-type]

    template_errors: dict[str, str] = {}

    for template in plugin.blueprint_templates:
        try:
            if template.display_name in excluded_set:
                _jobs_db_result(
                    "plugin.soft-delete-template",
                    partial(soft_delete_plugin_template, created_by=plugin_id_str, display_name=template.display_name),
                )
                logger.debug(f"soft-deleted excluded template {template.display_name!r} from plugin {plugin_id_str!r}")
                continue
            existing_id = _jobs_db_result(
                "plugin.find-template-id",
                partial(find_plugin_template_id, created_by=plugin_id_str, display_name=template.display_name),
            )
            builder = template_to_builder(template, plugin_id)
            if glyph_remapping:
                builder = remap_builder_glyphs(builder, glyph_remapping)
            validation_builder = resolve_builder_with_examples(builder, template.example_values, template.example_glyphs)
            global_buckets = _jobs_db_result(
                "plugin.get-glyphs-for-validation",
                partial(global_db.get_glyphs_for_resolution, auth),
            )
            result = validate_expand_sync(validation_builder, global_buckets, validate_only=True)
            all_errors: list[str] = list(result.global_errors)
            for block_errs in result.block_errors.values():
                all_errors.extend(block_errs)
            if all_errors:
                template_errors[template.display_name] = "; ".join(all_errors)
                logger.warning(
                    f"template {template.display_name!r} from plugin {plugin_id_str!r} failed validation, skipping upsert: {all_errors}"
                )
                continue
            _jobs_db_result(
                "plugin.upsert-template-blueprint",
                partial(
                    upsert_blueprint,
                    auth_context=auth,
                    blueprint_id=existing_id,
                    source="plugin_template",
                    created_by=plugin_id_str,
                    builder=builder.model_dump(mode="json"),
                    display_name=template.display_name,
                    display_description=template.display_description,
                ),
            )
            logger.debug(f"ingested template {template.display_name!r} from plugin {plugin_id_str!r}")
        except Exception as e:
            template_errors[template.display_name] = repr(e)
            logger.error(f"failed to ingest template {template.display_name!r} from plugin {plugin_id_str!r}: {repr(e)}")

    _jobs_db_result(
        "plugin.update-template-errors",
        partial(update_template_errors, plugin_id=plugin_id_str, template_errors=template_errors),
    )


def load_plugins(plugins: PluginsSettings) -> None:
    logger.info("starting initial plugin load")
    try:
        lookup: dict[PluginCompositeId, Plugin] = {}
        errors: dict[PluginCompositeId, PluginErrors] = {}
        for pluginKey, pluginSettings in plugins.items():
            plugin_id_str = PluginCompositeId.to_str(pluginKey)
            db_state = _jobs_db_result("plugin.get-state", partial(get_plugin_state, plugin_id_str))
            if db_state is not None and not db_state.enabled:
                logger.info(f"skipping disabled plugin {pluginKey}")
                continue
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
                _jobs_db_result(
                    "plugin.upsert-state",
                    partial(
                        upsert_plugin_state,
                        plugin_id=plugin_id_str,
                        version="install failed",
                        enabled=True,
                        plugin_errors=PluginErrors([PluginError(source="install", severity="error", detail=install_error)]),
                    ),
                )
                continue
            if installed_versions:
                version_str = _version_from_install(installed_versions, pluginSettings.module_name)
                if version_str is not None:
                    _jobs_db_result(
                        "plugin.upsert-state",
                        partial(upsert_plugin_state, plugin_id=plugin_id_str, version=version_str, plugin_errors=PluginErrors([])),
                    )
                else:
                    # pip does not report the version if it isn't changed -> this branch is not necessarily a bug
                    logger.warning(f"pip install of plugin {plugin_id_str} did not produce a version, assuming no change")

            if pluginKey in lookup:
                errors[pluginKey] = PluginErrors(
                    [
                        PluginError(
                            source="load",
                            severity="error",
                            detail=f"plugin {pluginKey} is provided by more than just {pluginSettings.pip_source}",
                        )
                    ]
                )
                continue
            else:
                plugin_result = load_single(pluginSettings)
                if plugin_result.t is not None:
                    lookup[pluginKey] = plugin_result.t
                    version_imported = try_version(pluginSettings.pip_source, pluginSettings.module_name)
                    logger.debug(f"plugin {pluginKey} loaded with success: True and version {version_imported}")
                    fresh_state = _jobs_db_result("plugin.get-state", partial(get_plugin_state, plugin_id_str))
                    if fresh_state is None:
                        # NOTE this is unexpected state -- it is either developer editable install, or db wipe. We prefer to report,
                        # but dont prevent template ingest
                        err_msg = f"plugin {pluginKey} state not found -- install originally failed?"
                        logger.error(err_msg)
                        errors[pluginKey] = PluginErrors([PluginError(source="load", severity="error", detail=err_msg)])
                        _jobs_db_result(
                            "plugin.upsert-state",
                            partial(
                                upsert_plugin_state,
                                plugin_id=plugin_id_str,
                                version=version_imported,
                                enabled=True,
                                plugin_errors=PluginErrors([]),
                            ),
                        )
                    else:
                        db_ver = fresh_state.plugin_version
                        if db_ver != version_imported:
                            mismatch_msg = f"version mismatch: DB has {db_ver!r} but {version_imported!r} is imported"
                            logger.warning(f"plugin {pluginKey}: {mismatch_msg}")
                            errors[pluginKey] = PluginErrors([PluginError(source="load", severity="warning", detail=mismatch_msg)])
                else:
                    logger.debug(f"plugin {pluginKey} loaded with success: False")
                    errors[pluginKey] = PluginErrors([PluginError(source="load", severity="error", detail=plugin_result.e)])  # type: ignore[arg-type]

        # Publish all loaded plugins before running template ingestion so that
        # validate_expand can resolve factory references during validation.
        with timed_acquire(PluginManager.lock, 60) as lock_result:
            if not lock_result:
                raise ValueError("failed to acquire the shared lock")
            PluginManager.plugins = pmap(lookup)
            PluginManager.errors = pmap(errors)

        for pluginKey, plugin_result in lookup.items():
            _ingest_plugin_templates(pluginKey, plugin_result)

        logger.debug("global plugin loading finished")
    except Exception as e:
        logger.exception(f"updating thread failed with {repr(e)}")
        with timed_acquire(PluginManager.lock, 5) as _:
            # NOTE we ignore result -- we rather corrupt than deadlock
            PluginManager.updater_error = repr(e)


def update_single(pluginId: PluginCompositeId, pluginSettings: PluginSettings, install: bool, version: Version | None) -> None:
    plugin_id_str = PluginCompositeId.to_str(pluginId)
    try:
        db_state = _jobs_db_result("plugin.get-state", partial(get_plugin_state, plugin_id_str))
        if db_state is not None and not db_state.enabled:
            logger.info(f"skipping disabled plugin {pluginId} in update_single")
            return
        installed_versions: dict[str, str] = {}
        if install:
            install_result = install_plugin_compatibly(pluginSettings.pip_source, version)
            if install_result.e:
                _jobs_db_result(
                    "plugin.upsert-state",
                    partial(
                        upsert_plugin_state,
                        plugin_id=plugin_id_str,
                        version="install failed",
                        plugin_errors=PluginErrors([PluginError(source="install", severity="error", detail=install_result.e)]),
                    ),
                )
                raise RuntimeError(f"install failed for {pluginId}: {install_result.e}")
            installed_versions = install_result.t or {}
        # NOTE we need to recommend in the docs to re-launch app after this change, this wont cover all cases
        importlib.reload(importlib.import_module(pluginSettings.module_name))
        result = load_single(pluginSettings)
        logger.debug(f"plugin {pluginId} loaded with success: {result.t is not None}")
        version_install = _version_from_install(installed_versions, pluginSettings.module_name)
        version_imported = try_version(pluginSettings.pip_source, pluginSettings.module_name)
        version_mismatch_err: PluginError | None = None
        if version_install is not None and version_install != version_imported:
            mismatch_msg = f"version mismatch: pip installed {version_install!r} but {version_imported!r} is imported"
            logger.warning(f"plugin {pluginId}: {mismatch_msg}")
            version_mismatch_err = PluginError(source="load", severity="warning", detail=mismatch_msg)
        with timed_acquire(PluginManager.lock, 60) as acquire_result:
            if not acquire_result:
                raise ValueError("failed to acquire the shared lock")
            if result.t is not None:
                PluginManager.plugins = PluginManager.plugins.set(pluginId, result.t)
                new_errs: PluginErrors = PluginErrors([version_mismatch_err]) if version_mismatch_err is not None else PluginErrors([])
            else:
                load_err = PluginError(source="load", severity="error", detail=result.e)  # type: ignore[arg-type]
                new_errs = PluginErrors([load_err, version_mismatch_err] if version_mismatch_err is not None else [load_err])
            if new_errs:
                PluginManager.errors = PluginManager.errors.set(pluginId, new_errs)
            elif pluginId in PluginManager.errors:
                PluginManager.errors = PluginManager.errors.remove(pluginId)
        if version_install is not None:
            _jobs_db_result(
                "plugin.upsert-state",
                partial(upsert_plugin_state, plugin_id=plugin_id_str, version=version_install, plugin_errors=PluginErrors([])),
            )
        else:
            _jobs_db_result(
                "plugin.upsert-state",
                partial(upsert_plugin_state, plugin_id=plugin_id_str, plugin_errors=PluginErrors([])),
            )
        if result.t is not None:
            _ingest_plugin_templates(pluginId, result.t)
        logger.debug(f"single plugin loading finished: {pluginId}")
    except Exception as e:
        logger.exception(f"updating thread failed with {repr(e)}")
        with timed_acquire(PluginManager.lock, 5) as _:
            # NOTE we ignore result -- we rather corrupt than deadlock
            PluginManager.updater_error = repr(e)


async def unload_single(pluginId: PluginCompositeId) -> None:
    plugin_id_str = PluginCompositeId.to_str(pluginId)
    with timed_acquire(PluginManager.lock, 5) as result:
        if not result:
            logger.warning("failed to acquire lock for unload_single")
            return
        if pluginId in PluginManager.plugins:
            PluginManager.plugins = PluginManager.plugins.remove(pluginId)
        if pluginId in PluginManager.errors:
            PluginManager.errors = PluginManager.errors.remove(pluginId)
    # DB write outside the lock: remove blueprint templates.
    # Note: these imports are a breach of the dependency hierarchy (plugin domain depending
    # on blueprint domain), and will be fixed later by refactoring into events.
    from forecastbox.domain.blueprint.db import soft_delete_all_plugin_templates

    await _await_jobs_db(
        "plugin.soft-delete-all-templates",
        partial(soft_delete_all_plugin_templates, created_by=plugin_id_str),
    )


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


def status_brief() -> str:
    # NOTE this may be called without locking, we don't risk collection mutation during iteration
    if PluginManager.updater_error is not None:
        return f"failure: {PluginManager.updater_error}"
    updater = PluginManager.updater
    if updater is not None and updater.is_alive():
        return "running"
    return "ok"


def plugins_ready() -> bool:
    return status_brief() == "ok"


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


async def uninstall_plugin(pluginId: PluginCompositeId) -> None:
    if pluginId not in config.external.plugins:
        raise ValueError(f"plugin {pluginId} not installed")
    with timed_acquire(config_edit_lock, 5) as result:
        if not result:
            raise ValueError("failed to acquire the shared lock")
        config.external.plugins.pop(pluginId)
        config.save_to_file()
    await unload_single(pluginId)


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
