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


async def upsert_plugin_state(*, plugin_id: str, version: str, install_error: str | None) -> None:
    """Insert or update the PluginState row for ``plugin_id``.

    On first install: creates a row with empty ``excluded_templates`` / ``glyph_remapping``
    defaults and ``template_errors=None``.
    On subsequent installs: updates ``plugin_version``, ``updated_at``, and ``install_error``
    only -- ``excluded_templates`` and ``glyph_remapping`` are not touched.
    """
    ref_time = current_time("dbref")

    async def function(i: int) -> None:
        async with _jobs_module.async_session_maker() as session:
            result = await session.execute(select(PluginState).where(PluginState.plugin_id == plugin_id))
            existing = result.scalar_one_or_none()
            if existing is None:
                session.add(
                    PluginState(
                        plugin_id=plugin_id,
                        plugin_version=version,
                        updated_at=ref_time,
                        install_error=install_error,
                        excluded_templates=[],
                        glyph_remapping={},
                        template_errors=None,
                    )
                )
            else:
                await session.execute(
                    update(PluginState)
                    .where(PluginState.plugin_id == plugin_id)
                    .values(plugin_version=version, updated_at=ref_time, install_error=install_error)
                )
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
                    )
                )
            else:
                values: dict[str, object] = {}
                if excluded_templates is not None:
                    values["excluded_templates"] = excluded_templates
                if glyph_remapping is not None:
                    values["glyph_remapping"] = glyph_remapping
                if values:
                    await session.execute(update(PluginState).where(PluginState.plugin_id == plugin_id).values(**values))
            await session.commit()

    await dbRetry(function)


async def get_plugin_settings(plugin_id: str) -> tuple[list[str], dict[str, str]]:
    """Return ``(excluded_templates, glyph_remapping)`` for ``plugin_id``.

    Returns empty defaults if the plugin has no persisted state yet.
    """
    state = await get_plugin_state(plugin_id)
    if state is None:
        return [], {}
    excluded: list[str] = list(state.excluded_templates) if state.excluded_templates else []  # type: ignore[arg-type]
    remapping: dict[str, str] = dict(state.glyph_remapping) if state.glyph_remapping else {}  # type: ignore[arg-type]
    return excluded, remapping
