# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import abc
from dataclasses import dataclass, field, replace
from datetime import date, datetime
from typing import Any, Callable, Literal, TypeVar, cast

from cascade.low.func import Either
from earthkit.workflows.fluent import Action

from fiab_core.fable import (
    ActionLookup,
    BlockConfigurationOption,
    BlockFactory,
    BlockFactoryId,
    BlockInstance,
    BlockInstanceId,
    BlockInstanceOutput,
    BlockKind,
    ConfigurationOptionId,
    ConfigurationOptionRestriction,
    Error,
    QubedOutput,
)
from fiab_core.types import ClosedEnumType, DatetimeType, DateType, FloatType, IntType, ListType, OpenEnumType, StringType


class BlockInstanceConfigurationError(ValueError):
    """Raised when a typed configuration accessor cannot satisfy the request."""


T = TypeVar("T")


@dataclass(frozen=True)
class BlockInstanceRich:
    """Wraps a BlockInstance with typed configuration accessors and the factory context needed for error messages.

    Plugin authors receive this in validate/compile callbacks instead of the raw BlockInstance.
    All field reads go through typed methods (config_as_str, config_as_int, ...) or the input_ids property.
    """

    factory_id: BlockFactoryId
    block: BlockInstance
    configuration_options: dict[ConfigurationOptionId, BlockConfigurationOption] = field(default_factory=dict)

    @classmethod
    def from_block(
        cls,
        factory_id: BlockFactoryId,
        block: BlockInstance,
        configuration_options: dict[ConfigurationOptionId, BlockConfigurationOption],
    ) -> "BlockInstanceRich":
        return cls(factory_id=factory_id, block=block, configuration_options=configuration_options)

    @property
    def input_ids(self) -> dict[str, BlockInstanceId]:
        """The input slot names mapped to the upstream block instance ids."""
        return self.block.input_ids

    def with_configuration_values(self, values: dict[ConfigurationOptionId, object]) -> "BlockInstanceRich":
        """Return a copy with the given configuration_values replacing the block's current ones."""
        return replace(self, block=self.block.model_copy(update={"configuration_values": values}))

    def _get_configuration_option(self, key: str | ConfigurationOptionId) -> tuple[ConfigurationOptionId, BlockConfigurationOption]:
        option_id = ConfigurationOptionId(key)
        option = self.configuration_options.get(option_id)
        if option is None:
            raise BlockInstanceConfigurationError(
                f"Configuration option {option_id!r} is not declared for block factory {self.factory_id!r}"
            )
        return option_id, option

    def _get_raw_value(self, option_id: ConfigurationOptionId) -> object:
        if option_id in self.block.configuration_values:
            return self.block.configuration_values[option_id]
        raise BlockInstanceConfigurationError(f"Configuration option {option_id!r} is missing for block factory {self.factory_id!r}")

    def config_as_str(self, key: str | ConfigurationOptionId, *, validator: Callable[[str, str], None] | None = None) -> str:
        option_id, option = self._get_configuration_option(key)
        if not isinstance(option.parsed_value_type, (StringType, ClosedEnumType, OpenEnumType)):
            raise BlockInstanceConfigurationError(f"Configuration option {option_id!r} has type {option.value_type!r}, not str")
        raw_value = self._get_raw_value(option_id)
        if isinstance(raw_value, str):
            if validator is not None:
                validator(raw_value, option_id)
            return raw_value
        raise BlockInstanceConfigurationError(f"Configuration option {option_id!r} expected str, got {type(raw_value).__name__}")

    def config_as_int(self, key: str | ConfigurationOptionId, *, validator: Callable[[int, str], None] | None = None) -> int:
        option_id, option = self._get_configuration_option(key)
        if not isinstance(option.parsed_value_type, IntType):
            raise BlockInstanceConfigurationError(f"Configuration option {option_id!r} has type {option.value_type!r}, not int")
        raw_value = self._get_raw_value(option_id)
        if type(raw_value) is int:
            if validator is not None:
                validator(raw_value, option_id)
            return raw_value
        raise BlockInstanceConfigurationError(f"Configuration option {option_id!r} expected int, got {type(raw_value).__name__}")

    def config_as_float(self, key: str | ConfigurationOptionId, *, validator: Callable[[float, str], None] | None = None) -> float:
        option_id, option = self._get_configuration_option(key)
        if not isinstance(option.parsed_value_type, FloatType):
            raise BlockInstanceConfigurationError(f"Configuration option {option_id!r} has type {option.value_type!r}, not float")
        raw_value = self._get_raw_value(option_id)
        if type(raw_value) is float:
            if validator is not None:
                validator(raw_value, option_id)
            return raw_value
        raise BlockInstanceConfigurationError(f"Configuration option {option_id!r} expected float, got {type(raw_value).__name__}")

    def config_as_date(self, key: str | ConfigurationOptionId, *, validator: Callable[[date, str], None] | None = None) -> date:
        option_id, option = self._get_configuration_option(key)
        if not isinstance(option.parsed_value_type, DateType):
            raise BlockInstanceConfigurationError(f"Configuration option {option_id!r} has type {option.value_type!r}, not date")
        raw_value = self._get_raw_value(option_id)
        if type(raw_value) is date:
            if validator is not None:
                validator(raw_value, option_id)
            return raw_value
        raise BlockInstanceConfigurationError(f"Configuration option {option_id!r} expected date, got {type(raw_value).__name__}")

    def config_as_datetime(self, key: str | ConfigurationOptionId, *, validator: Callable[[datetime, str], None] | None = None) -> datetime:
        option_id, option = self._get_configuration_option(key)
        if not isinstance(option.parsed_value_type, DatetimeType):
            raise BlockInstanceConfigurationError(f"Configuration option {option_id!r} has type {option.value_type!r}, not datetime")
        raw_value = self._get_raw_value(option_id)
        if type(raw_value) is datetime:
            if validator is not None:
                validator(raw_value, option_id)
            return raw_value
        raise BlockInstanceConfigurationError(f"Configuration option {option_id!r} expected datetime, got {type(raw_value).__name__}")

    def config_as_list(
        self,
        key: str | ConfigurationOptionId,
        item_type: type[T],
        *,
        allow_empty: bool = True,
        validator: Callable[[T, str], None] | None = None,
    ) -> list[T]:
        option_id, option = self._get_configuration_option(key)
        if not isinstance(option.parsed_value_type, ListType):
            raise BlockInstanceConfigurationError(
                f"Configuration option {option_id!r} has type {option.value_type!r}, not list[{item_type.__name__}]"
            )
        raw_value = self._get_raw_value(option_id)
        if not isinstance(raw_value, list):
            raise BlockInstanceConfigurationError(
                f"Configuration option {option_id!r} expected list[{item_type.__name__}], got {type(raw_value).__name__}"
            )
        if not raw_value and not allow_empty:
            raise BlockInstanceConfigurationError(f"Configuration option {option_id!r} cannot be empty")
        expected_item_types = {
            str: (StringType, ClosedEnumType, OpenEnumType),
            int: (IntType,),
            float: (FloatType,),
            date: (DateType,),
            datetime: (DatetimeType,),
        }.get(item_type)
        if expected_item_types is None:
            raise BlockInstanceConfigurationError(f"Unsupported list item type {item_type!r}")
        if not isinstance(option.parsed_value_type.item_type, expected_item_types):
            raise BlockInstanceConfigurationError(
                f"Configuration option {option_id!r} has type {option.value_type!r}, not list[{item_type.__name__}]"
            )
        if any(type(item) is not item_type for item in raw_value):
            raise BlockInstanceConfigurationError(
                f"Configuration option {option_id!r} expected list[{item_type.__name__}], got {[type(item).__name__ for item in raw_value]!r}"
            )
        typed_raw_value = cast(list[T], raw_value)
        if validator is not None:
            for item in typed_raw_value:
                validator(item, option_id)
        return typed_raw_value

    def config_as_geodomain(self, key: str | ConfigurationOptionId) -> str | list[int] | list[str]:
        # NOTE validators hard here due to being such a large union...
        option_id, option = self._get_configuration_option(key)
        raw_value = self._get_raw_value(option_id)
        return raw_value  # ty: ignore[invalid-return-type] # we have nothing to add on top of validator


