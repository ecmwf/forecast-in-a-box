# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Seed data for built-in high-level presets.

Defines the core preset(s) that ship with Forecast-In-A-Box and provides an
idempotent ``seed_core_presets()`` coroutine that inserts them on first run.
Running ``seed_core_presets()`` a second time is a no-op: each preset is keyed
on a stable ``preset_id`` string and is skipped when that id already exists in
the database.

Preset IDs are intentionally stable slug-style strings (not UUIDs) so that
the frontend can reference them by name after the migration away from
hardcoded presets.

Plugin-specific presets (e.g. ECMWF presets) are seeded by their respective
plugins and are not defined here.
"""

from __future__ import annotations

import datetime as dt
import logging

from forecastbox.domain.blueprint.service import BlueprintBuilder
from forecastbox.domain.preset import db as preset_db
from forecastbox.domain.preset.models import HighLevelPreset, PresetDifficulty
from forecastbox.domain.preset.types import PresetId
from forecastbox.utility.auth import PASSTHROUGH_USER_ID, AuthContext

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

_SEED_AUTHOR = PASSTHROUGH_USER_ID
"""All seed presets are owned by the passthrough / system user."""

_SEED_AUTH = AuthContext(user_id=_SEED_AUTHOR, is_admin=True)


# ---------------------------------------------------------------------------
# Preset definitions
# ---------------------------------------------------------------------------


def _blank_canvas() -> HighLevelPreset:
    """Blank Canvas — advanced, custom.

    Ported from the ``custom-model`` frontend preset.  Returns an empty
    builder so the user can construct a pipeline from scratch in the Fable
    editor.
    """
    builder = BlueprintBuilder(blocks={})
    return HighLevelPreset(
        preset_id=PresetId("blank-canvas"),
        version=1,
        name="Blank Canvas",
        description="Start with an empty pipeline and build your own Fable from scratch.",
        long_description=(
            "Opens the Fable editor with no blocks pre-configured.  Drag sources, products, "
            "and sinks from the catalogue to compose a completely custom pipeline.  "
            "Recommended for advanced users who know exactly what they want to build."
        ),
        difficulty=PresetDifficulty.advanced,
        tags=["featured", "custom", "blank"],
        icon="Layers",
        builder_template=builder,
        parameters=[],
        is_published=True,
    )


# ---------------------------------------------------------------------------
# Ordered list of all core seed presets
# ---------------------------------------------------------------------------

SEED_PRESETS: list[HighLevelPreset] = [
    _blank_canvas(),
]
"""Core built-in presets in display order.

Plugin-specific presets are seeded separately by each plugin.
"""


# ---------------------------------------------------------------------------
# Public seeding coroutine
# ---------------------------------------------------------------------------


async def _insert_seed_preset(preset: HighLevelPreset) -> None:
    """Directly insert a single seed preset at version 1.

    This bypasses ``preset_db.create_preset`` to use a stable preset_id from
    the seed data rather than generating a new UUID. For seeding we always
    want to create a fresh row with a stable slug ID and version 1.
    """
    import forecastbox.schemata.jobs as _jobs_module
    from forecastbox.schemata.jobs import HighLevelPreset as HighLevelPresetRow

    ref_time = dt.datetime.now()
    row = HighLevelPresetRow(
        preset_id=preset.preset_id,
        version=1,
        name=preset.name,
        description=preset.description,
        long_description=preset.long_description,
        difficulty=preset.difficulty.value,
        tags=list(preset.tags),
        icon=preset.icon,
        builder_template=preset.builder_template.model_dump(mode="json"),
        parameters=[p.model_dump(mode="json") for p in preset.parameters],
        is_published=preset.is_published,
        created_by=_SEED_AUTHOR,
        created_at=ref_time,
        updated_at=ref_time,
        is_deleted=False,
    )
    async with _jobs_module.async_session_maker() as session:
        session.add(row)
        await session.commit()


async def seed_core_presets() -> None:
    """Insert all core seed presets that do not already exist in the database.

    This function is idempotent: it checks whether each preset's ``preset_id``
    already exists before attempting an insert, so running it multiple times
    (e.g. on every application start-up) is safe and will not create duplicate
    rows.

    Presets are inserted with ``is_published=True`` and owned by the system
    (passthrough) user.  The version stored in the database is always 1 for
    freshly seeded presets.

    Plugin-specific presets are seeded separately by each plugin.
    """
    for preset in SEED_PRESETS:
        existing = await preset_db.get_preset(preset.preset_id)
        if existing is not None:
            logger.debug("Seed preset %r already exists — skipping.", preset.preset_id)
            continue

        try:
            await _insert_seed_preset(preset)
            logger.info("Seeded preset %r (version 1).", preset.preset_id)
        except Exception:
            logger.exception("Failed to seed preset %r.", preset.preset_id)
            raise
