# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Persistence layer for user-defined GlobalGlyphs."""

import datetime as dt
import uuid
from collections.abc import Iterable
from dataclasses import dataclass

from sqlalchemy import Select, func, or_, select, update

import forecastbox.schemata.jobs as _jobs_module
from forecastbox.domain.glyphs.types import GlobalGlyphId
from forecastbox.schemata.jobs import GlobalGlyph
from forecastbox.utility.auth import AuthContext
from forecastbox.utility.db import dbRetry, querySingle


@dataclass(frozen=True, eq=True, slots=True)
class GlyphResolutionBuckets:
    """The three resolution tiers for global glyphs.

    Resolution order (lowest to highest): public_overriddable < user_own < public_nonoverridable.
    """

    public_overriddable: dict[str, str]
    user_own: dict[str, str]
    public_nonoverridable: dict[str, str]


def _visibility_filter(query: Select, auth_context: AuthContext) -> Select:  # type: ignore[type-arg]
    """Restrict a query to rows the caller is allowed to see.

    Admins and passthrough callers see every glyph.  Non-admins see their own
    glyphs plus any glyph that has ``public=True``.
    """
    if not auth_context.has_admin():
        query = query.where(
            or_(
                GlobalGlyph.created_by == auth_context.user_id,
                GlobalGlyph.public.is_(True),
            )
        )
    return query


async def upsert_global_glyph(key: str, value: str, public: bool, overriddable: bool | None, auth_context: AuthContext) -> GlobalGlyph:
    """Insert or update a GlobalGlyph by (created_by, key) and return it.

    Each user owns their own glyph per key; callers can only upsert their own rows.
    On insert the caller becomes the owner.  On update the existing row for this
    (caller, key) pair is updated in-place — no cross-user mutation is possible.

    ``overriddable`` must be ``None`` when ``public=False`` and a bool when ``public=True``.
    This invariant is enforced at the route layer; the domain layer trusts callers.
    """
    ref_time = dt.datetime.now()

    async def function(i: int) -> GlobalGlyph:
        async with _jobs_module.async_session_maker() as session:
            result = await session.execute(
                select(GlobalGlyph).where(
                    GlobalGlyph.key == key,
                    GlobalGlyph.created_by == auth_context.user_id,
                )
            )
            existing: GlobalGlyph | None = result.scalar_one_or_none()
            if existing is not None:
                glyph_id: GlobalGlyphId = GlobalGlyphId(str(existing.global_glyph_id))  # ty:ignore[invalid-argument-type]
                await session.execute(
                    update(GlobalGlyph)
                    .where(GlobalGlyph.global_glyph_id == glyph_id)
                    .values(value=value, public=public, overriddable=overriddable, updated_at=ref_time)
                )
                await session.commit()
                refreshed = await session.execute(select(GlobalGlyph).where(GlobalGlyph.global_glyph_id == glyph_id))
                return refreshed.scalar_one()
            else:
                new = GlobalGlyph(
                    global_glyph_id=GlobalGlyphId(str(uuid.uuid4())),  # ty:ignore[invalid-argument-type]
                    key=key,
                    value=value,
                    public=public,
                    overriddable=overriddable,
                    created_by=auth_context.user_id,
                    created_at=ref_time,
                    updated_at=ref_time,
                )
                session.add(new)
                await session.commit()
                return new

    return await dbRetry(function)


async def get_global_glyph(global_glyph_id: GlobalGlyphId, auth_context: AuthContext) -> GlobalGlyph | None:
    """Return a GlobalGlyph visible to the caller by its stable id, or None if not found or not visible."""
    query = _visibility_filter(
        select(GlobalGlyph).where(GlobalGlyph.global_glyph_id == global_glyph_id),
        auth_context,
    )
    return await querySingle(query, _jobs_module.async_session_maker)


async def list_global_glyphs(auth_context: AuthContext, offset: int = 0, limit: int | None = None) -> Iterable[GlobalGlyph]:
    """Return GlobalGlyphs visible to the caller, ordered by key, with optional paging.

    Admins see all glyphs.  Non-admins see their own glyphs plus all public glyphs.
    Multiple rows for the same key (from different owners) may appear.
    """

    async def function(i: int) -> list[GlobalGlyph]:
        async with _jobs_module.async_session_maker() as session:
            query = _visibility_filter(
                select(GlobalGlyph).order_by(GlobalGlyph.key).offset(offset),
                auth_context,
            )
            if limit is not None:
                query = query.limit(limit)
            result = await session.execute(query)
            return [r[0] for r in result.all()]

    return await dbRetry(function)


async def count_global_glyphs(auth_context: AuthContext) -> int:
    """Return the total number of GlobalGlyphs visible to the caller."""

    async def function(i: int) -> int:
        async with _jobs_module.async_session_maker() as session:
            query = _visibility_filter(select(func.count()).select_from(GlobalGlyph), auth_context)
            result = await session.execute(query)
            return result.scalar() or 0

    return await dbRetry(function)


async def get_glyphs_for_resolution(auth_context: AuthContext) -> GlyphResolutionBuckets:
    """Fetch global glyphs split into three resolution tiers for the given caller.

    Returns a ``GlyphResolutionBuckets`` with:
    - ``public_overriddable``: public glyphs with ``overriddable=True`` (lowest priority).
    - ``user_own``: caller's own private (``public=False``) glyphs.
    - ``public_nonoverridable``: public glyphs with ``overriddable=False`` (highest priority).

    When multiple public glyphs share the same key (e.g. created by different admins),
    the most recently updated one wins within each public tier.
    """

    async def function(i: int) -> GlyphResolutionBuckets:
        async with _jobs_module.async_session_maker() as session:
            pub_rows_result = await session.execute(
                select(GlobalGlyph).where(GlobalGlyph.public.is_(True)).order_by(GlobalGlyph.updated_at)
            )
            pub_overriddable: dict[str, str] = {}
            pub_nonoverridable: dict[str, str] = {}
            for row in pub_rows_result.scalars():
                if bool(row.overriddable):  # ty:ignore[argument-type]
                    pub_overriddable[str(row.key)] = str(row.value)
                else:
                    pub_nonoverridable[str(row.key)] = str(row.value)

            user_result = await session.execute(
                select(GlobalGlyph).where(
                    GlobalGlyph.public.is_(False),
                    GlobalGlyph.created_by == auth_context.user_id,
                )
            )
            user_own: dict[str, str] = {str(row.key): str(row.value) for row in user_result.scalars()}

            return GlyphResolutionBuckets(
                public_overriddable=pub_overriddable,
                user_own=user_own,
                public_nonoverridable=pub_nonoverridable,
            )

    return await dbRetry(function)
