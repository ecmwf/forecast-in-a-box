# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Synchronous persistence helpers for plugin install state.

Each helper owns its session and transaction and must be submitted to the
``ConcurrentPools.JobsDb`` worker by a route, service, or background-thread
orchestrator.

This table records unversioned application state such as install history and
per-plugin configuration. ``upsert_plugin_state`` owns all mutable columns and
performs a partial update: arguments left as ``None`` keep their stored value.
"""

import datetime as dt
from dataclasses import dataclass
from typing import Any, cast

from sqlalchemy import select

import forecastbox.schemata.jobs as _jobs_module
from forecastbox.domain.plugin.errors import PluginErrors
from forecastbox.domain.plugin.exceptions import PluginNotFound
from forecastbox.schemata.jobs import PluginState
from forecastbox.utility.db import dbRetry
from forecastbox.utility.time import current_time


@dataclass(frozen=True, eq=True, slots=True)
class PluginStateRecord:
    plugin_id: str
    plugin_version: str
    updated_at: dt.datetime
    plugin_errors: list[dict[str, Any]]
    excluded_templates: list[str]
    glyph_remapping: dict[str, str]
    template_errors: dict[str, str]
    asset_ingest_needed: bool
    enabled: bool


def _to_record(row: PluginState) -> PluginStateRecord:
    return PluginStateRecord(
        plugin_id=cast(str, row.plugin_id),
        plugin_version=cast(str, row.plugin_version),
        updated_at=cast(dt.datetime, row.updated_at),
        plugin_errors=cast(list[dict[str, Any]], row.plugin_errors or []),
        excluded_templates=cast(list[str], row.excluded_templates or []),
        glyph_remapping=cast(dict[str, str], row.glyph_remapping or {}),
        template_errors=cast(dict[str, str], row.template_errors or {}),
        asset_ingest_needed=cast(bool, row.asset_ingest_needed),
        enabled=cast(bool, row.enabled),
    )


def upsert_plugin_state(
    *,
    plugin_id: str,
    version: str | None = None,
    enabled: bool | None = None,
    plugin_errors: PluginErrors | None = None,
    excluded_templates: list[str] | None = None,
    glyph_remapping: dict[str, str] | None = None,
) -> None:
    """Insert or update the PluginState row for ``plugin_id``.

    On first install this creates a row with empty defaults for
    ``excluded_templates``, ``glyph_remapping``, and ``template_errors``, with
    ``asset_ingest_needed=True`` and ``enabled=True`` unless explicitly
    overridden.

    On later calls, only explicitly provided non-``None`` arguments are
    written. ``asset_ingest_needed`` stays true once set, and is also forced to
    true when the version changes, the plugin is re-enabled,
    ``excluded_templates`` changes, or ``glyph_remapping`` changes.

    Raises ``PluginNotFound`` if ``version`` is ``None`` and no existing row is
    found, because that means the caller is trying to update a plugin that has
    never been installed.
    """
    ref_time = current_time("dbref")
    plugin_errors_raw = [e.model_dump() for e in plugin_errors] if plugin_errors is not None else None

    def function(i: int) -> None:
        with _jobs_module.session_maker() as session:
            existing = session.execute(select(PluginState).where(PluginState.plugin_id == plugin_id)).scalar_one_or_none()
            if existing is None:
                if version is None:
                    raise PluginNotFound(
                        f"upsert_plugin_state called with version=None for unknown plugin {plugin_id!r}; "
                        "this plugin has no prior DB row and cannot be upserted without a version"
                    )
                session.add(
                    PluginState(
                        plugin_id=plugin_id,
                        plugin_version=version,
                        updated_at=ref_time,
                        plugin_errors=plugin_errors_raw if plugin_errors_raw is not None else [],
                        excluded_templates=excluded_templates if excluded_templates is not None else [],
                        glyph_remapping=glyph_remapping if glyph_remapping is not None else {},
                        template_errors={},
                        asset_ingest_needed=True,
                        enabled=enabled if enabled is not None else True,
                    )
                )
            else:
                version_changed = version is not None and version != existing.plugin_version
                enabling = enabled is True and not bool(existing.enabled)
                existing_excluded = cast(list[str], existing.excluded_templates or [])
                existing_remapping = cast(dict[str, str], existing.glyph_remapping or {})
                excluded_changed = excluded_templates is not None and excluded_templates != existing_excluded
                remapping_changed = glyph_remapping is not None and glyph_remapping != existing_remapping
                existing.updated_at = ref_time
                existing.asset_ingest_needed = (
                    bool(existing.asset_ingest_needed) or version_changed or enabling or excluded_changed or remapping_changed
                )
                if version is not None:
                    existing.plugin_version = version
                if enabled is not None:
                    existing.enabled = enabled
                if plugin_errors_raw is not None:
                    existing.plugin_errors = plugin_errors_raw
                if excluded_templates is not None:
                    existing.excluded_templates = excluded_templates
                if glyph_remapping is not None:
                    existing.glyph_remapping = glyph_remapping
            session.commit()

    dbRetry(function)


def get_plugin_state(plugin_id: str) -> PluginStateRecord | None:
    """Return the PluginState row for ``plugin_id``, or ``None`` if not yet installed."""

    def function(i: int) -> PluginStateRecord | None:
        with _jobs_module.session_maker() as session:
            row = session.execute(select(PluginState).where(PluginState.plugin_id == plugin_id)).scalar_one_or_none()
            return None if row is None else _to_record(row)

    return dbRetry(function)


def get_all_plugin_states() -> list[PluginStateRecord]:
    """Return all PluginState rows."""

    def function(i: int) -> list[PluginStateRecord]:
        with _jobs_module.session_maker() as session:
            result = session.execute(select(PluginState))
            return [_to_record(row[0]) for row in result.all()]

    return dbRetry(function)


def update_template_errors(*, plugin_id: str, template_errors: dict[str, str]) -> None:
    """Persist per-template validation errors for ``plugin_id``.

    An empty dict clears any recorded errors. A non-empty dict maps each
    template ``display_name`` to its latest validation error string. If no
    ``PluginState`` row exists yet the call is silently skipped.
    """

    def function(i: int) -> None:
        with _jobs_module.session_maker() as session:
            existing = session.execute(select(PluginState).where(PluginState.plugin_id == plugin_id)).scalar_one_or_none()
            if existing is not None:
                existing.template_errors = template_errors
                session.commit()

    dbRetry(function)


def clear_asset_ingest_needed(*, plugin_id: str) -> None:
    """Clear the ``asset_ingest_needed`` flag immediately before template ingestion.

    Clearing before, rather than after, ingestion prevents a partial failure
    from leaving the flag set and triggering a spurious re-ingest; detailed
    per-template failures are persisted separately. If no row exists the call
    is a no-op.
    """

    def function(i: int) -> None:
        with _jobs_module.session_maker() as session:
            existing = session.execute(select(PluginState).where(PluginState.plugin_id == plugin_id)).scalar_one_or_none()
            if existing is not None:
                existing.asset_ingest_needed = False
                session.commit()

    dbRetry(function)