class QubedBlockBuilder(abc.ABC):
    kind: BlockKind
    title: str
    description: str
    configuration_options: dict[ConfigurationOptionId, BlockConfigurationOption]
    inputs: list[str]

    def validate(
        self, block: BlockInstanceRich, inputs: dict[str, QubedOutput], restrictions: ConfigurationOptionRestriction
    ) -> BlockInstanceOutput:
        raise NotImplementedError

    def compile(
        self,
        inputs: ActionLookup,
        block: "BlockInstanceRich",
    ) -> Either[Action, Error]:  # ty:ignore[invalid-type-arguments] # semigroup
        raise NotImplementedError

    def intersect(self, other: QubedOutput) -> bool:
        raise NotImplementedError

    def as_catalogue(self) -> BlockFactory:
        return BlockFactory(
            kind=self.kind,
            title=self.title,
            description=self.description,
            configuration_options=self.configuration_options,
            inputs=self.inputs,
        )


class Source(QubedBlockBuilder):
    kind: BlockKind = "source"

    def intersect(self, other: QubedOutput) -> bool:
        return False


class Product(QubedBlockBuilder):
    kind: BlockKind = "product"


class Sink(QubedBlockBuilder):
    kind: BlockKind = "sink"


class Transform(QubedBlockBuilder):
    kind: BlockKind = "transform"
