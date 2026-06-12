# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Helper utilities for looking up and converting plugin-defined presets.

Plugin presets are in-memory workflow templates exposed by loaded plugins via
``Plugin.presets``.  Unlike DB-backed presets they are never persisted; they
live only as long as the plugin is loaded.

This module centralises the three operations that both the preset routes and
the preset service need:

- :func:`get_all_plugin_presets` — collect every preset from every loaded plugin.
- :func:`find_plugin_preset` — look up a single preset by its ``preset_id``.
- :func:`convert_to_builder` — turn a :class:`~fiab_core.presets.PluginPresetDefinition`
  into a :class:`~forecastbox.domain.blueprint.service.BlueprintBuilder` ready
  for validation or instantiation.
"""

import logging
from typing import cast

from fiab_core.fable import PluginCompositeId
from fiab_core.presets import PluginPresetDefinition

from forecastbox.domain.blueprint.service import BlueprintBuilder
from forecastbox.domain.plugin.manager import presets_view

logger = logging.getLogger(__name__)


def get_all_plugin_presets() -> list[tuple[PluginCompositeId, PluginPresetDefinition]]:
    """Return every preset with its owning plugin ID.

    Uses :func:`~forecastbox.domain.plugin.manager.presets_view` for
    lock-safe access to the shared plugin map.  If the lock cannot be
    acquired within the timeout, an empty list is returned and a warning
    is logged rather than raising.

    Returns:
        A flat list of ``(plugin_id, preset)`` tuples drawn from all loaded
        plugins, in plugin-iteration order.  Returns an empty list when no
        plugins are loaded or the lock times out.
    """
    raw = presets_view()
    if raw is False:
        logger.warning("get_all_plugin_presets: could not acquire PluginManager lock; returning empty list")
        return []

    view = cast(list[tuple[PluginCompositeId, list[PluginPresetDefinition]]], raw)
    result: list[tuple[PluginCompositeId, PluginPresetDefinition]] = []
    seen_ids: dict[str, PluginCompositeId] = {}
    for plugin_id, presets in view:
        for preset in presets:
            if preset.preset_id in seen_ids:
                logger.warning(
                    "Duplicate preset_id %r: plugin %s/%s conflicts with %s/%s (first wins)",
                    preset.preset_id,
                    plugin_id.store,
                    plugin_id.local,
                    seen_ids[preset.preset_id].store,
                    seen_ids[preset.preset_id].local,
                )
            else:
                seen_ids[preset.preset_id] = plugin_id
            result.append((plugin_id, preset))
    return result


def find_plugin_preset(preset_id: str) -> tuple[PluginCompositeId, PluginPresetDefinition] | None:
    """Find a single plugin preset by its ``preset_id``.

    Iterates all presets from all loaded plugins and returns the first one
    whose ``preset_id`` matches.  Returns ``None`` when no match is found or
    when the plugin lock cannot be acquired.

    Args:
        preset_id: The stable identifier of the preset to look up.

    Returns:
        A ``(plugin_id, preset)`` tuple for the matching preset, or ``None``
        if not found.
    """
    for pid, preset in get_all_plugin_presets():
        if preset.preset_id == preset_id:
            return (pid, preset)
    return None


def convert_to_builder(preset_def: PluginPresetDefinition) -> BlueprintBuilder:
    """Convert a :class:`~fiab_core.presets.PluginPresetDefinition` to a
    :class:`~forecastbox.domain.blueprint.service.BlueprintBuilder`.

    The preset's ``blocks`` mapping is shallow-copied into the builder so that
    subsequent mutations (e.g. injecting parameter values into ``local_glyphs``)
    do not affect the original preset definition held by the plugin.

    Args:
        preset_def: The plugin preset definition to convert.

    Returns:
        A :class:`~forecastbox.domain.blueprint.service.BlueprintBuilder`
        whose ``blocks`` are populated from ``preset_def.blocks``.
    """
    return BlueprintBuilder(blocks=dict(preset_def.blocks))
