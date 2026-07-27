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
``sync_session_maker`` to inject an in-memory database.

This table records unversioned app state (install history, per-plugin config).
Writes are idempotent: insert on first install with empty-default columns for
excluded_templates / glyph_remapping / template_errors; update plugin_version /
updated_at / install_error on subsequent installs without clobbering the columns
owned by other subsystems.

The ``upsert_plugin_state`` helper owns all mutable columns and does a partial
update that leaves unspecified fields (``None`` arguments) unchanged.
"""

import datetime as dt
from dataclasses import dataclass
from typing import Any, cast

from sqlalchemy import select, update

import forecastbox.schemata.jobs as _jobs_module
from forecastbox.domain.plugin.errors import PluginErrors
from forecastbox.domain.plugin.exceptions import PluginNotFound
from forecastbox.schemata.jobs import PluginState
from forecastbox.utility.db import dbRetry, querySingle
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


def _to_plugin_state_record(row: PluginState) -> PluginStateRecord:
    return PluginStateRecord(
        plugin_id=cast(str, row.plugin_id),
        plugin_version=cast(str, row.plugin_version),
        updated_at=cast(dt.datetime, row.updated_at),
        plugin_errors=cast(list[dict[str, Any]], list(cast(Any, row.plugin_errors) or [])),
        excluded_templates=cast(list[str], list(cast(Any, row.excluded_templates) or [])),
        glyph_remapping=cast(dict[str, str], dict(cast(Any, row.glyph_remapping) or {})),
        template_errors=cast(dict[str, str], dict(cast(Any, row.template_errors) or {})),
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

    On first install: creates a row with empty ``excluded_templates`` /
    ``glyph_remapping`` / ``template_errors`` defaults, ``asset_ingest_needed=True``,
    and ``enabled=True``.  All ``None`` arguments fall back to their defaults for
    new rows.

    On subsequent calls: only the explicitly provided (non-``None``) arguments are
    written; ``None`` means "leave the stored value unchanged".  Pass an empty list
    to explicitly clear previously stored errors.

    ``asset_ingest_needed`` is set to ``True`` when any of the following is true on
    an existing row: the flag was already set, the version changed, the plugin is
    being re-enabled, ``excluded_templates`` changed, or ``glyph_remapping`` changed.

    Raises ``PluginNotFoundError`` if ``version`` is ``None`` and no existing row is found,
    as that indicates a user error (updating a plugin that was never installed).
    """
    ref_time = current_time("dbref")
    plugin_errors_raw = [e.model_dump() for e in plugin_errors] if plugin_errors is not None else None

    def function(i: int) -> None:
        with _jobs_module.sync_session_maker() as session:
            result = session.execute(select(PluginState).where(PluginState.plugin_id == plugin_id))
            existing = result.scalar_one_or_none()
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
                enabling = enabled is True and not existing.enabled
                excluded_changed = excluded_templates is not None and excluded_templates != list(
                    cast(Any, existing.excluded_templates) or []
                )
                remapping_changed = glyph_remapping is not None and glyph_remapping != dict(cast(Any, existing.glyph_remapping) or {})
                new_ingest_needed = (
                    bool(existing.asset_ingest_needed) or version_changed or enabling or excluded_changed or remapping_changed
                )
                values: dict[str, object] = {
                    "updated_at": ref_time,
                    "asset_ingest_needed": new_ingest_needed,
                }
                if version is not None:
                    values["plugin_version"] = version
                if enabled is not None:
                    values["enabled"] = enabled
                if plugin_errors_raw is not None:
                    values["plugin_errors"] = plugin_errors_raw
                if excluded_templates is not None:
                    values["excluded_templates"] = excluded_templates
                if glyph_remapping is not None:
                    values["glyph_remapping"] = glyph_remapping
                session.execute(update(PluginState).where(PluginState.plugin_id == plugin_id).values(**values))
            session.commit()

    dbRetry(function)


def get_plugin_state(plugin_id: str) -> PluginStateRecord | None:
    """Return the PluginState row for ``plugin_id``, or ``None`` if not yet installed."""
    query = select(PluginState).where(PluginState.plugin_id == plugin_id)
    row = querySingle(query, _jobs_module.sync_session_maker)
    return None if row is None else _to_plugin_state_record(row)


def get_all_plugin_states() -> list[PluginStateRecord]:
    """Return all PluginState rows."""

    def function(i: int) -> list[PluginStateRecord]:
        with _jobs_module.sync_session_maker() as session:
            result = session.execute(select(PluginState))
            return [_to_plugin_state_record(row[0]) for row in result.all()]

    return dbRetry(function)


def update_template_errors(*, plugin_id: str, template_errors: dict[str, str]) -> None:
    """Persist per-template validation errors for ``plugin_id``.

    An empty dict clears any recorded errors (all templates passed).  A non-empty
    dict maps ``display_name`` to the error string for that template.  Call
    this after each ingestion pass so the status surface reflects the latest result.

    If no PluginState row exists yet the call is silently skipped; the row will
    be created by ``upsert_plugin_state`` which defaults ``template_errors`` to ``{}``.
    """

    def function(i: int) -> None:
        with _jobs_module.sync_session_maker() as session:
            result = session.execute(select(PluginState).where(PluginState.plugin_id == plugin_id))
            if result.scalar_one_or_none() is not None:
                session.execute(update(PluginState).where(PluginState.plugin_id == plugin_id).values(template_errors=template_errors))
                session.commit()

    dbRetry(function)


def clear_asset_ingest_needed(*, plugin_id: str) -> None:
    """Clear the ``asset_ingest_needed`` flag immediately before starting template ingestion.

    Clearing before (not after) ingestion means a partial failure does not leave the
    flag set and trigger a spurious re-ingest; the per-template errors are already
    persisted via ``update_template_errors``.  If no row exists the call is a no-op.
    """

    def function(i: int) -> None:
        with _jobs_module.sync_session_maker() as session:
            session.execute(update(PluginState).where(PluginState.plugin_id == plugin_id).values(asset_ingest_needed=False))
            session.commit()

    dbRetry(function)
