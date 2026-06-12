# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for the plugin_presets helper module.

All external collaborators (``presets_view`` from the PluginManager) are mocked
so these tests run without a real plugin installation or lock.

Covers:
- ``get_all_plugin_presets()`` returns presets from loaded plugins.
- ``get_all_plugin_presets()`` returns an empty list when no plugins are loaded.
- ``get_all_plugin_presets()`` returns an empty list when the lock cannot be acquired.
- ``find_plugin_preset()`` finds a preset by ID.
- ``find_plugin_preset()`` returns ``None`` for an unknown ID.
- ``convert_to_builder()`` produces a valid ``BlueprintBuilder``.
- ``convert_to_builder()`` does not mutate the original preset's blocks mapping.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fiab_core.fable import (
    BlockFactoryId,
    BlockInstance,
    BlockInstanceId,
    PluginBlockFactoryId,
    PluginCompositeId,
    PluginId,
    PluginStoreId,
)

import forecastbox.domain.preset.plugin_presets as plugin_presets_module
from forecastbox.domain.blueprint.service import BlueprintBuilder
from forecastbox.domain.preset.plugin_presets import (
    convert_to_builder,
    find_plugin_preset,
    get_all_plugin_presets,
)

# ---------------------------------------------------------------------------
# Patch target
# ---------------------------------------------------------------------------

_PRESETS_VIEW = "forecastbox.domain.preset.plugin_presets.presets_view"

# ---------------------------------------------------------------------------
# Helpers: build minimal PluginPresetDefinition objects without real plugins
# ---------------------------------------------------------------------------


def _make_preset(preset_id: str, name: str = "Test Preset") -> MagicMock:
    """Return a MagicMock that behaves like a PluginPresetDefinition.

    Using MagicMock avoids importing fiab_core internals (BlockInstance,
    PluginBlockFactoryId, etc.) that require a full plugin environment.
    The only attribute accessed by the module under test is ``preset_id``
    and ``blocks``.
    """
    mock = MagicMock()
    mock.preset_id = preset_id
    mock.name = name
    mock.blocks = {}
    return mock


_TEST_PLUGIN = PluginCompositeId(store=PluginStoreId("test"), local=PluginId("test"))


def _make_block(factory: str = "testFactory") -> BlockInstance:
    """Return a minimal real BlockInstance for tests that feed into BlueprintBuilder."""
    return BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=_TEST_PLUGIN, factory=BlockFactoryId(factory)),
        configuration_values={},
        input_ids={},
    )


# ---------------------------------------------------------------------------
# Tests: get_all_plugin_presets
# ---------------------------------------------------------------------------


def test_get_all_plugin_presets_returns_presets_from_loaded_plugins() -> None:
    """get_all_plugin_presets() flattens presets from all loaded plugins into one list."""
    preset_a = _make_preset("plugin-a-preset-1")
    preset_b = _make_preset("plugin-a-preset-2")
    preset_c = _make_preset("plugin-b-preset-1")

    plugin_id_1 = PluginCompositeId(store=PluginStoreId("store1"), local=PluginId("plugin1"))
    plugin_id_2 = PluginCompositeId(store=PluginStoreId("store2"), local=PluginId("plugin2"))

    # presets_view returns [(plugin_id, [presets]), ...]
    fake_view = [
        (plugin_id_1, [preset_a, preset_b]),
        (plugin_id_2, [preset_c]),
    ]

    with patch(_PRESETS_VIEW, return_value=fake_view):
        result = get_all_plugin_presets()

    assert len(result) == 3
    presets = [preset for _pid, preset in result]
    assert preset_a in presets
    assert preset_b in presets
    assert preset_c in presets


def test_get_all_plugin_presets_returns_empty_list_when_no_plugins_loaded() -> None:
    """get_all_plugin_presets() returns [] when presets_view yields an empty list."""
    with patch(_PRESETS_VIEW, return_value=[]):
        result = get_all_plugin_presets()

    assert result == []  # empty list of tuples


def test_get_all_plugin_presets_returns_empty_list_when_lock_not_acquired() -> None:
    """get_all_plugin_presets() returns [] and logs a warning when the lock times out.

    ``presets_view`` returns ``False`` when the PluginManager lock cannot be
    acquired within the timeout.
    """
    with patch(_PRESETS_VIEW, return_value=False):
        result = get_all_plugin_presets()

    assert result == []


def test_get_all_plugin_presets_preserves_plugin_order() -> None:
    """Presets are returned in plugin-iteration order, then in per-plugin order."""
    preset_1 = _make_preset("first")
    preset_2 = _make_preset("second")
    preset_3 = _make_preset("third")

    plugin_id_a = PluginCompositeId(store=PluginStoreId("s"), local=PluginId("a"))
    plugin_id_b = PluginCompositeId(store=PluginStoreId("s"), local=PluginId("b"))

    fake_view = [
        (plugin_id_a, [preset_1, preset_2]),
        (plugin_id_b, [preset_3]),
    ]

    with patch(_PRESETS_VIEW, return_value=fake_view):
        result = get_all_plugin_presets()

    # Each entry is a (plugin_id, preset) tuple; check preset order and plugin_id association.
    assert [(pid, p) for pid, p in result] == [
        (plugin_id_a, preset_1),
        (plugin_id_a, preset_2),
        (plugin_id_b, preset_3),
    ]


