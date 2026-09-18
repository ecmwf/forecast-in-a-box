# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""API for Plugin Stores -- data retrieval and extractions.

Owns a lock-protected state StoresManager which reflects what the configured
stores actually offer as plugins."""

import logging
import threading
from functools import partial

import httpx
import orjson
from cascade.low.func import assert_never
from fiab_core.fable import PluginCompositeId, PluginId
from packaging.version import Version
from pydantic import Field
from pyrsistent import pmap
from pyrsistent.typing import PMap
from typing_extensions import Self

from forecastbox.domain.plugin.compatibility import get_compatible_versions
from forecastbox.domain.plugin.settings import PluginSettings
from forecastbox.domain.plugin.submit import submit_update_single
from forecastbox.utility.concurrency.manager import ConcurrentPools, TaskName, execution_manager
from forecastbox.utility.concurrency.synchronization import timed_acquire
from forecastbox.utility.config import PluginStoreConfig, PluginStoreId, PluginStoresConfig, config
from forecastbox.utility.httpx import fetch_content
from forecastbox.utility.packages import get_package_versions
from forecastbox.utility.pydantic import FiabBaseModel

logger = logging.getLogger(__name__)


class PluginStoreEntry(FiabBaseModel):
    pip_source: str
    """Name of the package if assuming PyPI, or a local path, git repo, ... Anything that pip accepts"""
    module_name: str
    """A string such that `importlib.import_module(module_name)` gives a module that has a `plugin` attribute of type fiab_core.plugin.Plugin`"""
    display_title: str
    """What the frontend should display in the plugins table"""
    display_description: str
    """What the frontend should display in this plugin's details"""
    display_author: str
    """What the frontend should display as the plugin's author"""
    comment: str = ""
    """Any comment or clarification to developers or maintainers. Not propagated to the frontend"""


class PluginRemoteInfo(FiabBaseModel):
    """Data from eg PyPI such as the most recent version"""

    version: str


def get_latest_version(package_name: str, client: httpx.Client) -> str:
    try:
        available = get_package_versions(package_name, client)
        compatible = get_compatible_versions(package_name, available)
        return max(compatible, key=lambda v: Version(v))
    except Exception as e:
        logger.error(f"getting version of {package_name=} => failure {e!r}")
        return "unknown"


class PluginStore(FiabBaseModel):
    display_name: str
    plugins: dict[PluginId, PluginStoreEntry] = Field(default_factory=dict)
    remote: dict[PluginId, PluginRemoteInfo] = Field(default_factory=dict)


def fetch_store(client: httpx.Client, plugin_store_config: PluginStoreConfig) -> PluginStore:
    url = plugin_store_config.url
    match plugin_store_config.method:
        case "file":
            raw = fetch_content(url, client)
            as_json = orjson.loads(raw)
            return PluginStore(**as_json)
        case "localSingle":
            fname = url.rsplit("/", 1)[1]
            return PluginStore(
                display_name=f"local:{fname}",
                plugins={
                    PluginId("single"): PluginStoreEntry(
                        pip_source=url,
                        module_name=fname.replace("-", "_"),
                        display_title=fname,
                        display_description="",
                        display_author="local",
                        comment="",
                    )
                },
            )
        case s:
            assert_never(s)


def populate_store(store: PluginStore, client: httpx.Client) -> None:
    for pluginId, storeEntry in store.plugins.items():
        store.remote[pluginId] = PluginRemoteInfo(
            version=get_latest_version(storeEntry.pip_source, client),
        )


class StoresManager:
    stores: PMap[PluginStoreId, PluginStore] | None = None
    """None until `initialize_stores` has completed at least once. Distinguishes 'not initialized
    yet' from 'initialized, but happens to have no stores configured' (an empty PMap)."""
    stores_lock: threading.Lock = threading.Lock()


def stores_ready() -> bool:
    """Whether the stores have finished their (asynchronous, submitted-at-startup) initialization.

    Callers such as `resolve_plugin_from_store` rely on `StoresManager.stores` being populated;
    right after process startup this may not be the case yet, so this helper lets HTTP callers
    (see `forecastbox.routes.status`) report readiness instead of failing with a 500."""
    return StoresManager.stores is not None


def initialize_stores(plugin_stores_config: PluginStoresConfig) -> None:
    # assumed to be submitted through ConcurrentPools.Io
    with httpx.Client() as client:
        # a thread pool / async could work here but we dont expect many stores here
        stores = {key: fetch_store(client, value) for key, value in plugin_stores_config.items()}
        for store in stores.values():
            populate_store(store, client)
    with timed_acquire(StoresManager.stores_lock, 600) as result:
        if not result:
            raise ValueError("failed to acquire lock")
        StoresManager.stores = pmap(stores)


def get_plugins_detail() -> dict[PluginCompositeId, tuple[PluginStoreEntry, PluginRemoteInfo]]:
    # No lock needed for reads with pyrsistent immutable structures
    return {
        PluginCompositeId(store=storeId, local=pluginId): (
            store.plugins[pluginId],
            store.remote[pluginId],
        )
        for storeId, store in (StoresManager.stores or pmap()).items()
        for pluginId in store.plugins.keys()
    }


def submit_initialize_stores() -> None:
    """Submit store initialization as a monitored task on the shared ``Io`` pool.

    Fire-and-forget: an unexpected exception is recorded by the execution manager's
    monitored-failure history. Callers continue to see an empty store map (via
    ``get_plugins_detail``/``StoresManager.stores``) until a successful publication
    replaces it -- a partial store map is never published.
    """

    # NOTE No need to protect from concurrent runs -- http fetches are safe, and
    # the last operation which mutates the global state is lock protected, and we
    # are ok with last one winning.
    execution_manager.submit_monitored(
        ConcurrentPools.Io,
        TaskName("plugin.stores.initialize"),
        partial(initialize_stores, config.external.plugin_stores),
    )


def resolve_plugin_from_store(plugin_composite_key: PluginCompositeId) -> PluginSettings:
    """Retrieves the plugin information from the store and returns the settings to install it
    with. Synchronous and self-contained -- performs no pip operation and no persistence,
    that is the caller's job (see ``domain.plugin.loading.update_single``, which persists the
    returned settings into the plugin_state database table upon a successful install)."""
    # No lock needed for reads with pyrsistent immutable structures
    if StoresManager is None:
        raise ValueError("stores not initialized")
    storeId, pluginId = plugin_composite_key.store, plugin_composite_key.local
    store = StoresManager.stores.get(storeId, None)
    if store is None:
        raise ValueError(f"store with id {storeId} not known")
    pluginStoreEntry = store.plugins.get(pluginId, None)
    if pluginStoreEntry is None:
        raise ValueError(f"plugin with id {pluginId} not known to store {storeId}")

    return PluginSettings(
        pip_source=pluginStoreEntry.pip_source,
        module_name=pluginStoreEntry.module_name,
        update_strategy="manual",
    )


async def submit_install_single(plugin_composite_key: PluginCompositeId) -> None:
    """Retrieves the information from the store, then submits the actual pip operation via
    `plugins.submit`"""
    settings = resolve_plugin_from_store(plugin_composite_key)
    await submit_update_single(plugin_composite_key, install=True, version=None, settings=settings)
