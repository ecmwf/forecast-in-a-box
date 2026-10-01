# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for BlockInstanceRich's typed configuration accessors.

Traits are enforced by FableType.validate_convert, which plugin authors are expected to have
already run (directly, or via a higher level helper) before building a BlockInstanceRich. The
config_as_* accessors themselves only check the raw value's Python type against the declared
FableType, they do not re-run trait validation.
"""

import pytest

from fiab_core.fable import BlockConfigurationOption, BlockFactoryId, BlockInstance, ConfigurationOptionId
from fiab_core.tools.blocks import BlockInstanceConfigurationError, BlockInstanceRich
from fiab_core.types import WrongType
from fiab_core.types.definitions import IntType
from fiab_core.types.traits import Positive


def _rich_block(value_type: IntType, value: object) -> BlockInstanceRich:
    option_id = ConfigurationOptionId("amount")
    options = {
        option_id: BlockConfigurationOption(
            title="Amount",
            description="An amount",
            value_type=value_type,
        )
    }
    block = BlockInstance(configuration_values={option_id: value})
    return BlockInstanceRich.from_block(BlockFactoryId("TestFactory"), block, options)


class TestConfigAsInt:
    """Tests for config_as_int."""

    def test_returns_matching_value(self) -> None:
        rich = _rich_block(IntType(), 5)
        assert rich.config_as_int("amount") == 5

    def test_raises_on_type_mismatch(self) -> None:
        rich = _rich_block(IntType(), "5")
        with pytest.raises(BlockInstanceConfigurationError, match="expected int"):
            rich.config_as_int("amount")

    def test_does_not_re_validate_traits(self) -> None:
        """Values must already have passed through FableType.validate_convert (and hence trait
        validation) by the time they reach config_as_int; it does not repeat that check."""
        rich = _rich_block(IntType(traits=Positive()), -5)
        assert rich.config_as_int("amount") == -5


class TestConfigAsIntFullPipeline:
    """Tests illustrating the full, expected pipeline: traits are enforced at validate_convert time."""

    def test_validate_convert_rejects_before_config_as_int_is_ever_called(self) -> None:
        value_type = IntType(traits=Positive())
        with pytest.raises(WrongType, match="is not positive"):
            value_type.validate_convert("-5")

    def test_validate_convert_accepts_then_config_as_int_returns_it(self) -> None:
        value_type = IntType(traits=Positive())
        converted = value_type.validate_convert("5")
        rich = _rich_block(value_type, converted)
        assert rich.config_as_int("amount") == 5
