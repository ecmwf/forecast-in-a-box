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


class FableBuilderV1(BaseModel):
    blocks: dict[BlockInstanceId, BlockInstance]


class FableValidationExpansion(BaseModel):
    """When user submits invalid FableBuilderV1, backend returns a structured validation result and completion options"""

    global_errors: list[str]
    block_errors: dict[BlockInstanceId, list[str]]
    possible_sources: list[PluginBlockFactoryId]
    possible_expansions: dict[BlockInstanceId, list[PluginBlockFactoryId]]
