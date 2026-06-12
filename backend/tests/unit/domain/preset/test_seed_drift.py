# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Guards built-in core seed presets against block-schema drift.

Each core seed preset hardcodes ``configuration_values`` for every block.  When
a plugin renames, adds, or removes a ``configuration_options`` key on a block
factory (e.g. ``ensemble_members`` → ``number``, or new ``groupby`` / ``splitby``
keys on ``mapPlotSink``), the preset silently fails validation only when a user
opens it.  This test makes that loud at build time.

Ported from the previous frontend ``presets.test.ts`` drift guard, now that
presets are seeded server-side instead of hardcoded in TypeScript.

Note: ``SEED_PRESETS`` now contains only the core built-in presets (currently
just ``blank-canvas``).  Plugin-specific presets (e.g. ECMWF presets) are
contributed by their respective plugins and are tested via
``test_plugin_presets.py``.  The ``blank-canvas`` preset has no blocks, so the
loop below is a no-op for it; the parametrize still guards that the list itself
is importable and iterable without error.
"""

from __future__ import annotations

import pytest
from fiab_plugin_ecmwf import blocks as ecmwf_plugin_blocks

from forecastbox.domain.preset.models import HighLevelPreset
from forecastbox.domain.preset.seed import SEED_PRESETS

_ECMWF_PLUGIN_KEY = ("ecmwf", "ecmwf-base")


def _expected_keys(factory_id: str) -> set[str]:
    """Live ``configuration_options`` keys for an ECMWF-plugin block factory."""
    builder = ecmwf_plugin_blocks[factory_id]  # type: ignore[index]
    return {str(k) for k in builder.configuration_options.keys()}


@pytest.mark.parametrize("preset", SEED_PRESETS, ids=lambda p: p.preset_id)
def test_seed_core_preset_block_configs_match_factory_schema(preset: HighLevelPreset) -> None:
    """Each block in a core seed preset must match its factory's configuration schema.

    For presets with no blocks (e.g. ``blank-canvas``) this test passes trivially.
    Plugin-contributed presets with blocks are covered by ``test_plugin_presets.py``.
    """
    for block_id, block in preset.builder_template.blocks.items():
        plugin = block.factory_id.plugin
        plugin_key = (str(plugin.store), str(plugin.local))
        assert plugin_key == _ECMWF_PLUGIN_KEY, (
            f"preset {preset.preset_id!r} block {block_id!r} references unexpected plugin {plugin_key!r}; extend this test to cover it"
        )

        factory = str(block.factory_id.factory)
        assert factory in ecmwf_plugin_blocks, f"unknown factory {factory!r} in preset {preset.preset_id!r} block {block_id!r}"

        actual = {str(k) for k in block.configuration_values.keys()}
        expected = _expected_keys(factory)
        assert actual == expected, (
            f"preset {preset.preset_id!r} block {block_id!r} ({factory}) "
            f"config keys drifted from the factory schema: "
            f"missing={expected - actual}, extra={actual - expected}"
        )


def test_seed_presets_contains_blank_canvas() -> None:
    """``SEED_PRESETS`` must always contain the ``blank-canvas`` core preset."""
    ids = [p.preset_id for p in SEED_PRESETS]
    assert "blank-canvas" in ids, f"blank-canvas missing from SEED_PRESETS; found: {ids}"


def test_seed_presets_all_have_required_fields() -> None:
    """Every entry in ``SEED_PRESETS`` must have non-empty name, description, and preset_id."""
    for preset in SEED_PRESETS:
        assert preset.preset_id, f"preset has empty preset_id: {preset!r}"
        assert preset.name, f"preset {preset.preset_id!r} has empty name"
        assert preset.description, f"preset {preset.preset_id!r} has empty description"
