# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""API for Plugin Stores -- data parsing and extractions"""

import httpx
import orjson
from cascade.low.func import assert_never
from pydantic import BaseModel
from typing_extensions import Self

from forecastbox.api.ecpyutil import timed_acquire
from forecastbox.api.types.fable import PluginId
from forecastbox.config import PluginStoreConfig, PluginStoreId, PluginStoresConfig, config, config_edit_lock


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
    comment: str


class PluginStore(BaseModel):
    display_name: str
    plugins: dict[PluginId, PluginStoreEntry]

    @classmethod
    async def fetch(cls, client: httpx.AsyncClient, plugin_store_config: PluginStoreConfig) -> Self:
        match plugin_store_config.method:
            case "file":
                response = await client.get(plugin_store_config.url)
                response.raise_for_status()
                raw = response.content
                as_json = orjson.loads(raw)
                return cls(**as_json)
            case s:
                assert_never(s)


class Globals:
    stores: dict[PluginStoreId, PluginStore]

    @classmethod
    async def initialize(cls, plugin_stores_config: PluginStoresConfig) -> None:
        async with httpx.AsyncClient() as client:
            cls.stores = {key: await PluginStore.fetch(client, value) for key, value in plugin_stores_config.items()}


def install_plugin(plugin_store_id: PluginStoreId, plugin_id: PluginId) -> None:
    # TODO if installed, return
    with timed_acquire(config_edit_lock, 5) as result:
        # TODO invoke install
        if not result:
            raise ValueError("failed to acquire the shared lock")
        config.save_to_file()
    # TODO invoke the update?


"""
taskList
    [inprog] rekey plugins everywhere to be store+id_
    install single -- lock<add to config, persist config>, then submit update
        the current method assumes installed -- replace
    uninstall single -- lock<remove from config, persist config>, then implement new function in the plugin manager
    toggleEnabled single -- extend config with enabled/disabled, plugin manager lock + pop/load
    get plugins
        we need plugin dynamic metadata class
        we need plugin dynamic metadata filling from pypi
        we need plugin dynamic metadata filling from local + join with the plugin manager
        then reroute the plugin status from manager to here (perhaps keep that one as updater status)
        and implement forceRefresh... -- sorta managed thread like in manager
"""
