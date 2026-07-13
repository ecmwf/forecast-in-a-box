# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for blueprint service helpers."""

from fiab_core.fable import (
    BlockFactory,
    BlockFactoryId,
    BlockInstance,
    BlockInstanceId,
    BlueprintTemplate,
    BlueprintTemplateBlock,
    BlueprintTemplateEnvironment,
    BlueprintTemplateExampleInput,
    ConfigurationOptionId,
    PluginCompositeId,
    PluginId,
    PluginStoreId,
)

from forecastbox.domain.blueprint.service import (
    BlueprintBuilder,
    RoutableBlock,
    remap_builder_glyphs,
    resolve_builder_with_examples,
    template_to_builder,
)

_REAL_PLUGIN_ID = PluginCompositeId(store=PluginStoreId("myStore"), local=PluginId("myPlugin"))
_BLOCK_A = BlockInstanceId("blockA")
_BLOCK_B = BlockInstanceId("blockB")
_OPT = ConfigurationOptionId("text")


def _template_block(text: str = "hello") -> BlueprintTemplateBlock:
    return BlueprintTemplateBlock(
        factory_id=BlockFactoryId("source_text"),
        instance=BlockInstance(configuration_values={_OPT: text}, input_ids={}),
    )


def _routable_block(block_id: BlockInstanceId = _BLOCK_A, text: str = "hello") -> RoutableBlock:
    return RoutableBlock(
        instance_id=block_id,
        plugin=_REAL_PLUGIN_ID,
        factory=BlockFactoryId("source_text"),
        instance=BlockInstance(configuration_values={_OPT: text}, input_ids={}),
    )


def test_template_to_builder_assigns_plugin_id() -> None:
    """Template local factory ids are combined with the given plugin id."""
    template = BlueprintTemplate(
        display_name="t",
        display_description="d",
        blocks={_BLOCK_A: _template_block()},
    )
    builder = template_to_builder(template, _REAL_PLUGIN_ID)
    block = next(b for b in builder.blocks if b.instance_id == _BLOCK_A)
    assert block.plugin == _REAL_PLUGIN_ID
    assert block.factory == BlockFactoryId("source_text")


def test_template_to_builder_propagates_env_vars() -> None:
    """environment_variables from the template are copied into the builder environment."""
    template = BlueprintTemplate(
        display_name="t",
        display_description="d",
        blocks={},
        environment=BlueprintTemplateEnvironment(environment_variables={"MY_VAR": "42"}),
    )
    builder = template_to_builder(template, _REAL_PLUGIN_ID)
    assert builder.environment is not None
    assert builder.environment.environment_variables == {"MY_VAR": "42"}
    # Other EnvironmentSpecification fields default to None / empty.
    assert builder.environment.hosts is None
    assert builder.environment.workers_per_host is None
    assert builder.environment.runtime_artifacts == []


def test_template_to_builder_no_environment() -> None:
    """When template.environment is None, builder.environment is None."""
    template = BlueprintTemplate(
        display_name="t",
        display_description="d",
        blocks={},
        environment=None,
    )
    builder = template_to_builder(template, _REAL_PLUGIN_ID)
    assert builder.environment is None


def test_template_to_builder_preserves_local_glyphs() -> None:
    """local_glyphs are copied verbatim."""
    template = BlueprintTemplate(
        display_name="t",
        display_description="d",
        blocks={},
        local_glyphs={"greeting": "hello"},
    )
    builder = template_to_builder(template, _REAL_PLUGIN_ID)
    assert builder.local_glyphs == {"greeting": "hello"}


