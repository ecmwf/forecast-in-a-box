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
install is prepared (database schema, artifact catalog, plugin stores), and then each requested
plugin is installed by calling `domain.plugin.loading.update_single` directly and sequentially.
That function is fully synchronous, accesses the jobs database through the `db.py` helpers (which
take the database lock themselves), and emits no dispatcher events -- the notification and
reservation machinery of `domain.plugin.submit` exists for a live backend and is deliberately
unused here. The one place where an event loop is needed is the database schema creation, as the
users database is async; a short-lived `asyncio.run` covers just that.

The plugins to install are given as `-p store:local[,store:local...]`; when omitted, the default
plugins from the config are installed. Note that a repeated `-p` flag is not supported by `fire`
(the last occurrence would silently win) -- use the comma separated form instead.

This is expected to run in isolation, on an otherwise vanilla environment -- there is no
cross-process locking against a concurrently running backend mutating the same venv, config file
and database.
"""

import asyncio
import logging
import sys

import fire
from fiab_core.fable import PluginCompositeId

from forecastbox.domain.artifact.manager import join_artifact_manager, submit_refresh_catalog
from forecastbox.domain.plugin.exceptions import PluginEnvironmentAlreadyBroken
from forecastbox.domain.plugin.loading import update_single
from forecastbox.domain.plugin.store import initialize_stores, register_plugin_from_store
from forecastbox.entrypoint.bootstrap.config import setup_process
from forecastbox.entrypoint.initializers import start_artifact_provider, start_db_schema
from forecastbox.utility.config import PluginSettings, _default_plugins, config, validate_runtime
from forecastbox.utility.packages import PackagesError

logger = logging.getLogger(__name__ if __name__ != "__main__" else __package__)

CATALOG_TIMEOUT_SEC = 600
"""How long we wait for the artifact catalog refresh -- generous, it is a plain http fetch"""

CATALOG_JOIN_TIMEOUT_SEC = 10
"""How long we wait for the artifact manager's executor to be joined at the very end"""


def _parse_plugin_ids(plugin: str | tuple[str, ...] | list[str] | None) -> list[PluginCompositeId]:
    """Convert the `-p` values into composite ids, defaulting to the configured default plugins.

    A single `-p store:local` arrives as a string, a `-p store:local,store:other` as a tuple.
    """
    if plugin is None:
        return list(_default_plugins().keys())
    raw = [plugin] if isinstance(plugin, str) else list(plugin)
    return [PluginCompositeId.from_str(e) for e in raw]


def _resolve_settings(plugin_id: PluginCompositeId) -> PluginSettings:
    """Register the plugin in the config file based on the store entry, falling back to an
    already configured entry when the plugin is unknown to the stores"""
    try:
        return register_plugin_from_store(plugin_id)
    except ValueError as e:
        configured = config.external.plugins.get(plugin_id, None)
        if configured is None:
            raise
        logger.warning(f"plugin {PluginCompositeId.to_str(plugin_id)} not resolvable from stores ({e}), using the configured entry")
        return configured


def _install_plugins(plugin_ids: list[PluginCompositeId]) -> dict[str, str]:
    """Install every plugin, one after another, and return the errors of those that failed.

    A failure of a single plugin (a failed pip resolution, a broken import, ...) is collected and
    the remaining plugins are still attempted. A failure that renders the whole environment
    unusable (`PluginEnvironmentAlreadyBroken`, `PackagesError`) is not recoverable by trying
    another plugin, hence it is propagated right away.
    """
    failures: dict[str, str] = {}
    for plugin_id in plugin_ids:
        plugin_id_str = PluginCompositeId.to_str(plugin_id)
        logger.info(f"installing plugin {plugin_id_str}")
        try:
            settings = _resolve_settings(plugin_id)
            update_single(plugin_id, settings, install=True, version=None)
        except (PluginEnvironmentAlreadyBroken, PackagesError):
            logger.error(f"environment is not usable for plugin installation, aborting at {plugin_id_str}")
            raise
        except Exception as e:
            logger.exception(f"failed to install plugin {plugin_id_str}: {repr(e)}")
            failures[plugin_id_str] = repr(e)
    return failures


def warmup(plugin: str | tuple[str, ...] | list[str] | None = None) -> None:
    """Install the requested (or, when none given, the default) plugins into the current venv"""
    setup_process()
    validate_runtime(config)
    plugin_ids = _parse_plugin_ids(plugin)
    logger.info(f"warmup starting for plugins {[PluginCompositeId.to_str(e) for e in plugin_ids]}")

    asyncio.run(start_db_schema())
    start_artifact_provider()
    catalog_refresh = submit_refresh_catalog()
    initialize_stores(config.external.plugin_stores)
    catalog_refresh.result(timeout=CATALOG_TIMEOUT_SEC)

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
