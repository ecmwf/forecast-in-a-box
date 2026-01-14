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

from forecastbox.config import PluginStoreConfig, PluginStoreId, PluginStoresConfig, config


class PluginStoreEntry(BaseModel):
    pip_source: str
    module_name: str
    display_title: str
    display_description: str
    display_author: str


PluginId = str


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
