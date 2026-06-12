# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Persistence layer for HighLevelPreset.

Delegates all blueprint CRUD to ``forecastbox.domain.blueprint.db`` and manages
the ``preset_metadata`` side-table for preset-specific fields (difficulty,
long_description, icon, parameters, is_published).

Uses the same session maker as ``forecastbox.schemata.jobs`` so that all tables
share a single SQLite connection pool and in-process tests can monkeypatch
a single ``async_session_maker`` attribute to inject an in-memory database.

Tag format reconciliation
-------------------------
Blueprint tags are ``list[dict]`` with ``{"key": "...", "value": "..."}`` shape.
Preset tags are ``list[str]``.  Conversion happens at this boundary:

- On write:  ``[{"key": t} for t in preset_tags]``
- On read:   ``[t["key"] for t in blueprint_tags]``
"""

from __future__ import annotations

import dataclasses
import datetime as dt
from typing import cast as typing_cast

from sqlalchemy import String, cast, func, or_, select, update

import forecastbox.domain.blueprint.db as _blueprint_db
import forecastbox.schemata.jobs as _jobs_module
from forecastbox.domain.blueprint.exceptions import (
    BlueprintAccessDenied,
    BlueprintNotFound,
    BlueprintVersionConflict,
)
from forecastbox.domain.blueprint.types import BlueprintId
from forecastbox.schemata.jobs import Blueprint, PresetMetadata
from forecastbox.utility.auth import AuthContext
from forecastbox.utility.db import dbRetry, executeAndCommitReturningRowcount

# ---------------------------------------------------------------------------
# Composite domain object
# ---------------------------------------------------------------------------


@dataclasses.dataclass
class PresetRow:
    """Composite view of a preset: Blueprint row + PresetMetadata row.

    Exposes the union of fields that callers (routes, service) need so they
    can treat a ``PresetRow`` like the old ``HighLevelPreset`` ORM row.
    """

    # --- from Blueprint ---
    preset_id: BlueprintId
    version: int
    name: str
    description: str
    tags: list[str]
    builder_template: dict
    created_by: str | None
    created_at: dt.datetime | None
    updated_at: dt.datetime | None

    # --- from PresetMetadata ---
    difficulty: str
    long_description: str | None
    icon: str
    parameters: list[dict]
    is_published: bool


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _tags_to_blueprint(preset_tags: list[str]) -> list[dict]:
    """Convert preset ``list[str]`` tags to blueprint ``list[dict]`` format."""
    return [{"key": t} for t in preset_tags]


def _tags_from_blueprint(blueprint_tags: list[dict] | None) -> list[str]:
    """Convert blueprint ``list[dict]`` tags to preset ``list[str]`` format."""
    if not blueprint_tags:
        return []
    return [t["key"] for t in blueprint_tags if "key" in t]


def _make_preset_row(blueprint: Blueprint, metadata: PresetMetadata) -> PresetRow:
    """Combine a Blueprint ORM row and a PresetMetadata ORM row into a PresetRow."""
    return PresetRow(
        preset_id=BlueprintId(typing_cast(str, blueprint.blueprint_id)),
        version=typing_cast(int, blueprint.version),
        name=typing_cast(str, blueprint.display_name) or "",
        description=typing_cast(str, blueprint.display_description) or "",
        tags=_tags_from_blueprint(typing_cast(list[dict] | None, blueprint.tags)),
        builder_template=typing_cast(dict, blueprint.builder) or {},
        created_by=typing_cast(str | None, blueprint.created_by),
        created_at=typing_cast(dt.datetime | None, blueprint.created_at),
        updated_at=None,  # Blueprint has no updated_at; kept for API compatibility
        difficulty=typing_cast(str, metadata.difficulty),
        long_description=typing_cast(str | None, metadata.long_description),
        icon=typing_cast(str, metadata.icon) or "Cloud",
        parameters=typing_cast(list[dict] | None, metadata.parameters) or [],
        is_published=typing_cast(bool, metadata.is_published),
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def create_preset(
    *,
    auth_context: AuthContext,
    preset_id: BlueprintId | None = None,
    name: str,
    description: str,
    long_description: str | None = None,
    difficulty: str,
    tags: list[str] | None = None,
    icon: str = "Cloud",
    builder_template: dict,
    parameters: list[dict] | None = None,
    is_published: bool = False,
    created_by: str,
) -> tuple[BlueprintId, int]:
    """Create a brand new preset with version 1.

    Delegates blueprint creation to ``blueprint.db.upsert_blueprint`` with
    ``source="preset"``, then inserts a ``PresetMetadata`` row.

    Args:
        preset_id: Optional stable slug-style ID (e.g. ``"blank-canvas"``).
            When omitted a fresh UUID is generated.  Callers that supply a
            stable ID (e.g. the seed module) are responsible for ensuring the
            ID does not already exist; ``upsert_blueprint`` will raise
            ``BlueprintNotFound`` if the ID is provided but absent from the DB,
            so we insert the Blueprint row directly in that case.

    Returns:
        Tuple of (preset_id, version) where version is always 1.
    """
    if preset_id is not None:
        # Insert a version-1 Blueprint row directly with the caller-supplied
        # stable ID.  We cannot use upsert_blueprint here because that function
        # raises BlueprintNotFound when a provided ID has no existing rows.
        import datetime as _dt

        from forecastbox.domain.plugin.compatibility import get_fiabcore_version
        from forecastbox.schemata.jobs import Blueprint as _Blueprint

        ref_time = _dt.datetime.now()

        async def _insert_blueprint(i: int) -> None:
            async with _jobs_module.async_session_maker() as session:
                session.add(
                    _Blueprint(
                        blueprint_id=str(preset_id),
                        version=1,
                        created_by=created_by,
                        created_at=ref_time,
                        source="preset",
                        parent_id=None,
                        display_name=name,
                        display_description=description,
                        tags=_tags_to_blueprint(tags or []),
                        builder=builder_template,
                        fiabcore_major=get_fiabcore_version().major,
                        is_deleted=False,
                    )
                )
                await session.commit()

        await dbRetry(_insert_blueprint)
        blueprint_id: BlueprintId = preset_id
        version: int = 1
    else:
        blueprint_id, version = await _blueprint_db.upsert_blueprint(
            auth_context=auth_context,
            blueprint_id=None,  # generate a fresh UUID
            source="preset",
            created_by=created_by,
            builder=builder_template,
            display_name=name,
            display_description=description,
            tags=_tags_to_blueprint(tags or []),
        )

    preset_id = blueprint_id

    async def _insert_metadata(i: int) -> None:
        async with _jobs_module.async_session_maker() as session:
            session.add(
                PresetMetadata(
                    blueprint_id=str(blueprint_id),
                    difficulty=difficulty,
                    long_description=long_description,
                    icon=icon,
                    parameters=parameters or [],
                    is_published=is_published,
                )
            )
            await session.commit()

    await dbRetry(_insert_metadata)

    return preset_id, version


async def add_preset_version(
    *,
    preset_id: BlueprintId,
    auth_context: AuthContext,
    name: str,
    description: str,
    long_description: str | None = None,
    difficulty: str,
    tags: list[str] | None = None,
    icon: str = "Cloud",
    builder_template: dict,
    parameters: list[dict] | None = None,
    is_published: bool = False,
    created_by: str,
    expected_version: int | None = None,
) -> tuple[BlueprintId, int]:
    """Add a new version to an existing preset.

    Delegates to ``blueprint.db.upsert_blueprint`` (which handles versioning,
    ownership, and conflict detection), then updates the ``PresetMetadata`` row.

    Args:
        preset_id: The ID of the existing preset to add a version to.
        auth_context: Authorization context for ownership checks.
        expected_version: If provided, must match the current maximum version.
        Other parameters: Content for the new version.

    Returns:
        Tuple of (preset_id, version) with the newly created version number.

    Raises:
        BlueprintNotFound: If no preset with the given ID exists.
        BlueprintAccessDenied: If the user is not the owner or an admin.
        BlueprintVersionConflict: If expected_version doesn't match current version.
    """
    _, new_version = await _blueprint_db.upsert_blueprint(
        auth_context=auth_context,
        blueprint_id=preset_id,
        source="preset",
        created_by=created_by,
        builder=builder_template,
        display_name=name,
        display_description=description,
        tags=_tags_to_blueprint(tags or []),
        expected_version=expected_version,
    )

    # Update the PresetMetadata side-table (upsert: update if exists, insert if not).
    async def _update_metadata(i: int) -> None:
        async with _jobs_module.async_session_maker() as session:
            result = await session.execute(select(PresetMetadata).where(PresetMetadata.blueprint_id == str(preset_id)))
            row = result.scalar_one_or_none()
            if row is not None:
                row.difficulty = difficulty  # type: ignore[assignment]
                row.long_description = long_description  # type: ignore[assignment]
                row.icon = icon  # type: ignore[assignment]
                row.parameters = parameters or []  # type: ignore[assignment]
                row.is_published = is_published  # type: ignore[assignment]
            else:
                session.add(
                    PresetMetadata(
                        blueprint_id=str(preset_id),
                        difficulty=difficulty,
                        long_description=long_description,
                        icon=icon,
                        parameters=parameters or [],
                        is_published=is_published,
                    )
                )
            await session.commit()

    await dbRetry(_update_metadata)

    return preset_id, new_version


async def update_preset(
    *,
    preset_id: BlueprintId,
    auth_context: AuthContext,
    name: str,
    description: str,
    long_description: str | None = None,
    difficulty: str,
    tags: list[str] | None = None,
    icon: str = "Cloud",
    builder_template: dict,
    parameters: list[dict] | None = None,
    is_published: bool = False,
    created_by: str,
    expected_version: int | None = None,
) -> tuple[BlueprintId, int]:
    """Alias for ``add_preset_version`` for callers that prefer the ``update_preset`` name."""
    return await add_preset_version(
        preset_id=preset_id,
        auth_context=auth_context,
        name=name,
        description=description,
        long_description=long_description,
        difficulty=difficulty,
        tags=tags,
        icon=icon,
        builder_template=builder_template,
        parameters=parameters,
        is_published=is_published,
        created_by=created_by,
        expected_version=expected_version,
    )


async def get_preset(preset_id: BlueprintId, version: int | None = None) -> PresetRow | None:
    """Return a specific or the latest non-deleted version of a preset.

    Fetches the ``Blueprint`` row via ``blueprint.db.get_blueprint``, then
    joins the ``PresetMetadata`` side-table.  Returns ``None`` if the preset
    does not exist or has been soft-deleted.

    No authorization is applied; possession of the preset ID is treated as
    sufficient read access.
    """
    blueprint = await _blueprint_db.get_blueprint(preset_id, version)
    if blueprint is None:
        return None

    async def _fetch_metadata(i: int) -> PresetMetadata | None:
        async with _jobs_module.async_session_maker() as session:
            result = await session.execute(select(PresetMetadata).where(PresetMetadata.blueprint_id == str(preset_id)))
            return result.scalar_one_or_none()

    metadata = await dbRetry(_fetch_metadata)
    if metadata is None:
        return None

    return _make_preset_row(blueprint, metadata)


async def list_presets(
    difficulty: str | None = None,
    search: str | None = None,
    published_only: bool = True,
    offset: int = 0,
    limit: int | None = None,
) -> list[PresetRow]:
    """Return the latest non-deleted version of each preset matching filters.

    Queries the ``blueprint`` table filtered by ``source="preset"``, joined
    with ``preset_metadata``, applying preset-specific filters.

    Args:
        difficulty: Exact string match on difficulty field
        search: Case-insensitive substring match on name, description, and tags
        published_only: When True, only return presets where is_published=True
        offset: Number of results to skip (for pagination)
        limit: Maximum number of results to return

    Returns:
        List of PresetRow composite objects matching the filters
    """

    async def function(i: int) -> list[PresetRow]:
        async with _jobs_module.async_session_maker() as session:
            # Subquery: latest version of each preset-source blueprint
            subq = (
                select(
                    Blueprint.blueprint_id,
                    func.max(Blueprint.version).label("max_version"),
                )
                .where(
                    Blueprint.is_deleted.is_(False),
                    Blueprint.source == "preset",
                )
                .group_by(Blueprint.blueprint_id)
                .subquery()
            )

            # Main query: join blueprint with its latest-version subquery and preset_metadata
            query = (
                select(Blueprint, PresetMetadata)
                .join(
                    subq,
                    (Blueprint.blueprint_id == subq.c.blueprint_id) & (Blueprint.version == subq.c.max_version),
                )
                .join(
                    PresetMetadata,
                    Blueprint.blueprint_id == PresetMetadata.blueprint_id,
                )
                .order_by(Blueprint.created_at.desc())
            )

            # Apply preset-specific filters
            if published_only:
                query = query.where(PresetMetadata.is_published.is_(True))

            if difficulty is not None:
                query = query.where(PresetMetadata.difficulty == difficulty)

            if search is not None:
                search_lower = search.lower()
                # Search in name (display_name), description (display_description),
                # and tags (JSON column; cast to String for SQLite LIKE).
                query = query.where(
                    or_(
                        func.lower(Blueprint.display_name).contains(search_lower),
                        func.lower(Blueprint.display_description).contains(search_lower),
                        func.lower(cast(Blueprint.tags, String)).contains(search_lower),
                    )
                )

            # Apply pagination
            query = query.offset(offset)
            if limit is not None:
                query = query.limit(limit)

            result = await session.execute(query)
            rows = result.all()
            return [_make_preset_row(blueprint_row, metadata_row) for blueprint_row, metadata_row in rows]

    return await dbRetry(function)


async def count_presets(
    difficulty: str | None = None,
    search: str | None = None,
    published_only: bool = True,
) -> int:
    """Return the total number of distinct non-deleted preset IDs matching filters.

    Args:
        difficulty: Exact string match on difficulty field
        search: Case-insensitive substring match on name, description, and tags
        published_only: When True, only count presets where is_published=True

    Returns:
        Count of presets matching the filters
    """

    async def function(i: int) -> int:
        async with _jobs_module.async_session_maker() as session:
            # Subquery: latest version of each preset-source blueprint
            subq = (
                select(
                    Blueprint.blueprint_id,
                    func.max(Blueprint.version).label("max_version"),
                )
                .where(
                    Blueprint.is_deleted.is_(False),
                    Blueprint.source == "preset",
                )
                .group_by(Blueprint.blueprint_id)
                .subquery()
            )

            # Count query with same joins and filters as list_presets
            query = (
                select(func.count(func.distinct(Blueprint.blueprint_id)))
                .select_from(Blueprint)
                .join(
                    subq,
                    (Blueprint.blueprint_id == subq.c.blueprint_id) & (Blueprint.version == subq.c.max_version),
                )
                .join(
                    PresetMetadata,
                    Blueprint.blueprint_id == PresetMetadata.blueprint_id,
                )
            )

            # Apply preset-specific filters
            if published_only:
                query = query.where(PresetMetadata.is_published.is_(True))

            if difficulty is not None:
                query = query.where(PresetMetadata.difficulty == difficulty)

            if search is not None:
                search_lower = search.lower()
                query = query.where(
                    or_(
                        func.lower(Blueprint.display_name).contains(search_lower),
                        func.lower(Blueprint.display_description).contains(search_lower),
                        func.lower(cast(Blueprint.tags, String)).contains(search_lower),
                    )
                )

            result = await session.execute(query)
            return result.scalar() or 0

    return await dbRetry(function)


async def patch_preset_publish_status(
    preset_id: BlueprintId,
    *,
    is_published: bool,
    expected_version: int,
    auth_context: AuthContext,
) -> None:
    """Toggle the ``is_published`` flag on the ``preset_metadata`` row **in place**.

    This is a metadata-only change: it updates the ``preset_metadata`` row
    directly rather than inserting a new blueprint version, so the version
    number is never incremented.

    The optimistic lock checks the blueprint's current version via
    ``blueprint.db.get_blueprint``.

    Raises ``BlueprintNotFound`` if the preset does not exist,
    ``BlueprintAccessDenied`` if the actor is not the owner or an admin, and
    ``BlueprintVersionConflict`` if ``expected_version`` does not match the
    current latest version.
    """
    existing = await get_preset(preset_id)
    if existing is None:
        raise BlueprintNotFound(f"No Preset with id={preset_id!r}.")
    if existing.version != expected_version:
        raise BlueprintVersionConflict(
            f"Version conflict for Preset {preset_id!r}: expected version {expected_version}, current is {existing.version}."
        )
    if not auth_context.allowed(existing.created_by or ""):
        raise BlueprintAccessDenied(f"User {auth_context.user_id!r} is not allowed to modify Preset {preset_id!r}.")

    stmt = update(PresetMetadata).where(PresetMetadata.blueprint_id == str(preset_id)).values(is_published=is_published)
    rowcount = await executeAndCommitReturningRowcount(stmt, _jobs_module.async_session_maker)
    if rowcount == 0:
        raise BlueprintVersionConflict(
            f"Concurrent modification: Preset {preset_id!r} version {expected_version} was changed before the update could be applied."
        )


async def soft_delete_preset(preset_id: BlueprintId, *, expected_version: int, auth_context: AuthContext) -> None:
    """Mark all versions of a Preset as deleted.

    Delegates to ``blueprint.db.soft_delete_blueprint`` and translates
    blueprint exceptions to preset exceptions.

    Raises ``BlueprintNotFound`` if the preset does not exist,
    ``BlueprintAccessDenied`` if the actor is not the owner or an admin, and
    ``BlueprintVersionConflict`` if ``expected_version`` does not match the
    current latest version.
    """
    await _blueprint_db.soft_delete_blueprint(
        preset_id,
        expected_version=expected_version,
        auth_context=auth_context,
    )
