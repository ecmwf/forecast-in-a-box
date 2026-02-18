# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""API for Plugin Stores -- data parsing and extractions"""

import logging
import threading
import time

import httpx
import orjson
from cascade.low.func import assert_never
from pydantic import BaseModel
from typing_extensions import Self

from forecastbox.api.plugin.manager import submit_update_single
from forecastbox.api.types.fable import PluginCompositeId, PluginId
from forecastbox.config import PluginSettings, PluginStoreConfig, PluginStoreId, PluginStoresConfig, config, config_edit_lock
from forecastbox.ecpyutil import timed_acquire

logger = logging.getLogger(__name__)


class PluginStoreEntry(BaseModel):
    """Name of the package if assuming PyPI, or a local path, git repo, ... Anything that pip accepts"""

    pip_source: str
    """A string such that `importlib.import_module(module_name)` gives a module that has a `plugin` attribute of type fiab_core.plugin.Plugin`"""
    module_name: str
    """What the frontend should display in the plugins table"""
    display_title: str
    """What the frontend should display in this plugin's details"""
    display_description: str
    """What the frontend should display as the plugin's author"""
    display_author: str
    """Any comment or clarification to developers or maintainers. Not propagated to the frontend"""
    comment: str = ""


class PluginRemoteInfo(BaseModel):
    """Data from eg PyPI such as the most recent version"""

    version: str


def get_latest_version(package_name: str, client: httpx.Client) -> str:
    url = f"https://pypi.org/pypi/{package_name}/json"
    response = client.get(url)
    if response.status_code == 200:
        try:
            return response.json()["info"]["version"]
        except Exception:
            logger.exception(f"getting version of {package_name=} => failure {response=}")
    else:
        logger.exception(f"getting version of {package_name=} => failure {response=}")
    return "unknown"


class PluginStore(BaseModel):
    display_name: str
    plugins: dict[PluginId, PluginStoreEntry] = {}
    remote: dict[PluginId, PluginRemoteInfo] = {}

    @classmethod
    def fetch(cls, client: httpx.Client, plugin_store_config: PluginStoreConfig) -> Self:
        match plugin_store_config.method:
            case "file":
                response = client.get(plugin_store_config.url)
                response.raise_for_status()
                raw = response.content
                as_json = orjson.loads(raw)
                return cls(**as_json)
            case s:
                assert_never(s)

    def populate(self, client: httpx.Client) -> None:
        for pluginId, storeEntry in self.plugins.items():
            self.remote[pluginId] = PluginRemoteInfo(
                version=get_latest_version(storeEntry.pip_source, client),
            )


class StoresManager:
    stores: dict[PluginStoreId, PluginStore] = {}
    stores_lock: threading.Lock = threading.Lock()
    stores_updater: threading.Thread | None = None


def initialize_stores(plugin_stores_config: PluginStoresConfig) -> None:
    # assumed to be submitted from a thread
    with timed_acquire(StoresManager.stores_lock, 600) as result:
        # NOTE we lock for long because two concurrent updates make no sense
        if not result:
            raise ValueError("failed to acquire lock")
        with httpx.Client() as client:
            # a thread pool / async could work here but we dont expect many stores here
            stores = {key: PluginStore.fetch(client, value) for key, value in plugin_stores_config.items()}
            for store in stores.values():
                store.populate(client)
        StoresManager.stores = stores


def get_plugins_detail() -> dict[PluginCompositeId, tuple[PluginStoreEntry, PluginRemoteInfo]]:
    with timed_acquire(StoresManager.stores_lock, 5) as result:
        # NOTE we lock to prevent collection-changed-during-iteration error
        if not result:
            raise ValueError("failed to acquire lock")
        return {
            PluginCompositeId(store=storeId, local=pluginId): (
                store.plugins[pluginId],
                store.remote[pluginId],
            )
            for storeId, store in StoresManager.stores.items()
            for pluginId in store.plugins.keys()
        }


def submit_initialize_stores():
    with timed_acquire(StoresManager.stores_lock, 10) as result:
        if not result:
            logger.error("failed to initialize stores")
            return
        StoresManager.stores_updater = threading.Thread(target=initialize_stores, args=(config.product.plugin_stores,))
        StoresManager.stores_updater.start()


def submit_install_plugin(plugin_composite_key: PluginCompositeId) -> None:
    with timed_acquire(StoresManager.stores_lock, 10) as result:
        if not result:
            raise ValueError("failed to acquire lock")
        if not StoresManager.stores:
            raise ValueError("stores not initialized")
    storeId, pluginId = plugin_composite_key.store, plugin_composite_key.local
    store = StoresManager.stores.get(storeId, None)
    if store is None:
        raise ValueError(f"store with id {storeId} not known")
    pluginStoreEntry = store.plugins.get(pluginId, None)
    if pluginStoreEntry is None:
        raise ValueError(f"plugin with id {pluginId} not known to store {storeId}")

    if plugin_composite_key not in config.product.plugins:
        with timed_acquire(config_edit_lock, 5) as result:
            if not result:
                raise ValueError("failed to acquire the shared lock")
            config.product.plugins[plugin_composite_key] = PluginSettings(
                pip_source=pluginStoreEntry.pip_source,
                module_name=pluginStoreEntry.module_name,
                update_strategy="manual",
            )
            config.save_to_file()

    submit_update_single(plugin_composite_key, isUpdate=True)


def join_stores_thread(timeout_sec: int) -> None:
    # TODO candidate for ecpyutil, duplicated in plugin.manager
    barrier = (time.perf_counter_ns() / 1e9) + timeout_sec
    with timed_acquire(StoresManager.stores_lock, timeout_sec) as result:
        if not result:
            logger.error("failed to lock for joining updater thread")
        else:
            if StoresManager.stores_updater is not None:
                budget = barrier - (time.perf_counter_ns() / 1e9)
                StoresManager.stores_updater.join(budget)
                if StoresManager.stores_updater.is_alive():
                    logger.error("failed to join StoresManager updater thread")
