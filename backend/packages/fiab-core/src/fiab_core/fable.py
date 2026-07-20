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
from typing import Annotated, Any, Literal, NewType

from earthkit.workflows.fluent import Action
from pydantic import BeforeValidator, ConfigDict, Field, PlainSerializer, WithJsonSchema, model_validator
from qubed import Qube
from typing_extensions import Self

from fiab_core.pydantic_utils import FiabCoreBaseModel
from fiab_core.types import FableType, NotFableType, parse

Error = str
"""Compiler/validator error message type alias."""


def _parse_fable_type(value: str | FableType) -> FableType:
    if isinstance(value, FableType):
        return value
    if not isinstance(value, str):
        raise ValueError(f"Expected a Fable type expression string, got {type(value).__name__}")
    try:
        parsed, remainder = parse(value)
        if remainder.strip():
            raise NotFableType(f"Unexpected trailing content in type expression: {remainder!r}")
    except NotFableType as exc:
        raise ValueError(str(exc)) from exc
    setattr(parsed, "_fable_type_expression", value)
    return parsed


def _serialize_fable_type(value: FableType) -> str:
    original_expression = getattr(value, "_fable_type_expression", None)
    if isinstance(original_expression, str):
        return original_expression
    return value.serialize()


FableTypeField = Annotated[
    FableType,
    BeforeValidator(_parse_fable_type),
    PlainSerializer(_serialize_fable_type, return_type=str),
    WithJsonSchema({"type": "string"}),
]


class BlockConfigurationOption(FiabCoreBaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    title: str
    """Brief string to display in the BlockFactory detail"""
    description: str
    """Extended description, possibly with example values and their effect"""
    value_type: FableTypeField
    """Type used when deserializing the actual value; serialized as an expression for clients"""
    default_value: str | None = None
    """Used by the frontend to inject the default value"""
    is_advanced: bool = False
    """Used by the frontend to optionally hide the setting unless advanced. Do not set if no default provided / None not valid"""


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
    # TODO separate the backend class to have a str type there
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


def is_textual(mime_type: str) -> bool:
    # we check the starts with because of encoding, extension, etc
    return mime_type.startswith("text/plain")


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


class BlueprintTemplateExampleInput(FiabCoreBaseModel):
    """Regular blueprints have local glyphs and configuration options,
    which in the latter case have a type and a description. In blueprint
    templates, we allow for adding type and description to glyphs and
    overriding those for configuration options.

    These do *not* affect the blueprint persistence and execution. It only
    plays a role in the user interface, when using the template as high-level
    ready-to-go Job Preset, and when communicating the intent behind the
    template.

    The motivation for this is that in blueprints, the local glyphs
    plays purely a role of variable *value*, whereas in templates, the
    meaning shifts towards variable *definition*.

    If the display_* or type_hint are not given here, the consumer of this
    is assumed to take them from the underlying configuration option, or,
    in the glyph case, assume no data."""

    example_value: str
    display_name: str | None = None
    display_description: str | None = None
    type_hint: str | None = None

    @model_validator(mode="after")
    def _validate_type_hint(self) -> Self:
        if self.type_hint is not None:
            try:
                _, remainder = parse(self.type_hint)
                if remainder.strip():
                    raise NotFableType(f"Unexpected trailing content in type expression: {remainder!r}")
            except NotFableType as exc:
                raise ValueError(str(exc)) from exc
        return self


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
    example_values: dict[BlockInstanceId, dict[ConfigurationOptionId, BlueprintTemplateExampleInput]] = Field(default_factory=dict)
    example_glyphs: dict[str, BlueprintTemplateExampleInput] = Field(default_factory=dict)
