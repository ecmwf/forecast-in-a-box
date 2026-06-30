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
    BlueprintTemplateEnvironment,
    ConfigurationOptionId,
    PluginBlockFactoryId,
    PluginCompositeId,
    PluginId,
    PluginStoreId,
    SelfPluginId,
)

from forecastbox.domain.blueprint.service import BlueprintBuilder, remap_builder_glyphs, template_to_builder

_REAL_PLUGIN_ID = PluginCompositeId(store=PluginStoreId("myStore"), local=PluginId("myPlugin"))
_BLOCK_A = BlockInstanceId("blockA")
_BLOCK_B = BlockInstanceId("blockB")
_OPT = ConfigurationOptionId("text")


def _self_block(text: str = "hello") -> BlockInstance:
    return BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=SelfPluginId, factory=BlockFactoryId("source_text")),
        configuration_values={_OPT: text},
        input_ids={},
    )


def _real_block(text: str = "hello") -> BlockInstance:
    return BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=_REAL_PLUGIN_ID, factory=BlockFactoryId("source_text")),
        configuration_values={_OPT: text},
        input_ids={},
    )


def test_template_to_builder_replaces_self_plugin_id() -> None:
    """SelfPluginId sentinels in block factory IDs are replaced with the real plugin ID."""
    template = BlueprintTemplate(
        display_name="t",
        display_description="d",
        blocks={_BLOCK_A: _self_block()},
    )
    builder = template_to_builder(template, _REAL_PLUGIN_ID)
    assert builder.blocks[_BLOCK_A].factory_id.plugin == _REAL_PLUGIN_ID


def test_template_to_builder_keeps_real_plugin_id() -> None:
    """A block already using the real plugin ID is not modified."""
    template = BlueprintTemplate(
        display_name="t",
        display_description="d",
        blocks={_BLOCK_A: _real_block()},
    )
    builder = template_to_builder(template, _REAL_PLUGIN_ID)
    assert builder.blocks[_BLOCK_A].factory_id.plugin == _REAL_PLUGIN_ID


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
    block = BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=SelfPluginId, factory=BlockFactoryId("source_text")),
        configuration_values={},
        input_ids={},
    )
    template = BlueprintTemplate(
        display_name="t",
        display_description="d",
        blocks={example_block: block},
        example_values={example_block: {opt: "example text"}},
        example_glyphs={"name": "world"},
    )
    builder = template_to_builder(template, _REAL_PLUGIN_ID)
    assert opt not in builder.blocks[example_block].configuration_values


# ---------------------------------------------------------------------------
# remap_builder_glyphs
# ---------------------------------------------------------------------------


def test_remap_builder_glyphs_renames_config_value_and_local_glyph() -> None:
    """Block config values, local-glyph values, and local-glyph keys are all renamed."""
    builder = BlueprintBuilder(
        blocks={
            _BLOCK_A: BlockInstance(
                factory_id=PluginBlockFactoryId(plugin=_REAL_PLUGIN_ID, factory=BlockFactoryId("source_text")),
                configuration_values={_OPT: "${oldGlyph}"},
                input_ids={},
            )
        },
        local_glyphs={"localOld": "${oldGlyph}"},
    )
    mapping = {"oldGlyph": "newGlyph", "localOld": "localNew"}
    remapped = remap_builder_glyphs(builder, mapping)

    assert remapped.blocks[_BLOCK_A].configuration_values[_OPT] == "${newGlyph}"
    assert "localNew" in remapped.local_glyphs
    assert remapped.local_glyphs["localNew"] == "${newGlyph}"
    assert "localOld" not in remapped.local_glyphs


def test_remap_builder_glyphs_empty_mapping_returns_same_object() -> None:
    builder = BlueprintBuilder(
        blocks={
            _BLOCK_A: BlockInstance(
                factory_id=PluginBlockFactoryId(plugin=_REAL_PLUGIN_ID, factory=BlockFactoryId("source_text")),
                configuration_values={_OPT: "${oldGlyph}"},
                input_ids={},
            )
        },
        local_glyphs={"myKey": "myVal"},
    )
    result = remap_builder_glyphs(builder, {})
    assert result is builder
