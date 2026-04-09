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

from sqlalchemy import Select, func, or_, select, update

import forecastbox.schemata.jobs as _jobs_module
from forecastbox.domain.glyphs.exceptions import GlobalGlyphAccessDenied
from forecastbox.schemata.jobs import GlobalGlyph
from forecastbox.utility.auth import AuthContext
from forecastbox.utility.db import dbRetry, querySingle


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


async def upsert_global_glyph(key: str, value: str, public: bool, auth_context: AuthContext) -> GlobalGlyph:
    """Insert or update a GlobalGlyph by key and return it.

    On insert the caller becomes the owner.  On update the caller must be the
    owner (or an admin); otherwise ``GlobalGlyphAccessDenied`` is raised so
    that ownership cannot be hijacked via an update.
    """
    ref_time = dt.datetime.now()

    async def function(i: int) -> GlobalGlyph:
        async with _jobs_module.async_session_maker() as session:
            result = await session.execute(select(GlobalGlyph).where(GlobalGlyph.key == key))
            existing: GlobalGlyph | None = result.scalar_one_or_none()
            if existing is not None:
                if not auth_context.allowed(existing.created_by):  # ty:ignore
                    raise GlobalGlyphAccessDenied(f"User {auth_context.user_id!r} is not allowed to modify global glyph {key!r}.")
                glyph_id: str = str(existing.global_glyph_id)  # ty:ignore
                await session.execute(
                    update(GlobalGlyph).where(GlobalGlyph.key == key).values(value=value, public=public, updated_at=ref_time)
                )
                await session.commit()
                refreshed = await session.execute(select(GlobalGlyph).where(GlobalGlyph.global_glyph_id == glyph_id))
                return refreshed.scalar_one()
            else:
                new = GlobalGlyph(
                    global_glyph_id=str(uuid.uuid4()),
                    key=key,
                    value=value,
                    public=public,
                    created_by=auth_context.user_id,
                    created_at=ref_time,
                    updated_at=ref_time,
                )
                session.add(new)
                await session.commit()
                return new

    return await dbRetry(function)


async def get_global_glyph(global_glyph_id: str, auth_context: AuthContext) -> GlobalGlyph | None:
    """Return a GlobalGlyph visible to the caller by its stable id, or None if not found or not visible."""
    query = _visibility_filter(
        select(GlobalGlyph).where(GlobalGlyph.global_glyph_id == global_glyph_id),
        auth_context,
    )
    return await querySingle(query, _jobs_module.async_session_maker)


async def list_global_glyphs(auth_context: AuthContext, offset: int = 0, limit: int | None = None) -> Iterable[GlobalGlyph]:
    """Return GlobalGlyphs visible to the caller, ordered by key, with optional paging.

    Admins see all glyphs.  Non-admins see their own glyphs plus all public glyphs.
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
