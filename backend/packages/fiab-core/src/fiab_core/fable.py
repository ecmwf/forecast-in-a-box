# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""
Types pertaining to Forecast As BLock Expression (Fable): blocks
"""

from typing import Literal

from earthkit.workflows.fluent import Action
from pydantic import BaseModel, ConfigDict
from typing_extensions import Self


class BlockConfigurationOption(BaseModel):
    title: str
    """Brief string to display in the BlockFactory detail"""
    description: str
    """Extended description, possibly with example values and their effect"""
    value_type: str
    """Will be used when deserializing the actual value"""
    # TODO do we want Literal instead of str for values? Do we prefer nesting or flattening for complex config?


BlockKind = Literal["source", "transform", "product", "sink"]


class BlockFactory(BaseModel):
    """When building a fable, user selects from an available catalogue of BlockFactories which
    have description of what they do and specification of configuration options they offer"""

    kind: BlockKind
    """Which role in a job does this block plays"""
    title: str
    """How to display in the catalogue listing / partial fable"""
    description: str
    """Extended detail for the user"""
    configuration_options: dict[str, BlockConfigurationOption]
    """A key-value of config-option-key, config-option"""
    inputs: list[str]
    """A list of input names, such as 'initial conditions' or 'forecast', for the purpose of description/configuration"""


BlockFactoryId = str
BlockInstanceId = str
PluginId = str
PluginStoreId = str


class PluginCompositeId(BaseModel):
    model_config = ConfigDict(frozen=True)
    store: PluginStoreId
    local: PluginId

    @classmethod
    def from_str(cls, v) -> "PluginCompositeId":
        if not ":" in v:
            raise ValueError("must be of the form store:local")
        store, local = v.split(":", 1)
        return cls(store=store, local=local)

    @staticmethod
    def to_str(k: Self) -> str:
        return f"{k.store}:{k.local}"


class PluginBlockFactoryId(BaseModel):
    """Note to plugin authors: This is a routing class. When you implement your BlockFactories for the catalogue,
    you dont use this, you only need to declare a BlockFactoryId unique inside your plugin. Similarly, when you
    return which BlockFactories are possible in the expand method, you only return your BlockFactoryIds. This
    appears only when you receive BlockInstances in the compile/validate -- and again, you just need to use the
    BlockFactoryId part of this class, as the PluginCompositeId is guaranteed to correspond to your plugin"""

    plugin: PluginCompositeId
    factory: BlockFactoryId


class BlockFactoryCatalogue(BaseModel):
    factories: dict[BlockFactoryId, BlockFactory]


class BlockInstance(BaseModel):
    """As produced by BlockFactory *by the client* -- basically the configuration/inputs values"""

    factory_id: PluginBlockFactoryId
    configuration_values: dict[str, str]
    """Keys come frome factory's `configuration_options`, values are serialized actual configuration values"""
    input_ids: dict[str, BlockInstanceId]
    """Keys come from factory's `inputs`, values are other blocks in the (partial) fable"""


class XarrayOutput(BaseModel):  # NOTE eventually Qubed
    variables: list[str]
    coords: list[str]


BlockInstanceOutput = XarrayOutput  # NOTE eventually a Union

# NOTE placeholder, this will be replaced with Fluent
DataPartitionLookup = dict[BlockInstanceId, Action]
