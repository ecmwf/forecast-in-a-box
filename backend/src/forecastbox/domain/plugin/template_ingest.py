# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Temporary plugin-to-blueprint template ingestion.

This module reaches directly into the blueprint domain (via lazy imports, see
below) instead of going through an event. That dependency is temporary and is
expected to be replaced by blueprint-owned dispatcher handlers in Phase 5 of
the concurrency rework; see
``docs/developer/changeSpecs/backend-concurrencyRework-migration.md``. Until
then, this module is called synchronously from ``domain.plugin.loading`` on
the single-worker ``ConcurrentPools.PluginManagement`` pool.
"""

import logging

from fiab_core.fable import PluginCompositeId
from fiab_core.plugin import Plugin

from forecastbox.domain.plugin.db import clear_asset_ingest_needed, get_plugin_state, update_template_errors

logger = logging.getLogger(__name__)


def ingest_plugin_templates(plugin_id: PluginCompositeId, plugin: Plugin) -> None:
    """Upsert each blueprint template exposed by the plugin into the DB.

    Skips ingestion entirely if ``asset_ingest_needed`` is not set on the plugin's
    DB state row. When ingestion does run, the flag is cleared *before* ingesting so
    that a partial failure does not trigger a spurious re-ingest; per-template errors
    are persisted via ``update_template_errors`` regardless.

    Excluded templates (per ``PluginState.excluded_templates``) are skipped and
    any existing plugin-owned blueprint row with that ``display_name`` is
    soft-deleted. Non-excluded templates have their glyph names rewritten by
    ``remap_builder_glyphs`` when a non-empty ``glyph_remapping`` is stored for
    the plugin, then are upserted as normal.

    Uses lazy imports to avoid circular dependencies between the plugin and
    blueprint domains. A failure on any single template is logged and skipped
    so the remaining templates are still ingested.
    Note: these imports are a breach of the dependency hierarchy (plugin domain
    depending on blueprint domain), and are temporary -- see the module docstring.
    """
    from forecastbox.domain.blueprint.db import find_plugin_template_id, soft_delete_plugin_template, upsert_blueprint
    from forecastbox.domain.blueprint.service import (
        Tag,
        remap_builder_glyphs,
        resolve_builder_with_examples,
        tag_name_errors,
        template_to_builder,
        validate_expand_sync,
    )
    from forecastbox.utility.auth import AuthContext

    plugin_id_str = PluginCompositeId.to_str(plugin_id)

    state = get_plugin_state(plugin_id_str)
    if state is None:
        raise RuntimeError(
            f"ingest_plugin_templates called for {plugin_id_str!r} but no PluginState row exists; "
            "this is a programming error -- upsert_plugin_state must be called before ingestion"
        )
    if not state.asset_ingest_needed:
        logger.debug(f"skipping template ingestion for {plugin_id_str!r}: asset_ingest_needed is False")
        return

    clear_asset_ingest_needed(plugin_id=plugin_id_str)

    auth = AuthContext(user_id=plugin_id_str, is_admin=True)
    excluded_set = set(state.excluded_templates)
    glyph_remapping = state.glyph_remapping
    template_errors: dict[str, str] = {}

    for template in plugin.blueprint_templates:
        try:
            if template.display_name in excluded_set:
                soft_delete_plugin_template(created_by=plugin_id_str, display_name=template.display_name)
                logger.debug(f"soft-deleted excluded template {template.display_name!r} from plugin {plugin_id_str!r}")
                continue
            existing_id = find_plugin_template_id(created_by=plugin_id_str, display_name=template.display_name)
            builder = template_to_builder(template, plugin_id)
            if glyph_remapping:
                builder = remap_builder_glyphs(builder, glyph_remapping)
            validation_builder = resolve_builder_with_examples(builder, template.example_values, template.example_glyphs)
            result = validate_expand_sync(validation_builder, auth, validate_only=True)
            all_errors: list[str] = tag_name_errors([Tag(key=tag) for tag in template.tags])
            all_errors.extend(result.global_errors)
            for block_errs in result.block_errors.values():
                all_errors.extend(block_errs)
            if all_errors:
                template_errors[template.display_name] = "; ".join(all_errors)
                logger.warning(
                    f"template {template.display_name!r} from plugin {plugin_id_str!r} failed validation, skipping upsert: {all_errors}"
                )
                continue
            upsert_blueprint(
                auth_context=auth,
                blueprint_id=existing_id,
                source="plugin_template",
                created_by=plugin_id_str,
                builder=builder.model_dump(mode="json"),
                display_name=template.display_name,
                display_description=template.display_description,
                tags=[{"key": tag} for tag in template.tags] or None,
            )
            logger.debug(f"ingested template {template.display_name!r} from plugin {plugin_id_str!r}")
        except Exception as e:
            template_errors[template.display_name] = repr(e)
            logger.error(f"failed to ingest template {template.display_name!r} from plugin {plugin_id_str!r}: {repr(e)}")

    update_template_errors(plugin_id=plugin_id_str, template_errors=template_errors)


def unload_plugin_templates(plugin_id: PluginCompositeId) -> None:
    """Marks all templates by a particular plugin as deleted, to complete a plugin unloading.

    Similarly to ingest, this is hierarchy-breaching until refactored to events"""
    from forecastbox.domain.blueprint.db import soft_delete_all_plugin_templates

    plugin_id_str = PluginCompositeId.to_str(plugin_id)
    soft_delete_all_plugin_templates(created_by=plugin_id_str)
