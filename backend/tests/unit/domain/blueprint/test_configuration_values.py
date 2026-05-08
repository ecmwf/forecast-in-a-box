from typing import Any

from fiab_core.fable import (
    BlockConfigurationOption,
    BlockFactory,
    BlockFactoryId,
    BlockInstance,
    ConfigurationOptionId,
    PluginBlockFactoryId,
    PluginCompositeId,
)

from forecastbox.domain.blueprint.configuration_values import convert_known_configuration_values

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

    converted = convert_known_configuration_values(block, factory)

    assert converted.t is not None
    assert converted.t[AMOUNT] == 7
    assert converted.t[TEXT] == "hello"
    assert converted.t[ConfigurationOptionId("extra")] == "ignored"


def test_convert_known_configuration_values_keeps_original_values_on_failure() -> None:
    block = _make_block({AMOUNT: "not_int", TEXT: "hello"})
    factory = _make_factory()

    converted = convert_known_configuration_values(block, factory)
    assert converted.e is not None
    assert any("expected int" in err for err in converted.e)

    assert block.configuration_values[AMOUNT] == "not_int"
    assert block.configuration_values[TEXT] == "hello"
