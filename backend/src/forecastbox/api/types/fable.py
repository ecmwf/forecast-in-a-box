# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""
Types pertaining to Forecast As BLock Expression (Fable): builders and top-level API
"""

from dataclasses import dataclass

from fiab_core.fable import BlockFactoryId, BlockInstance, BlockInstanceId, PluginBlockFactoryId, PluginCompositeId, PluginId, PluginStoreId
from pydantic import BaseModel

from forecastbox.api.types.jobs import EnvironmentSpecification


class FableBuilderV1(BaseModel):
    blocks: dict[BlockInstanceId, BlockInstance]
    environment: EnvironmentSpecification | None = None


class FableValidationExpansion(BaseModel):
    """When user submits invalid FableBuilderV1, backend returns a structured validation result and completion options"""

    global_errors: list[str]
    block_errors: dict[BlockInstanceId, list[str]]
    possible_sources: list[PluginBlockFactoryId]
    possible_expansions: dict[BlockInstanceId, list[PluginBlockFactoryId]]


class FableSaveV2Request(BaseModel):
    """Payload for saving a fable builder via the v2 persistence path."""

    builder: FableBuilderV1
    display_name: str | None = None
    display_description: str | None = None
    tags: list[str] = []
    parent_id: str | None = None


class FableSaveV2Response(BaseModel):
    """Returned by upsert_v2; contains the stable id and the new version number."""

    id: str
    version: int


class FableRetrieveV2Response(BaseModel):
    """Full payload returned by retrieve_v2."""

    id: str
    version: int
    builder: FableBuilderV1
    display_name: str | None = None
    display_description: str | None = None
    tags: list[str] = []
    parent_id: str | None = None


class FableCompileV2Request(BaseModel):
    """Reference to a saved JobDefinition for compile_v2."""

    id: str
    version: int | None = None
