# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

from typing import Any

from cascade.low.func import Either
from fiab_core.fable import BlockFactory, BlockInstance, ConfigurationOptionId
from fiab_core.types import WrongType


def convert_known_configuration_values(
    block_instance: BlockInstance, block_factory: BlockFactory
) -> Either[dict[ConfigurationOptionId, Any], list[str]]:  # type:ignore[invalid-type-arguments] # semigroup
    """Validate and convert known block configuration values against the factory declaration."""
    converted = dict(block_instance.configuration_values)
    errors: list[str] = []
    for option_id, option in block_factory.configuration_options.items():
        if option_id not in block_instance.configuration_values:
            continue
        raw_value = block_instance.configuration_values[option_id]
        try:
            converted[option_id] = option.value_type.validate_convert(raw_value)
        except (TypeError, WrongType) as exc:
            errors.append(f"Invalid value for configuration option {option_id!r}: expected {option.value_type.serialize()}. {exc}")
    if errors:
        return Either.error(errors)
    return Either.ok(converted)
