# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import abc
from datetime import date, datetime
from typing import Literal, TypeVar

from cascade.low.func import Either
from earthkit.workflows.fluent import Action
from pydantic import PrivateAttr
from typing_extensions import Self

from fiab_core.fable import (
    ActionLookup,
    BlockConfigurationOption,
    BlockFactory,
    BlockInstance,
    BlockInstanceId,
    BlockInstanceOutput,
    BlockKind,
    ConfigurationOptionId,
    ConfigurationOptionRestriction,
    QubedOutput,
)
from fiab_core.plugin import Error
from fiab_core.types import ClosedEnumType, DatetimeType, DateType, FloatType, IntType, ListType, OpenEnumType, StringType


class BlockInstanceConfigurationError(ValueError):
    """Raised when a typed configuration accessor cannot satisfy the request."""


T = TypeVar("T")


class BlockInstanceRich(BlockInstance):
    _configuration_options: dict[ConfigurationOptionId, BlockConfigurationOption] = PrivateAttr(default_factory=dict)

    @classmethod
    def from_block(
        cls,
        block: BlockInstance,
        configuration_options: dict[ConfigurationOptionId, BlockConfigurationOption],
    ) -> Self:
        rich = cls.model_validate(block.model_dump(mode="python"))
        rich._configuration_options = configuration_options
        return rich

    def _get_configuration_option(self, key: str | ConfigurationOptionId) -> tuple[ConfigurationOptionId, BlockConfigurationOption]:
        option_id = ConfigurationOptionId(key)
        option = self._configuration_options.get(option_id)
        if option is None:
            raise BlockInstanceConfigurationError(
                f"Configuration option {option_id!r} is not declared for block factory {self.factory_id.factory!r}"
            )
        return option_id, option

    def _get_raw_value(self, option_id: ConfigurationOptionId) -> object:
        if option_id in self.configuration_values:
            return self.configuration_values[option_id]
        raise BlockInstanceConfigurationError(
            f"Configuration option {option_id!r} is missing for block factory {self.factory_id.factory!r}"
        )

    def config_as_str(self, key: str | ConfigurationOptionId) -> str:
        option_id, option = self._get_configuration_option(key)
        if not isinstance(option.parsed_value_type, (StringType, ClosedEnumType, OpenEnumType)):
            raise BlockInstanceConfigurationError(f"Configuration option {option_id!r} has type {option.value_type!r}, not str")
        raw_value = self._get_raw_value(option_id)
        if isinstance(raw_value, str):
            return raw_value
        raise BlockInstanceConfigurationError(f"Configuration option {option_id!r} expected str, got {type(raw_value).__name__}")

    def config_as_int(self, key: str | ConfigurationOptionId, *, sign: Literal["positive", "negative", "any"] = "any") -> int:
        option_id, option = self._get_configuration_option(key)
        if not isinstance(option.parsed_value_type, IntType):
            raise BlockInstanceConfigurationError(f"Configuration option {option_id!r} has type {option.value_type!r}, not int")
        raw_value = self._get_raw_value(option_id)
        if type(raw_value) is int:
            if sign == "positive" and raw_value <= 0:
                raise BlockInstanceConfigurationError(f"Configuration option {option_id!r} expected positive int, got {raw_value}")
            if sign == "negative" and raw_value >= 0:
                raise BlockInstanceConfigurationError(f"Configuration option {option_id!r} expected negative int, got {raw_value}")
            return raw_value
        raise BlockInstanceConfigurationError(f"Configuration option {option_id!r} expected int, got {type(raw_value).__name__}")

    def config_as_float(self, key: str | ConfigurationOptionId, *, sign: Literal["positive", "negative", "any"] = "any") -> float:
        option_id, option = self._get_configuration_option(key)
        if not isinstance(option.parsed_value_type, FloatType):
            raise BlockInstanceConfigurationError(f"Configuration option {option_id!r} has type {option.value_type!r}, not float")
        raw_value = self._get_raw_value(option_id)
        if type(raw_value) is float:
            if sign == "positive" and raw_value <= 0:
                raise BlockInstanceConfigurationError(f"Configuration option {option_id!r} expected positive float, got {raw_value}")
            if sign == "negative" and raw_value >= 0:
                raise BlockInstanceConfigurationError(f"Configuration option {option_id!r} expected negative float, got {raw_value}")
            return raw_value
        raise BlockInstanceConfigurationError(f"Configuration option {option_id!r} expected float, got {type(raw_value).__name__}")

    def config_as_date(self, key: str | ConfigurationOptionId) -> date:
        option_id, option = self._get_configuration_option(key)
        if not isinstance(option.parsed_value_type, DateType):
            raise BlockInstanceConfigurationError(f"Configuration option {option_id!r} has type {option.value_type!r}, not date")
        raw_value = self._get_raw_value(option_id)
        if type(raw_value) is date:
            return raw_value
        raise BlockInstanceConfigurationError(f"Configuration option {option_id!r} expected date, got {type(raw_value).__name__}")

    def config_as_datetime(self, key: str | ConfigurationOptionId) -> datetime:
        option_id, option = self._get_configuration_option(key)
        if not isinstance(option.parsed_value_type, DatetimeType):
            raise BlockInstanceConfigurationError(f"Configuration option {option_id!r} has type {option.value_type!r}, not datetime")
        raw_value = self._get_raw_value(option_id)
        if type(raw_value) is datetime:
            return raw_value
        raise BlockInstanceConfigurationError(f"Configuration option {option_id!r} expected datetime, got {type(raw_value).__name__}")

    def config_as_list(
        self,
        key: str | ConfigurationOptionId,
        item_type: type[T],
        *,
        allow_empty: bool = True,
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
        return raw_value


class QubedBlockBuilder(abc.ABC):
    kind: BlockKind
    title: str
    description: str
    configuration_options: dict[ConfigurationOptionId, BlockConfigurationOption]
    inputs: list[str]

    def validate(self, block: BlockInstance, inputs: dict[str, QubedOutput]) -> Either[BlockInstanceOutput, Error]:  # type:ignore[invalid-argument] # semigroup
        raise NotImplementedError

    def compile(
        self,
        inputs: ActionLookup,
        block_id: BlockInstanceId,
        block: BlockInstance,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        raise NotImplementedError

    def intersect(self, other: QubedOutput) -> bool:
        raise NotImplementedError

    def restrictions(self, other: QubedOutput) -> ConfigurationOptionRestriction:
        return {}

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
