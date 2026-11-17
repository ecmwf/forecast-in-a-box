# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Blueprint-side reaction to plugin template events.

Runs on a ``ConcurrentPools.General`` worker via ``dispatchers.py``, calls jobs-DB helpers
directly. Obtains plugin data and persists ingestion results through ``domain.plugin.service``.
"""

import logging

from fiab_core.fable import PluginCompositeId

from forecastbox.domain.blueprint.db import (
    find_plugin_template_id,
    soft_delete_all_plugin_templates,
    soft_delete_plugin_template,
    upsert_blueprint,
)
from forecastbox.domain.blueprint.service import (
    Tag,
    remap_builder_glyphs,
    resolve_builder_with_examples,
    tag_name_errors,
    template_to_builder,
    validate_expand_sync,
)
from forecastbox.domain.plugin.service import begin_template_ingest, record_template_errors
from forecastbox.utility.auth import AuthContext

logger = logging.getLogger(__name__)


def ingest_plugin_templates(plugin_id: PluginCompositeId) -> None:
    """Upsert each blueprint template exposed by the plugin into the DB.

    Does nothing when the plugin domain reports that no ingestion is needed. Excluded templates
    are soft-deleted. Non-excluded templates have their glyph names remapped when a remapping is
    stored, are validated, and are upserted when valid. A failure on any single template is
    logged and recorded, and the remaining templates are still ingested. The per-template errors
    are persisted at the end.
    """
    plugin_id_str = PluginCompositeId.to_str(plugin_id)
    spec = begin_template_ingest(plugin_id)
    if spec is None:
        logger.debug(f"skipping template ingestion for {plugin_id_str!r}: not needed")
        return

    auth = AuthContext(user_id=plugin_id_str, is_admin=True)
    excluded_set = spec.excluded_templates
    glyph_remapping = spec.glyph_remapping
    template_errors: dict[str, str] = {}

    for template in spec.templates:
        try:
            if template.display_name in excluded_set:
                soft_delete_plugin_template(created_by=plugin_id_str, display_name=template.display_name)
                logger.debug(f"soft-deleted excluded template {template.display_name!r} from plugin {plugin_id_str!r}")
                continue
            existing_id = find_plugin_template_id(created_by=plugin_id_str, display_name=template.display_name)
            builder = template_to_builder(template, plugin_id)
            if glyph_remapping:
                builder = remap_builder_glyphs(builder, dict(glyph_remapping))
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

    record_template_errors(plugin_id, template_errors)


def remove_plugin_templates(plugin_id: PluginCompositeId) -> None:
    """Soft-delete all templates created by the plugin. Idempotent."""
    soft_delete_all_plugin_templates(created_by=PluginCompositeId.to_str(plugin_id))
