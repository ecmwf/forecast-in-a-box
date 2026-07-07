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

import abc
from typing import Any, Literal, NewType

from earthkit.workflows.fluent import Action
from pydantic import ConfigDict, Field, PrivateAttr, model_validator
from qubed import Qube
from typing_extensions import Self

from fiab_core.pydantic_utils import FiabCoreBaseModel
from fiab_core.types import FableType, NotFableType

Error = str
"""Compiler/validator error message type alias."""


class BlockConfigurationOption(FiabCoreBaseModel):
    title: str
    """Brief string to display in the BlockFactory detail"""
    description: str
    """Extended description, possibly with example values and their effect"""
    value_type: str
    """Will be used when deserializing the actual value"""
    # TODO do we want Literal instead of str for values? Probably `str` since this will need to be parsed anyway
    # TODO do we prefer nesting or flattening for complex config? Ideally we support both, its just about the type system
    default_value: str | None = None
    """Used by the frontend to inject the default value"""
    is_advanced: bool = False
    """Used by the frontend to optionally hide the setting unless advanced. Do not set if no default provided / None not valid"""

    _value_type: FableType = PrivateAttr()

    @model_validator(mode="after")
    def _validate_and_cache_value_type(self) -> Self:
        try:
            parsed, remainder = FableType.parse(self.value_type)
            if remainder.strip():
                raise NotFableType(f"Unexpected trailing content in type expression: {remainder!r}")
            self._value_type = parsed
        except NotFableType as exc:
            raise ValueError(str(exc)) from exc
        return self

    @property
    def parsed_value_type(self) -> FableType:
        return self._value_type


ConfigurationOptionId = NewType("ConfigurationOptionId", str)


BlockKind = Literal["source", "transform", "product", "sink"]


class BlockFactory(FiabCoreBaseModel):
    """When building a fable, user selects from an available catalogue of BlockFactories which
    have description of what they do and specification of configuration options they offer"""

    kind: BlockKind
    """Which role in a job does this block plays"""
    title: str
    """How to display in the catalogue listing / partial fable"""
    description: str
    """Extended detail for the user"""
    configuration_options: dict[ConfigurationOptionId, BlockConfigurationOption]
    """A key-value of config-option-key, config-option"""
    inputs: list[str]
    """A list of input names, such as 'initial conditions' or 'forecast', for the purpose of description/configuration"""


BlockFactoryId = NewType("BlockFactoryId", str)
BlockInstanceId = NewType("BlockInstanceId", str)
PluginId = NewType("PluginId", str)
PluginStoreId = NewType("PluginStoreId", str)


class PluginCompositeId(FiabCoreBaseModel):
    model_config = ConfigDict(frozen=True)
    store: PluginStoreId
    local: PluginId

    @classmethod
    def from_str(cls, v: str) -> Self:
        if ":" not in v:
            raise ValueError("must be of the form store:local")
        store, local = v.split(":", 1)
        return cls(store=PluginStoreId(store), local=PluginId(local))

    @staticmethod
    def to_str(k: "PluginCompositeId") -> str:
        return f"{k.store}:{k.local}"


class BlockFactoryCatalogue(FiabCoreBaseModel):
    factories: dict[BlockFactoryId, BlockFactory]


ConfigurationOptionRestriction = dict[ConfigurationOptionId, FableType]
"""Mapping from configuration option id to its FableType restriction"""


class BlockExpansion(FiabCoreBaseModel):
    """Expansion of a block with potential restrictions on configuration options.

    Plugin expanders return BlockExpansion objects describing which blocks can
    expand the output of a given block, and what configuration restrictions apply
    to those expansions.
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    factory: BlockFactoryId
    """The local factory id within the plugin"""
    restrictions: ConfigurationOptionRestriction = Field(default_factory=dict)
    """Restrictions on configuration options for this expansion"""


class BlockInstance(FiabCoreBaseModel):
    """Configuration values and input wiring, as specified by a client when building a Fable."""

    configuration_values: dict[ConfigurationOptionId, Any]
    """Keys come from factory's `configuration_options`, values are either str-serialized (frontend2backend) or deserialized (backend2plugin)"""
    input_ids: dict[str, BlockInstanceId] = Field(default_factory=dict)
    """Keys come from factory's `inputs`, values are other blocks in the (partial) fable"""


class QubedOutput(FiabCoreBaseModel):
    model_config = ConfigDict(frozen=True, arbitrary_types_allowed=True)  # otherwise Qube cannot be here
    dataqube: Qube = Field(default_factory=Qube.empty)
    datatype: str = Field(default="")
    metadata: dict[str, Any] = Field(default_factory=dict)


class RawOutput(FiabCoreBaseModel):
    # use for final outputs that are not expected to be expanded by blocks except for
    # some general purpose like 'dump to file'. If a browser could be capable of directly
    # processing, ie, its a known media object, set the mime_type
    type_fqn: str = "typing.Any"
    mime_type: str = "application/octet-stream"


class NoOutput(FiabCoreBaseModel):
    # use this when there is no output whatsoever -- this stops *any* expansion of the block
    pass


BlockInstanceOutput = QubedOutput | RawOutput | NoOutput

ActionLookup = dict[BlockInstanceId, Action]


class BlueprintTemplateEnvironment(FiabCoreBaseModel):
    environment_variables: dict[str, str] = Field(default_factory=dict)


class BlueprintTemplateBlock(FiabCoreBaseModel):
    """A routing-equipped wrapper around a BlockInstance"""

    factory_id: BlockFactoryId
    instance: BlockInstance


class BlueprintTemplate(FiabCoreBaseModel):
    """A partial, ready-to-customise blueprint shipped by a plugin.

    Exposes the public subset of a blueprint builder plus separate guiding
    example values/glyphs the user is expected to override. `display_name` is the
    stable key used by the backend for upsert and exclusion; it must be unique
    within a plugin.
    """

    display_name: str
    display_description: str
    blocks: dict[BlockInstanceId, BlueprintTemplateBlock]
    environment: BlueprintTemplateEnvironment | None = None
    local_glyphs: dict[str, str] = Field(default_factory=dict)
    example_values: dict[BlockInstanceId, dict[ConfigurationOptionId, str]] = Field(default_factory=dict)
    example_glyphs: dict[str, str] = Field(default_factory=dict)
