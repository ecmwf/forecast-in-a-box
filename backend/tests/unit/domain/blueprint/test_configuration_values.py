from typing import Any

import pytest
from fiab_core.fable import (
    BlockConfigurationOption,
    BlockFactory,
    BlockFactoryId,
    BlockInstance,
    ConfigurationOptionId,
    PluginBlockFactoryId,
    PluginCompositeId,
)

from forecastbox.domain.blueprint.configuration_values import ConfigurationConversionError, convert_known_configuration_values

AMOUNT = ConfigurationOptionId("amount")
TEXT = ConfigurationOptionId("text")


def _make_block(config: dict[ConfigurationOptionId, Any]) -> BlockInstance:
    return BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("local:test"), factory=BlockFactoryId("transform_increment")),
        configuration_values=config,
        input_ids={},
    )


def _make_factory() -> BlockFactory:
    return BlockFactory(
        kind="transform",
        title="Increment",
        description="Adds amount",
        configuration_options={
            AMOUNT: BlockConfigurationOption(title="", description="", value_type="int"),
            TEXT: BlockConfigurationOption(title="", description="", value_type="str"),
        },
        inputs=["a"],
    )


def test_convert_known_configuration_values_converts_declared_options() -> None:
    block = _make_block({AMOUNT: "7", TEXT: "hello", ConfigurationOptionId("extra"): "ignored"})
    factory = _make_factory()

    convert_known_configuration_values(block, factory)

    assert block.configuration_values[AMOUNT] == 7
    assert block.configuration_values[TEXT] == "hello"
    assert block.configuration_values[ConfigurationOptionId("extra")] == "ignored"


def test_convert_known_configuration_values_keeps_original_values_on_failure() -> None:
    block = _make_block({AMOUNT: "not_int", TEXT: "hello"})
    factory = _make_factory()

    with pytest.raises(ConfigurationConversionError, match="expected int"):
        convert_known_configuration_values(block, factory)

    assert block.configuration_values[AMOUNT] == "not_int"
    assert block.configuration_values[TEXT] == "hello"
