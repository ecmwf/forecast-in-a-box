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
excluded_templates / glyph_remapping / template_errors; update version /
updated_at / error on subsequent installs without clobbering the columns owned
by later tasks (04/05/06).
"""

import logging

from sqlalchemy import select, update

import forecastbox.schemata.jobs as _jobs_module
from forecastbox.schemata.jobs import PluginState
from forecastbox.utility.db import dbRetry, querySingle
from forecastbox.utility.time import current_time

logger = logging.getLogger(__name__)


async def upsert_plugin_state(*, plugin_id: str, version: str | None, error: str | None) -> None:
    """Insert or update the PluginState row for ``plugin_id``.

    On first install: creates a row with empty ``excluded_templates`` / ``glyph_remapping``
    defaults and ``template_errors=None``.
    On subsequent installs: updates ``version``, ``updated_at``, and ``error`` only --
    ``excluded_templates`` and ``glyph_remapping`` are not touched (owned by tasks 04/05).
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
                        version=version,
                        updated_at=ref_time,
                        error=error,
                        excluded_templates=[],
                        glyph_remapping={},
                        template_errors=None,
                    )
                )
            else:
                await session.execute(
                    update(PluginState).where(PluginState.plugin_id == plugin_id).values(version=version, updated_at=ref_time, error=error)
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