def test_template_to_builder_example_values_not_in_configuration_values() -> None:
    """example_values must not appear in any block's configuration_values."""
    example_block = BlockInstanceId("example_block")
    opt = ConfigurationOptionId("text")
    block = BlueprintTemplateBlock(
        factory_id=BlockFactoryId("source_text"),
        instance=BlockInstance(configuration_values={}, input_ids={}),
    )
    template = BlueprintTemplate(
        display_name="t",
        display_description="d",
        blocks={example_block: block},
        example_values={example_block: {opt: BlueprintTemplateExampleInput(example_value="example text")}},
        example_glyphs={"name": BlueprintTemplateExampleInput(example_value="world")},
    )
    builder = template_to_builder(template, _REAL_PLUGIN_ID)
    result = next(b for b in builder.blocks if b.instance_id == example_block)
    assert opt not in result.instance.configuration_values


# ---------------------------------------------------------------------------
# remap_builder_glyphs
# ---------------------------------------------------------------------------


def test_remap_builder_glyphs_renames_config_value_and_local_glyph() -> None:
    """Block config values, local-glyph values, and local-glyph keys are all renamed."""
    builder = BlueprintBuilder(
        blocks=[_routable_block(text="${oldGlyph}")],
        local_glyphs={"localOld": "${oldGlyph}"},
    )
    mapping = {"oldGlyph": "newGlyph", "localOld": "localNew"}
    remapped = remap_builder_glyphs(builder, mapping)

    assert remapped.blocks[0].instance.configuration_values[_OPT] == "${newGlyph}"
    assert "localNew" in remapped.local_glyphs
    assert remapped.local_glyphs["localNew"] == "${newGlyph}"
    assert "localOld" not in remapped.local_glyphs


def test_remap_builder_glyphs_empty_mapping_returns_same_object() -> None:
    builder = BlueprintBuilder(
        blocks=[_routable_block(text="${oldGlyph}")],
        local_glyphs={"myKey": "myVal"},
    )
    result = remap_builder_glyphs(builder, {})
    assert result is builder


# ---------------------------------------------------------------------------
# resolve_builder_with_examples
# ---------------------------------------------------------------------------


def _make_builder(block_text: str | None = None, local_glyphs: dict[str, str] | None = None) -> BlueprintBuilder:
    return BlueprintBuilder(
        blocks=[
            RoutableBlock(
                instance_id=_BLOCK_A,
                plugin=_REAL_PLUGIN_ID,
                factory=BlockFactoryId("source_text"),
                instance=BlockInstance(
                    configuration_values={_OPT: block_text} if block_text is not None else {},
                    input_ids={},
                ),
            )
        ],
        local_glyphs=local_glyphs or {},
    )


def _get_block(builder: BlueprintBuilder, block_id: BlockInstanceId) -> RoutableBlock:
    return next(b for b in builder.blocks if b.instance_id == block_id)


def test_resolve_builder_with_examples_fills_missing_config_value() -> None:
    """Example values fill in config options absent from the template block."""
    builder = _make_builder(block_text=None)
    result = resolve_builder_with_examples(builder, {_BLOCK_A: {_OPT: BlueprintTemplateExampleInput(example_value="from example")}}, {})
    assert _get_block(result, _BLOCK_A).instance.configuration_values[_OPT] == "from example"


def test_resolve_builder_with_examples_overrides_existing_config_value() -> None:
    """Example values override existing template values for validation purposes."""
    builder = _make_builder(block_text="template value")
    result = resolve_builder_with_examples(builder, {_BLOCK_A: {_OPT: BlueprintTemplateExampleInput(example_value="example value")}}, {})
    assert _get_block(result, _BLOCK_A).instance.configuration_values[_OPT] == "example value"


def test_resolve_builder_with_examples_does_not_mutate_original() -> None:
    """resolve_builder_with_examples must not mutate the caller's builder."""
    builder = _make_builder(block_text="original")
    original_config = dict(_get_block(builder, _BLOCK_A).instance.configuration_values)
    resolve_builder_with_examples(builder, {_BLOCK_A: {_OPT: BlueprintTemplateExampleInput(example_value="override")}}, {})
    assert _get_block(builder, _BLOCK_A).instance.configuration_values == original_config
