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
from fiab_core.types.definitions import ClosedEnumType, FableType, GridType, IntType, OpenEnumType
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


def _grid_block(value_type: FableType, value: object) -> BlockInstanceRich:
    option_id = ConfigurationOptionId("grid")
    options = {option_id: BlockConfigurationOption(title="Grid", description="A grid", value_type=value_type)}
    return BlockInstanceRich.from_block(BlockFactoryId("TestFactory"), BlockInstance(configuration_values={option_id: value}), options)


class TestConfigAsGrid:
    """config_as_grid accepts GridType and an open enum of grids, and returns the converted value."""

    GRID_ENUM = OpenEnumType(["auto", "0.25", "O96"], GridType())

    @pytest.mark.parametrize("value_type", [GridType(), GRID_ENUM])
    @pytest.mark.parametrize(
        ("text", "expected"),
        [("auto", None), ("0.25", 0.25), ("0.1", 0.1), ("0.25/0.5", [0.25, 0.5]), ("O96", "O96"), ("n320", "N320")],
    )
    def test_returns_the_converted_value(self, value_type: FableType, text: str, expected: object) -> None:
        converted = value_type.validate_convert(text)

        assert _grid_block(value_type, converted).config_as_grid("grid") == expected

    def test_auto_means_no_grid_change_for_the_open_enum(self) -> None:
        assert _grid_block(self.GRID_ENUM, self.GRID_ENUM.validate_convert("auto")).config_as_grid("grid") is None

    @pytest.mark.parametrize(
        "value_type",
        [OpenEnumType(["a", "b"]), ClosedEnumType(["auto", "0.25"], GridType()), OpenEnumType(["1", "2"], IntType()), IntType()],
    )
    def test_rejects_other_types(self, value_type: FableType) -> None:
        with pytest.raises(BlockInstanceConfigurationError, match="not GridType"):
            _grid_block(value_type, None).config_as_grid("grid")

    def test_rejects_bool(self) -> None:
        with pytest.raises(BlockInstanceConfigurationError, match="got bool"):
            _grid_block(GridType(), True).config_as_grid("grid")
