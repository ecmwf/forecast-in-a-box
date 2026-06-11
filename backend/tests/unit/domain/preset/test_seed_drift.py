# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Guards built-in seed presets against block-schema drift.

Each seed preset hardcodes ``configuration_values`` for every block.  When a
plugin renames, adds, or removes a ``configuration_options`` key on a block
factory (e.g. ``ensemble_members`` → ``number``, or new ``groupby`` / ``splitby``
keys on ``mapPlotSink``), the preset silently fails validation only when a user
opens it.  This test makes that loud at build time.

Ported from the previous frontend ``presets.test.ts`` drift guard, now that
presets are seeded server-side instead of hardcoded in TypeScript.
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
def test_seed_preset_block_configs_match_factory_schema(preset: HighLevelPreset) -> None:
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
