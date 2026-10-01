# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for BlockInstanceRich's typed configuration accessors, focused on trait integration."""

import pytest

from fiab_core.fable import BlockConfigurationOption, BlockFactoryId, BlockInstance, ConfigurationOptionId
from fiab_core.tools.blocks import BlockInstanceConfigurationError, BlockInstanceRich
from fiab_core.types import IntType, ListType
from fiab_core.types.traits import DivisibleBy, Positive


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


class TestConfigAsIntTraits:
    """Tests that config_as_int enforces the traits declared on the IntType."""

    def test_passes_when_trait_satisfied(self) -> None:
        rich = _rich_block(IntType(traits=Positive()), 5)
        assert rich.config_as_int("amount") == 5

    def test_raises_when_trait_violated(self) -> None:
        rich = _rich_block(IntType(traits=Positive()), -5)
        with pytest.raises(BlockInstanceConfigurationError, match="is not positive"):
            rich.config_as_int("amount")

    def test_raises_with_all_failing_traits_collected(self) -> None:
        rich = _rich_block(IntType(traits=[Positive(), DivisibleBy("3")]), -10)
        with pytest.raises(BlockInstanceConfigurationError) as exc_info:
            rich.config_as_int("amount")
        assert "is not positive" in str(exc_info.value)
        assert "is not divisible by 3" in str(exc_info.value)

    def test_no_traits_is_a_no_op(self) -> None:
        rich = _rich_block(IntType(), -5)
        assert rich.config_as_int("amount") == -5


class TestConfigAsListTraits:
    """Tests that config_as_list enforces the traits declared on the list's item type."""

    def test_passes_when_all_items_satisfy_trait(self) -> None:
        option_id = ConfigurationOptionId("amounts")
        options = {
            option_id: BlockConfigurationOption(
                title="Amounts",
                description="Some amounts",
                value_type=ListType(IntType(traits=Positive())),
            )
        }
        block = BlockInstance(configuration_values={option_id: [1, 2, 3]})
        rich = BlockInstanceRich.from_block(BlockFactoryId("TestFactory"), block, options)
        assert rich.config_as_list("amounts", int) == [1, 2, 3]

    def test_raises_when_an_item_violates_trait(self) -> None:
        option_id = ConfigurationOptionId("amounts")
        options = {
            option_id: BlockConfigurationOption(
                title="Amounts",
                description="Some amounts",
                value_type=ListType(IntType(traits=Positive())),
            )
        }
        block = BlockInstance(configuration_values={option_id: [1, -2, 3]})
        rich = BlockInstanceRich.from_block(BlockFactoryId("TestFactory"), block, options)
        with pytest.raises(BlockInstanceConfigurationError, match="is not positive"):
            rich.config_as_list("amounts", int)
