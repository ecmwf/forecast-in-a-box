# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Synchronous plugin load/update/reload/unload worker orchestration.

Every function here is meant to run in the single-worker
``ConcurrentPools.PluginManagement`` pool (or, for tests, be called directly).
Unexpected exceptions are left to propagate to the caller (see
``domain.plugin.submit``'s managed-operation wrapper), while per-plugin
install/load outcomes are represented as ``PluginErrors`` and are normal,
non-raising completions, to be persisted in a structured form.
"""

import importlib
import logging
import re

from cascade.low.func import Either
from fiab_core.fable import PluginCompositeId
from fiab_core.plugin import Plugin
from packaging.version import Version
from pydantic import ValidationError

from forecastbox.domain.plugin.compatibility import check_environment_baseline, install_plugin_compatibly
from forecastbox.domain.plugin.db import delete_plugin_state, get_plugin_state, upsert_plugin_state
from forecastbox.domain.plugin.errors import PluginError, PluginErrors
from forecastbox.domain.plugin.state import publish_bulk_snapshot, publish_single_snapshot, publish_unloaded
from forecastbox.domain.plugin.template_ingest import ingest_plugin_templates, unload_plugin_templates
from forecastbox.utility.concurrency.synchronization import timed_acquire
from forecastbox.utility.config import PluginSettings, PluginsSettings, config, config_edit_lock
from forecastbox.utility.packages import try_import, try_version

logger = logging.getLogger(__name__)


def _load_single(plugin: PluginSettings) -> Either[Plugin, str]:  # type: ignore[invalid-argument]
    """Attempts to import the module and retrieve the `plugin` attribute, oversee the pydantic
    validation, and return the valid object

    Not expected to raise -- import errors and pydantic validation errors are propagated as Either.e
    """
    errors = []
    try:
        plugin_impl = try_import(plugin.module_name)
    except ValidationError as e:
        # NOTE this should not typically happen -- it suggests a mismatch in core contract
        msg = f"plugin {plugin.module_name} failed to validate with {e!r}"
        logger.error(msg)
        errors.append(msg)
        return Either.error("\n".join(errors))

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

    Normalises names per PEP 503 (``[-_.]+`` -> ``-``, lowercase) before comparing,
    so ``fiab_plugin_test`` matches ``fiab-plugin-test`` in the pip output.
    """
    # TODO this should live in utility in some form. Possibly normalize by default
    # to keep it simple
    target = re.sub(r"[-_.]+", "-", module_name).lower()
    for name, ver in installed.items():
        if re.sub(r"[-_.]+", "-", name).lower() == target:
            return ver
    return None


def load_plugins(plugins: PluginsSettings) -> None:
    """Initial bulk load: install/import every configured, enabled plugin, publish the
    complete catalogue in one atomic snapshot, then run template ingestion for each
    successfully loaded plugin.
    """
    logger.info("starting initial plugin load")
    check_environment_baseline()
    lookup: dict[PluginCompositeId, Plugin] = {}
    errors: dict[PluginCompositeId, PluginErrors] = {}
    for pluginKey, pluginSettings in plugins.items():
        plugin_id_str = PluginCompositeId.to_str(pluginKey)
        db_state = get_plugin_state(plugin_id_str)
        if db_state is not None and not db_state.enabled:
            logger.info(f"skipping disabled plugin {pluginKey}")
            continue
        installed_versions: dict[str, str] = {}
        install_error: str | None = None
        # NOTE consider running all pip invocations at once -- worse error reporting but better perf
        if pluginSettings.update_strategy == "auto":
            logger.info(f"auto-updating {pluginSettings.module_name}")
            result = install_plugin_compatibly(pluginSettings.pip_source, None, pluginSettings.module_name)
            if result.e:
                install_error = result.e
            else:
                installed_versions = result.t or {}
        else:
            try:
                is_found = try_import(pluginSettings.module_name) is None
            except Exception:
                # NOTE we just want to check whether we should run pip. This error will be resurfaced later during _load_single
                is_found = True
            if is_found:
                logger.info(f"installing {pluginSettings.module_name} for the first time")
                result = install_plugin_compatibly(pluginSettings.pip_source, None, pluginSettings.module_name)
                if result.e:
                    install_error = result.e
                else:
                    installed_versions = result.t or {}

        if install_error is not None:
            logger.error(f"install failed for {pluginKey}: {install_error}")
            upsert_plugin_state(
                plugin_id=plugin_id_str,
                version="install failed",
                enabled=True,
                plugin_errors=PluginErrors([PluginError(source="install", severity="error", detail=install_error)]),
            )
            continue
        if installed_versions:
            version_str = _version_from_install(installed_versions, pluginSettings.module_name)
            if version_str is not None:
                upsert_plugin_state(plugin_id=plugin_id_str, version=version_str, plugin_errors=PluginErrors([]))
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
        plugin_result = _load_single(pluginSettings)
        if plugin_result.t is not None:
            lookup[pluginKey] = plugin_result.t
            version_imported = try_version(pluginSettings.pip_source, pluginSettings.module_name)
            logger.debug(f"plugin {pluginKey} loaded with success: True and version {version_imported}")
            fresh_state = get_plugin_state(plugin_id_str)
            if fresh_state is None:
                # NOTE this is unexpected state -- it is either developer editable install, or db wipe. We prefer to report,
                # but dont prevent template ingest
                err_msg = f"plugin {pluginKey} state not found -- install originally failed?"
                logger.error(err_msg)
                errors[pluginKey] = PluginErrors([PluginError(source="load", severity="error", detail=err_msg)])
                upsert_plugin_state(plugin_id=plugin_id_str, version=version_imported, enabled=True, plugin_errors=PluginErrors([]))
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
    # validate_expand_sync can resolve factory references during validation.
    if not publish_bulk_snapshot(lookup, errors):
        raise ValueError("failed to acquire the shared lock")

    for pluginKey, plugin_result in lookup.items():
        ingest_plugin_templates(pluginKey, plugin_result)

    logger.info("global plugin loading finished")


def update_single(pluginId: PluginCompositeId, pluginSettings: PluginSettings, install: bool, version: Version | None) -> None:
    """Install (if requested), import/reload, and publish one plugin."""
    plugin_id_str = PluginCompositeId.to_str(pluginId)
    db_state = get_plugin_state(plugin_id_str)
    if db_state is not None and not db_state.enabled:
        logger.info(f"skipping disabled plugin {pluginId} in update_single")
        return
    installed_versions: dict[str, str] = {}
    if install:
        check_environment_baseline()
        install_result = install_plugin_compatibly(pluginSettings.pip_source, version, pluginSettings.module_name)
        if install_result.e:
            upsert_plugin_state(
                plugin_id=plugin_id_str,
                version="install failed",
                plugin_errors=PluginErrors([PluginError(source="install", severity="error", detail=install_result.e)]),
            )
            raise RuntimeError(f"install failed for {pluginId}: {install_result.e}")
        installed_versions = install_result.t or {}
    # NOTE we need to recommend in the docs to re-launch app after this change, this wont cover all cases:
    # reloading the top-level module does not reload already-imported submodules/dependencies,
    # replace previously-imported symbols, update existing instances, or reinitialize extension
    # modules/registries. See domain.plugin.compatibility's module docstring for the full caveat.
    importlib.invalidate_caches()
    importlib.reload(importlib.import_module(pluginSettings.module_name))
    result = _load_single(pluginSettings)
    logger.debug(f"plugin {pluginId} loaded with success: {result.t is not None}")
    version_install = _version_from_install(installed_versions, pluginSettings.module_name)
    version_imported = try_version(pluginSettings.pip_source, pluginSettings.module_name)
    version_mismatch_err: PluginError | None = None
    if version_install is not None and version_install != version_imported:
        mismatch_msg = f"version mismatch: pip installed {version_install!r} but {version_imported!r} is imported"
        logger.warning(f"plugin {pluginId}: {mismatch_msg}")
        version_mismatch_err = PluginError(source="load", severity="warning", detail=mismatch_msg)
    if result.t is not None:
        new_errs: PluginErrors = PluginErrors([version_mismatch_err]) if version_mismatch_err is not None else PluginErrors([])
    else:
        load_err = PluginError(source="load", severity="error", detail=result.e)  # type: ignore[arg-type]
        new_errs = PluginErrors([load_err, version_mismatch_err] if version_mismatch_err is not None else [load_err])
    if not publish_single_snapshot(pluginId, result.t, new_errs):
        raise ValueError("failed to acquire the shared lock")
    if version_install is not None:
        upsert_plugin_state(plugin_id=plugin_id_str, version=version_install, plugin_errors=PluginErrors([]))
    else:
        upsert_plugin_state(plugin_id=plugin_id_str, plugin_errors=PluginErrors([]))
    if result.t is not None:
        ingest_plugin_templates(pluginId, result.t)
    logger.debug(f"single plugin loading finished: {pluginId}")


def unload_single(plugin_id: PluginCompositeId) -> None:
    """Remove a plugin's in-memory catalogue/error entries and soft-delete its templates.

    Synchronous primitive shared by the plugin-settings disable path and uninstall.
    """
    if not publish_unloaded(plugin_id):
        logger.error("failed to mark plugin as unloaded! Will still be available")
        # we raise to mark this future as failed
        raise TimeoutError("failed to mark plugin as unloaded due to lock acquisition")
    # DB write outside the lock: remove blueprint templates
    unload_plugin_templates(plugin_id)


def uninstall_plugin_sync(plugin_id: PluginCompositeId) -> None:
    """Delete a plugin's DB state, remove its config entry, and unload its in-memory
    catalogue/templates. Runs synchronously on a ``PluginManagement`` worker, so direct
    (not pool-bridged) DB and config access is correct here.
    """
    if plugin_id not in config.external.plugins:
        raise ValueError(f"plugin {plugin_id} not installed")
    delete_plugin_state(plugin_id=PluginCompositeId.to_str(plugin_id))
    with timed_acquire(config_edit_lock, 5) as result:
        if not result:
            raise ValueError("failed to acquire the shared lock")
        config.external.plugins.pop(plugin_id)
        config.save_to_file()
    unload_single(plugin_id)
