# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Plugin-domain operations offered to other domains (currently: the blueprint template consumer).
Synchronous; call from pool workers only.
"""

import logging
from collections.abc import Mapping
from dataclasses import dataclass

from fiab_core.fable import PluginCompositeId
from fiab_core.plugin import BlueprintTemplate

from forecastbox.domain.plugin.db import clear_asset_ingest_needed, get_plugin_state, update_template_errors
from forecastbox.domain.plugin.exceptions import PluginTemplatesUnavailable
from forecastbox.domain.plugin.state import PluginManager

logger = logging.getLogger(__name__)


@dataclass(frozen=True, eq=True, slots=True)
class TemplateIngestSpec:
    """Everything a consumer needs to ingest one plugin's blueprint templates."""

    plugin_id: PluginCompositeId
    templates: tuple[BlueprintTemplate, ...]
    excluded_templates: frozenset[str]
    glyph_remapping: Mapping[str, str]


def begin_template_ingest(plugin_id: PluginCompositeId) -> TemplateIngestSpec | None:
    """Return the ingestion spec for a published plugin and clear its asset_ingest_needed
    flag, or None when no ingestion is needed. Raises PluginTemplatesUnavailable when the
    plugin is not published or has no plugin_state row.

    The flag is cleared before ingesting so that a partial failure does not trigger a spurious re-ingest.
    """
    plugin_id_str = PluginCompositeId.to_str(plugin_id)
    plugin = PluginManager.plugins.get(plugin_id)
    if plugin is None:
        raise PluginTemplatesUnavailable(f"plugin {plugin_id_str!r} is not published")
    state = get_plugin_state(plugin_id_str)
    if state is None:
        raise PluginTemplatesUnavailable(f"no PluginState row exists for {plugin_id_str!r}")
    if not state.asset_ingest_needed:
        return None
    clear_asset_ingest_needed(plugin_id=plugin_id_str)
    return TemplateIngestSpec(
        plugin_id=plugin_id,
        templates=tuple(plugin.blueprint_templates),
        excluded_templates=frozenset(state.excluded_templates),
        glyph_remapping=state.glyph_remapping,
    )


def record_template_errors(plugin_id: PluginCompositeId, template_errors: dict[str, str]) -> None:
    """Persist the per-template ingestion errors of the last ingestion."""
    update_template_errors(plugin_id=PluginCompositeId.to_str(plugin_id), template_errors=template_errors)
