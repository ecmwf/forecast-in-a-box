# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Persistence layer for plugin install state.

Uses the same session maker as ``forecastbox.schemata.jobs`` so that all tables
share a single SQLite connection pool and in-process tests can monkeypatch
``async_session_maker`` to inject an in-memory database.

This table records unversioned app state (install history, per-plugin config).
Writes are idempotent: insert on first install with empty-default columns for
excluded_templates / glyph_remapping / template_errors; update plugin_version /
updated_at / install_error on subsequent installs without clobbering the columns
owned by other subsystems.

The ``update_plugin_settings`` helper owns the settings columns
(``excluded_templates``, ``glyph_remapping``) and does a partial update that
leaves unspecified fields unchanged.
"""

import logging

from sqlalchemy import select, update

import forecastbox.schemata.jobs as _jobs_module
from forecastbox.schemata.jobs import PluginState
from forecastbox.utility.db import dbRetry, querySingle
from forecastbox.utility.time import current_time

logger = logging.getLogger(__name__)


async def upsert_plugin_state(*, plugin_id: str, version: str | None, enabled: bool, install_error: str | None) -> None:
    """Insert or update the PluginState row for ``plugin_id``.

    On first install: creates a row with empty ``excluded_templates`` / ``glyph_remapping``
    defaults, ``template_errors=None``, and ``asset_ingest_needed=True``.
    On subsequent calls: updates ``plugin_version`` (if provided), ``updated_at``,
    ``install_error``, and ``enabled``.  ``excluded_templates`` and ``glyph_remapping``
    are never touched.

    Sets ``asset_ingest_needed=True`` when the version changes or when ``enabled``
    transitions from ``False`` to ``True``.

    Raises ``RuntimeError`` if ``version`` is ``None`` and no existing row is found,
    as that indicates a programming error (re-enabling a plugin that was never installed).
    """
    ref_time = current_time("dbref")

    async def function(i: int) -> None:
        async with _jobs_module.async_session_maker() as session:
            result = await session.execute(select(PluginState).where(PluginState.plugin_id == plugin_id))
            existing = result.scalar_one_or_none()
            if existing is None:
                if version is None:
                    raise RuntimeError(
                        f"upsert_plugin_state called with version=None for unknown plugin {plugin_id!r}; "
                        "this plugin has no prior DB row and cannot be upserted without a version"
                    )
                session.add(
                    PluginState(
                        plugin_id=plugin_id,
                        plugin_version=version,
                        updated_at=ref_time,
                        install_error=install_error,
                        excluded_templates=[],
                        glyph_remapping={},
                        template_errors=None,
                        asset_ingest_needed=True,
                        enabled=enabled,
                    )
                )
            else:
                version_changed = version is not None and version != existing.plugin_version
                enabling = enabled and not existing.enabled
                new_ingest_needed = bool(existing.asset_ingest_needed) or version_changed or enabling
                values: dict[str, object] = {
                    "updated_at": ref_time,
                    "install_error": install_error,
                    "enabled": enabled,
                    "asset_ingest_needed": new_ingest_needed,
                }
                if version is not None:
                    values["plugin_version"] = version
                await session.execute(update(PluginState).where(PluginState.plugin_id == plugin_id).values(**values))
            await session.commit()

    await dbRetry(function)


async def get_plugin_state(plugin_id: str) -> PluginState | None:
    """Return the PluginState row for ``plugin_id``, or ``None`` if not yet installed."""
    query = select(PluginState).where(PluginState.plugin_id == plugin_id)
    return await querySingle(query, _jobs_module.async_session_maker)


async def get_all_plugin_states() -> list[PluginState]:
    """Return all PluginState rows."""

    async def function(i: int) -> list[PluginState]:
        async with _jobs_module.async_session_maker() as session:
            result = await session.execute(select(PluginState))
            return [row[0] for row in result.all()]

    return await dbRetry(function)


async def update_plugin_settings(
    *,
    plugin_id: str,
    excluded_templates: list[str] | None,
    glyph_remapping: dict[str, str] | None,
) -> None:
    """Partially update the settings columns of the PluginState row for ``plugin_id``.

    Only the fields that are not ``None`` are written; ``None`` means
    "leave the stored value unchanged".  An empty list or empty dict
    is a valid value meaning "explicitly clear".

    Always sets ``asset_ingest_needed=True`` when any setting is changed (or on
    insert), so the next load cycle re-applies the updated exclusions/remapping.

    If no row exists yet (plugin configured but never installed), a new row is
    inserted with the provided settings and a sentinel ``plugin_version``.
    """

    async def function(i: int) -> None:
        async with _jobs_module.async_session_maker() as session:
            result = await session.execute(select(PluginState).where(PluginState.plugin_id == plugin_id))
            existing = result.scalar_one_or_none()
            if existing is None:
                session.add(
                    PluginState(
                        plugin_id=plugin_id,
                        plugin_version="not installed",
                        updated_at=current_time("dbref"),
                        install_error=None,
                        excluded_templates=excluded_templates if excluded_templates is not None else [],
                        glyph_remapping=glyph_remapping if glyph_remapping is not None else {},
                        template_errors=None,
                        enabled=True,
                        asset_ingest_needed=True,
                    )
                )
            else:
                values: dict[str, object] = {}
                if excluded_templates is not None:
                    values["excluded_templates"] = excluded_templates
                if glyph_remapping is not None:
                    values["glyph_remapping"] = glyph_remapping
                if values:
                    values["asset_ingest_needed"] = True
                    await session.execute(update(PluginState).where(PluginState.plugin_id == plugin_id).values(**values))
            await session.commit()

    await dbRetry(function)


async def update_template_errors(*, plugin_id: str, template_errors: dict[str, str] | None) -> None:
    """Persist per-template validation errors for ``plugin_id``.

    ``None`` clears any recorded errors (all templates passed).  A non-empty
    dict maps ``display_name`` to the error string for that template.  Call
    this after each ingestion pass so the status surface reflects the latest result.

    If no PluginState row exists yet the call is silently skipped; the row will
    be created by ``upsert_plugin_state`` which defaults ``template_errors`` to ``None``.
    """

    async def function(i: int) -> None:
        async with _jobs_module.async_session_maker() as session:
            result = await session.execute(select(PluginState).where(PluginState.plugin_id == plugin_id))
            if result.scalar_one_or_none() is not None:
                await session.execute(update(PluginState).where(PluginState.plugin_id == plugin_id).values(template_errors=template_errors))
                await session.commit()

    await dbRetry(function)


async def set_plugin_enabled_state(*, plugin_id: str, enabled: bool) -> None:
    """Set the ``enabled`` flag for an existing PluginState row without touching any other field.

    Used by ``unload_single`` to persist the disabled state after removing the plugin
    from the in-memory maps.  If no row exists the call is a no-op.
    """

    async def function(i: int) -> None:
        async with _jobs_module.async_session_maker() as session:
            await session.execute(update(PluginState).where(PluginState.plugin_id == plugin_id).values(enabled=enabled))
            await session.commit()

    await dbRetry(function)


async def clear_asset_ingest_needed(*, plugin_id: str) -> None:
    """Clear the ``asset_ingest_needed`` flag immediately before starting template ingestion.

    Clearing before (not after) ingestion means a partial failure does not leave the
    flag set and trigger a spurious re-ingest; the per-template errors are already
    persisted via ``update_template_errors``.  If no row exists the call is a no-op.
    """

    async def function(i: int) -> None:
        async with _jobs_module.async_session_maker() as session:
            await session.execute(update(PluginState).where(PluginState.plugin_id == plugin_id).values(asset_ingest_needed=False))
            await session.commit()

    await dbRetry(function)