# ---------------------------------------------------------------------------
# Tests: find_plugin_preset
# ---------------------------------------------------------------------------


def test_find_plugin_preset_returns_matching_preset() -> None:
    """find_plugin_preset() returns (plugin_id, preset) for the first matching preset_id."""
    target = _make_preset("my-target-preset")
    other = _make_preset("other-preset")

    plugin_id = PluginCompositeId(store=PluginStoreId("s"), local=PluginId("p"))
    fake_view = [(plugin_id, [other, target])]

    with patch(_PRESETS_VIEW, return_value=fake_view):
        result = find_plugin_preset("my-target-preset")

    assert result is not None
    returned_pid, returned_preset = result
    assert returned_preset is target
    assert returned_pid == plugin_id


def test_find_plugin_preset_returns_none_for_unknown_id() -> None:
    """find_plugin_preset() returns None when no preset matches the given ID."""
    preset = _make_preset("known-preset")

    plugin_id = PluginCompositeId(store=PluginStoreId("s"), local=PluginId("p"))
    fake_view = [(plugin_id, [preset])]

    with patch(_PRESETS_VIEW, return_value=fake_view):
        result = find_plugin_preset("does-not-exist")

    assert result is None


def test_find_plugin_preset_returns_none_when_no_plugins_loaded() -> None:
    """find_plugin_preset() returns None when there are no loaded plugins."""
    with patch(_PRESETS_VIEW, return_value=[]):
        result = find_plugin_preset("any-id")

    assert result is None


def test_find_plugin_preset_returns_none_when_lock_not_acquired() -> None:
    """find_plugin_preset() returns None when presets_view returns False (lock timeout)."""
    with patch(_PRESETS_VIEW, return_value=False):
        result = find_plugin_preset("any-id")

    assert result is None


def test_find_plugin_preset_returns_first_match_across_plugins() -> None:
    """find_plugin_preset() returns the first match when the same ID appears in multiple plugins."""
    first_match = _make_preset("shared-id", name="First Plugin")
    second_match = _make_preset("shared-id", name="Second Plugin")

    plugin_id_1 = PluginCompositeId(store=PluginStoreId("s"), local=PluginId("first"))
    plugin_id_2 = PluginCompositeId(store=PluginStoreId("s"), local=PluginId("second"))

    fake_view = [
        (plugin_id_1, [first_match]),
        (plugin_id_2, [second_match]),
    ]

    with patch(_PRESETS_VIEW, return_value=fake_view):
        result = find_plugin_preset("shared-id")

    assert result is not None
    returned_pid, returned_preset = result
    assert returned_preset is first_match
    assert returned_pid == plugin_id_1


# ---------------------------------------------------------------------------
# Tests: convert_to_builder
# ---------------------------------------------------------------------------


def test_convert_to_builder_returns_blueprint_builder() -> None:
    """convert_to_builder() returns a BlueprintBuilder instance."""
    preset_def = _make_preset("my-preset")
    preset_def.blocks = {}

    result = convert_to_builder(preset_def)

    assert isinstance(result, BlueprintBuilder)


def test_convert_to_builder_populates_blocks_from_preset() -> None:
    """convert_to_builder() copies the preset's blocks into the builder."""
    block_a = _make_block("factoryA")
    block_b = _make_block("factoryB")
    preset_def = _make_preset("blocks-preset")
    preset_def.blocks = {"block-a": block_a, "block-b": block_b}

    result = convert_to_builder(preset_def)

    assert result.blocks == {"block-a": block_a, "block-b": block_b}


def test_convert_to_builder_does_not_mutate_original_blocks() -> None:
    """convert_to_builder() shallow-copies blocks so the original preset is not mutated."""
    block_x = _make_block("factoryX")
    original_blocks: dict = {"block-x": block_x}
    preset_def = _make_preset("immutable-preset")
    preset_def.blocks = original_blocks

    builder = convert_to_builder(preset_def)

    # Mutating the builder's blocks dict must not affect the preset's blocks.
    builder.blocks[BlockInstanceId("injected-key")] = _make_block("injected")

    assert "injected-key" not in preset_def.blocks
    assert preset_def.blocks is original_blocks


def test_convert_to_builder_empty_blocks_gives_empty_builder() -> None:
    """convert_to_builder() with an empty blocks dict produces a builder with no blocks."""
    preset_def = _make_preset("empty-preset")
    preset_def.blocks = {}

    result = convert_to_builder(preset_def)

    assert result.blocks == {}


def test_convert_to_builder_local_glyphs_default_empty() -> None:
    """convert_to_builder() produces a builder with empty local_glyphs by default."""
    preset_def = _make_preset("glyph-preset")
    preset_def.blocks = {}

    result = convert_to_builder(preset_def)

    assert result.local_glyphs == {}
