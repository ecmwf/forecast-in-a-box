# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Persistence layer for HighLevelPreset.

Uses the same session maker as ``forecastbox.schemata.jobs`` so that all tables
share a single SQLite connection pool and in-process tests can monkeypatch
a single ``async_session_maker`` attribute to inject an in-memory database.
"""

import datetime as dt
import uuid
from typing import cast as typing_cast

from sqlalchemy import String, cast, func, or_, select, update

import forecastbox.schemata.jobs as _jobs_module
from forecastbox.domain.preset.exceptions import PresetAccessDenied, PresetNotFound, PresetVersionConflict
from forecastbox.domain.preset.types import PresetId
from forecastbox.schemata.jobs import HighLevelPreset
from forecastbox.utility.auth import AuthContext
from forecastbox.utility.db import dbRetry, executeAndCommit, executeAndCommitReturningRowcount, querySingle


async def _insert_preset_row(
    *,
    preset_id: PresetId,
    new_version: int,
    name: str,
    description: str,
    long_description: str | None,
    difficulty: str,
    tags: list[str],
    icon: str,
    builder_template: dict,
    parameters: list[dict],
    is_published: bool,
    created_by: str,
    ref_time: dt.datetime,
) -> None:
    """Private helper: insert a new preset row into the database.

    This function handles the actual database insertion without any
    validation, authorization, or version checking. It should only be
    called by create_preset or add_preset_version.
    """

    async def function(i: int) -> None:
        async with _jobs_module.async_session_maker() as session:
            session.add(
                HighLevelPreset(
                    preset_id=preset_id,
                    version=new_version,
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
                    created_at=ref_time,
                    updated_at=ref_time,
                    is_deleted=False,
                )
            )
            await session.commit()

    await dbRetry(function)


async def create_preset(
    *,
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
) -> tuple[PresetId, int]:
    """Create a brand new preset with version 1.

    Generates a new UUID for the preset_id and always creates version 1.
    No authorization checks are performed beyond those in auth_context.

    Returns:
        Tuple of (preset_id, version) where version is always 1.
    """
    preset_id = PresetId(str(uuid.uuid4()))
    ref_time = dt.datetime.now()

    await _insert_preset_row(
        preset_id=preset_id,
        new_version=1,
        name=name,
        description=description,
        long_description=long_description,
        difficulty=difficulty,
        tags=tags or [],
        icon=icon,
        builder_template=builder_template,
        parameters=parameters or [],
        is_published=is_published,
        created_by=created_by,
        ref_time=ref_time,
    )

    return preset_id, 1


async def add_preset_version(
    *,
    preset_id: PresetId,
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
) -> tuple[PresetId, int]:
    """Add a new version to an existing preset.

    Derives the next version number from the database and performs
    authorization and version conflict checks.

    Args:
        preset_id: The ID of the existing preset to add a version to.
        auth_context: Authorization context for ownership checks.
        expected_version: If provided, must match the current maximum version.
        Other parameters: Content for the new version.

    Returns:
        Tuple of (preset_id, version) with the newly created version number.

    Raises:
        PresetNotFound: If no preset with the given ID exists.
        PresetAccessDenied: If the user is not the owner or an admin.
        PresetVersionConflict: If expected_version doesn't match current version.
    """
    ref_time = dt.datetime.now()

    async def function(i: int) -> int:
        async with _jobs_module.async_session_maker() as session:
            # Get the current maximum version
            result = await session.execute(select(func.max(HighLevelPreset.version)).where(HighLevelPreset.preset_id == preset_id))
            max_version: int | None = result.scalar()

            # Validate preset exists
            if max_version is None:
                raise PresetNotFound(f"No Preset with id={preset_id!r} exists; cannot add a new version.")

            # Check for version conflict
            if expected_version is not None and max_version != expected_version:
                raise PresetVersionConflict(
                    f"Version conflict for Preset {preset_id!r}: expected version {expected_version}, current is {max_version}."
                )

            # Check ownership on the latest (non-deleted) version
            owner_query = (
                select(HighLevelPreset.created_by)
                .where(
                    HighLevelPreset.preset_id == preset_id,
                    HighLevelPreset.is_deleted.is_(False),
                )
                .order_by(HighLevelPreset.version.desc())
                .limit(1)
            )
            owner_result = await session.execute(owner_query)
            row = owner_result.first()
            if row is not None:
                owner: str = row[0]
                if not auth_context.allowed(owner):
                    raise PresetAccessDenied(f"User {auth_context.user_id!r} is not allowed to modify Preset {preset_id!r}.")

            return max_version + 1

    new_version = await dbRetry(function)

    await _insert_preset_row(
        preset_id=preset_id,
        new_version=new_version,
        name=name,
        description=description,
        long_description=long_description,
        difficulty=difficulty,
        tags=tags or [],
        icon=icon,
        builder_template=builder_template,
        parameters=parameters or [],
        is_published=is_published,
        created_by=created_by,
        ref_time=ref_time,
    )

    return preset_id, new_version


async def get_preset(preset_id: PresetId, version: int | None = None) -> HighLevelPreset | None:
    """Return a specific or the latest non-deleted version of a HighLevelPreset.

    No authorization is applied; possession of the preset ID is treated as
    sufficient read access.
    """
    if version is not None:
        query = select(HighLevelPreset).where(
            HighLevelPreset.preset_id == preset_id,
            HighLevelPreset.version == version,
            HighLevelPreset.is_deleted.is_(False),
        )
    else:
        query = (
            select(HighLevelPreset)
            .where(
                HighLevelPreset.preset_id == preset_id,
                HighLevelPreset.is_deleted.is_(False),
            )
            .order_by(HighLevelPreset.version.desc())
            .limit(1)
        )
    return await querySingle(query, _jobs_module.async_session_maker)


async def list_presets(
    difficulty: str | None = None,
    search: str | None = None,
    published_only: bool = True,
    offset: int = 0,
    limit: int | None = None,
) -> list[HighLevelPreset]:
    """Return the latest non-deleted version of each preset matching filters.

    Args:
        difficulty: Exact string match on difficulty field
        search: Case-insensitive substring match on name, description, and tags
        published_only: When True, only return presets where is_published=True
        offset: Number of results to skip (for pagination)
        limit: Maximum number of results to return

    Returns:
        List of HighLevelPreset SQLAlchemy models matching the filters
    """

    async def function(i: int) -> list[HighLevelPreset]:
        async with _jobs_module.async_session_maker() as session:
            # Subquery to get the latest version of each preset
            subq = (
                select(
                    HighLevelPreset.preset_id,
                    func.max(HighLevelPreset.version).label("max_version"),
                )
                .where(HighLevelPreset.is_deleted.is_(False))
                .group_by(HighLevelPreset.preset_id)
                .subquery()
            )

            # Main query to get the full preset records
            query = (
                select(HighLevelPreset)
                .join(
                    subq,
                    (HighLevelPreset.preset_id == subq.c.preset_id) & (HighLevelPreset.version == subq.c.max_version),
                )
                .order_by(HighLevelPreset.created_at.desc())
            )

            # Apply filters
            if published_only:
                query = query.where(HighLevelPreset.is_published.is_(True))

            if difficulty is not None:
                query = query.where(HighLevelPreset.difficulty == difficulty)

            if search is not None:
                search_lower = search.lower()
                # Search in name, description, and tags (case-insensitive).
                # Tags is a JSON column; cast to String so SQLite can apply LIKE.
                query = query.where(
                    or_(
                        func.lower(HighLevelPreset.name).contains(search_lower),
                        func.lower(HighLevelPreset.description).contains(search_lower),
                        func.lower(cast(HighLevelPreset.tags, String)).contains(search_lower),
                    )
                )

            # Apply pagination
            query = query.offset(offset)
            if limit is not None:
                query = query.limit(limit)

            result = await session.execute(query)
            return [r[0] for r in result.all()]

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
            # Subquery to get the latest version of each preset
            subq = (
                select(
                    HighLevelPreset.preset_id,
                    func.max(HighLevelPreset.version).label("max_version"),
                )
                .where(HighLevelPreset.is_deleted.is_(False))
                .group_by(HighLevelPreset.preset_id)
                .subquery()
            )

            # Count query
            query = (
                select(func.count(func.distinct(HighLevelPreset.preset_id)))
                .select_from(HighLevelPreset)
                .join(
                    subq,
                    (HighLevelPreset.preset_id == subq.c.preset_id) & (HighLevelPreset.version == subq.c.max_version),
                )
            )

            # Apply filters
            if published_only:
                query = query.where(HighLevelPreset.is_published.is_(True))

            if difficulty is not None:
                query = query.where(HighLevelPreset.difficulty == difficulty)

            if search is not None:
                search_lower = search.lower()
                # Search in name, description, and tags (case-insensitive).
                # Tags is a JSON column; cast to String so SQLite can apply LIKE.
                query = query.where(
                    or_(
                        func.lower(HighLevelPreset.name).contains(search_lower),
                        func.lower(HighLevelPreset.description).contains(search_lower),
                        func.lower(cast(HighLevelPreset.tags, String)).contains(search_lower),
                    )
                )

            result = await session.execute(query)
            return result.scalar() or 0

    return await dbRetry(function)


async def patch_preset_publish_status(
    preset_id: PresetId,
    *,
    is_published: bool,
    expected_version: int,
    auth_context: AuthContext,
) -> None:
    """Toggle the ``is_published`` flag on the latest version **in place**.

    This is a metadata-only change: it updates the existing row rather than
    inserting a new version, so the version number is never incremented.

    Raises ``PresetNotFound`` if the preset does not exist,
    ``PresetAccessDenied`` if the actor is not the owner or an admin, and
    ``PresetVersionConflict`` if ``expected_version`` does not match the
    current latest version.
    """
    existing = await get_preset(preset_id)
    if existing is None:
        raise PresetNotFound(f"No Preset with id={preset_id!r}.")
    if typing_cast(int, existing.version) != expected_version:
        raise PresetVersionConflict(
            f"Version conflict for Preset {preset_id!r}: expected version {expected_version}, current is {existing.version}."
        )
    if not auth_context.allowed(typing_cast(str, existing.created_by)):
        raise PresetAccessDenied(f"User {auth_context.user_id!r} is not allowed to modify Preset {preset_id!r}.")
    stmt = (
        update(HighLevelPreset)
        .where(
            HighLevelPreset.preset_id == preset_id,
            HighLevelPreset.version == expected_version,
        )
        .values(is_published=is_published, updated_at=dt.datetime.now())
    )
    rowcount = await executeAndCommitReturningRowcount(stmt, _jobs_module.async_session_maker)
    if rowcount == 0:
        raise PresetVersionConflict(
            f"Concurrent modification: Preset {preset_id!r} version {expected_version} was changed before the update could be applied."
        )


async def soft_delete_preset(preset_id: PresetId, *, expected_version: int, auth_context: AuthContext) -> None:
    """Mark all versions of a Preset as deleted.

    Raises ``PresetNotFound`` if the preset does not exist,
    ``PresetAccessDenied`` if the actor is not the owner or an admin, and
    ``PresetVersionConflict`` if ``expected_version`` does not match the
    current latest version.
    """
    existing = await get_preset(preset_id)
    if existing is None:
        raise PresetNotFound(f"No Preset with id={preset_id!r}.")
    if typing_cast(int, existing.version) != expected_version:
        raise PresetVersionConflict(
            f"Version conflict for Preset {preset_id!r}: expected version {expected_version}, current is {existing.version}."
        )
    if not auth_context.allowed(typing_cast(str, existing.created_by)):
        raise PresetAccessDenied(f"User {auth_context.user_id!r} is not allowed to delete Preset {preset_id!r}.")
    stmt = update(HighLevelPreset).where(HighLevelPreset.preset_id == preset_id).values(is_deleted=True)
    rowcount = await executeAndCommitReturningRowcount(stmt, _jobs_module.async_session_maker)
    if rowcount == 0:
        raise PresetNotFound(f"Concurrent modification: Preset {preset_id!r} was deleted before the update could be applied.")
