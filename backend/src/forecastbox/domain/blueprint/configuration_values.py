# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

from dataclasses import dataclass

from fiab_core.fable import BlockFactory, BlockInstance, ConfigurationOptionId
from fiab_core.types import WrongType


@dataclass(frozen=True, eq=True, slots=True)
class ConfigurationConversionError(ValueError):
    option_id: ConfigurationOptionId
    expected_type: str
    cause: str

    def __str__(self) -> str:
        return f"Invalid value for configuration option {self.option_id!r}: expected {self.expected_type}. {self.cause}"


def convert_known_configuration_values(block_instance: BlockInstance, block_factory: BlockFactory) -> None:
    """Validate and convert known block configuration values against the factory declaration."""
    converted = dict(block_instance.configuration_values)
    for option_id, option in block_factory.configuration_options.items():
        if option_id not in block_instance.configuration_values:
            continue
        raw_value = block_instance.configuration_values[option_id]
        try:
            converted[option_id] = option.parsed_value_type.validate_convert(raw_value)
        except (TypeError, WrongType) as exc:
            raise ConfigurationConversionError(
                option_id=option_id,
                expected_type=option.value_type,
                cause=str(exc),
            ) from exc
    block_instance.configuration_values = converted
