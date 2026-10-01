# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Entrypoint for the plugin-installing part of the warmup, invoked by `scripts/fiab.sh warmup`
after the venv itself has been prepared.

Contrary to `forecastbox.entrypoint.main`, no backend is started here -- neither the FastAPI app,
nor the execution manager pools, nor the event dispatcher. Only the minimum needed for a plugin
install is prepared (database schema, artifact catalog, plugin stores), and then each default
plugin (per config.external.default_plugins) is installed by calling
`domain.plugin.loading.update_single` directly and sequentially. That function is fully
synchronous, accesses the jobs database through the `db.py` helpers (which take the database lock
themselves), and emits no dispatcher events -- the notification and reservation machinery of
`domain.plugin.submit` exists for a live backend and is deliberately unused here. The one place
where an event loop is needed is the database schema creation, as the users database is async; a
short-lived `asyncio.run` covers just that.

Any per-plugin settings override configured in config.external.default_plugins_settings is applied
right after that plugin's install, by calling `domain.plugin.db.upsert_plugin_state` and then
either `domain.plugin.loading.unload_single` (if the override disables the plugin) or
`domain.plugin.loading.update_single` again with `install=False` (to reload/re-ingest it with the
overridden exclusions/remapping) -- the same two steps the live `/plugin/settings` route performs.

This is expected to run in isolation, on an otherwise vanilla environment -- there is no
cross-process locking against a concurrently running backend mutating the same venv, config file
and database.
"""

# TODO re-use the "kill other instances" here like we do with backend
# TODO extend the "kill other instances" with some pid file lock?

import asyncio
import logging
import sys

import fire
from fiab_core.fable import PluginCompositeId

from forecastbox.domain.artifact.manager import join_artifact_manager, submit_refresh_catalog
from forecastbox.domain.plugin.db import get_plugin_state, upsert_plugin_state
from forecastbox.domain.plugin.exceptions import PluginEnvironmentAlreadyBroken
from forecastbox.domain.plugin.loading import unload_single, update_single
from forecastbox.domain.plugin.settings import PluginSettings
from forecastbox.domain.plugin.store import initialize_stores, resolve_plugin_from_store
from forecastbox.entrypoint.bootstrap.config import setup_process
from forecastbox.entrypoint.initializers import start_artifact_provider, start_db_schema
from forecastbox.utility.config import DefaultPluginSettings, config, validate_runtime
from forecastbox.utility.packages import PackagesError

logger = logging.getLogger(__name__ if __name__ != "__main__" else __package__)

CATALOG_TIMEOUT_SEC = 600
"""How long we wait for the artifact catalog refresh -- generous, it is a plain http fetch"""

CATALOG_JOIN_TIMEOUT_SEC = 10
"""How long we wait for the artifact manager's executor to be joined at the very end"""


def _resolve_settings(plugin_id: PluginCompositeId) -> PluginSettings:
    """Resolve the plugin from the stores, falling back to its already-persisted DB state
    when the plugin is currently unknown to the stores (e.g. reinstalling a plugin whose
    store entry has since been removed)"""
    try:
        return resolve_plugin_from_store(plugin_id)
    except ValueError as e:
        db_state = get_plugin_state(PluginCompositeId.to_str(plugin_id))
        if db_state is None:
            raise
        logger.warning(f"plugin {PluginCompositeId.to_str(plugin_id)} not resolvable from stores ({e}), using the persisted DB state")
        return db_state.to_settings()


def _apply_settings_override(plugin_id: PluginCompositeId, settings: PluginSettings, override: DefaultPluginSettings) -> None:
    """Persist the configured settings override for a just-installed plugin, then apply it:
    unload the plugin if the override disables it, otherwise reload/re-ingest it so that an
    overridden `excluded_templates`/`glyph_remapping` takes effect immediately."""
    plugin_id_str = PluginCompositeId.to_str(plugin_id)
    upsert_plugin_state(
        plugin_id=plugin_id_str,
        enabled=override.is_enabled,
        excluded_templates=override.excluded_templates,
        glyph_remapping=override.glyph_remapping,
        update_strategy=override.update_strategy,
    )
    if override.is_enabled is False:
        unload_single(plugin_id)
    else:
        update_single(plugin_id, settings, install=False, version=None)


def _install_plugins(plugin_ids: list[PluginCompositeId]) -> dict[str, str]:
    """Install every plugin, one after another, and return the errors of those that failed.

    A failure of a single plugin (a failed pip resolution, a broken import, applying its
    configured settings override, ...) is collected and the remaining plugins are still
    attempted. A failure that renders the whole environment unusable
    (`PluginEnvironmentAlreadyBroken`, `PackagesError`) is not recoverable by trying
    another plugin, hence it is propagated right away.
    """
    failures: dict[str, str] = {}
    for plugin_id in plugin_ids:
        plugin_id_str = PluginCompositeId.to_str(plugin_id)
        logger.info(f"installing plugin {plugin_id_str}")
        try:
            settings = _resolve_settings(plugin_id)
            update_single(plugin_id, settings, install=True, version=None)
            override = config.external.default_plugins_settings.get(plugin_id)
            if override is not None:
                _apply_settings_override(plugin_id, settings, override)
        except (PluginEnvironmentAlreadyBroken, PackagesError):
            logger.error(f"environment is not usable for plugin installation, aborting at {plugin_id_str}")
            raise
        except Exception as e:
            logger.exception(f"failed to install plugin {plugin_id_str}: {repr(e)}")
            failures[plugin_id_str] = repr(e)
    return failures


def warmup() -> None:
    """Install the default plugins (per config.external.default_plugins) into the current venv"""
    setup_process()
    validate_runtime(config)
    plugin_ids = config.external.default_plugins
    logger.info(f"warmup starting for plugins {[PluginCompositeId.to_str(e) for e in plugin_ids]}")

    asyncio.run(start_db_schema())
    start_artifact_provider()
    catalog_refresh = submit_refresh_catalog()
    initialize_stores(config.external.plugin_stores)
    catalog_refresh.result(timeout=CATALOG_TIMEOUT_SEC)

    failures = None
    try:
        failures = _install_plugins(plugin_ids)
    finally:
        join_artifact_manager(timeout_sec=CATALOG_JOIN_TIMEOUT_SEC)

    if failures:
        for plugin_id_str, error in failures.items():
            logger.error(f"warmup failed to install {plugin_id_str}: {error}")
        sys.exit(f"warmup finished with {len(failures)}/{len(plugin_ids)} plugins failed")
    logger.info(f"warmup finished, {len(plugin_ids)} plugins installed")


if __name__ == "__main__":
    # NOTE this is referenced from scripts/fiab.sh -- if you refactor this module, pay attention to it
    fire.Fire(warmup)
