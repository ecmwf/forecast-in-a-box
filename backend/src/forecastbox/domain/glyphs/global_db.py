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

from sqlalchemy import func, select, update

import forecastbox.schemata.jobs as _jobs_module
from forecastbox.schemata.jobs import GlobalGlyph
from forecastbox.utility.db import dbRetry, executeAndCommit, querySingle


async def upsert_global_glyph(key: str, value: str, created_by: str | None) -> GlobalGlyph:
    """Insert or update a GlobalGlyph by key and return it.

    If the key already exists the value and updated_at are refreshed in-place;
    the global_glyph_id and created_at are preserved.  If the key is new a
    fresh id is generated.
    """
    ref_time = dt.datetime.now()

    async def function(i: int) -> GlobalGlyph:
        async with _jobs_module.async_session_maker() as session:
            result = await session.execute(select(GlobalGlyph).where(GlobalGlyph.key == key))
            existing: GlobalGlyph | None = result.scalar_one_or_none()
            if existing is not None:
                glyph_id: str = str(existing.global_glyph_id)  # ty:ignore
                await session.execute(update(GlobalGlyph).where(GlobalGlyph.key == key).values(value=value, updated_at=ref_time))
                await session.commit()
                # Re-fetch to return consistent state after update.
                refreshed = await session.execute(select(GlobalGlyph).where(GlobalGlyph.global_glyph_id == glyph_id))
                return refreshed.scalar_one()
            else:
                new = GlobalGlyph(
                    global_glyph_id=str(uuid.uuid4()),
                    key=key,
                    value=value,
                    created_by=created_by,
                    created_at=ref_time,
                    updated_at=ref_time,
                )
                session.add(new)
                await session.commit()
                return new

    return await dbRetry(function)


async def get_global_glyph(global_glyph_id: str) -> GlobalGlyph | None:
    """Return a GlobalGlyph by its stable id, or None if not found."""
    query = select(GlobalGlyph).where(GlobalGlyph.global_glyph_id == global_glyph_id)
    return await querySingle(query, _jobs_module.async_session_maker)


async def list_global_glyphs(offset: int = 0, limit: int | None = None) -> Iterable[GlobalGlyph]:
    """Return all GlobalGlyphs ordered by key, with optional paging."""

    async def function(i: int) -> list[GlobalGlyph]:
        async with _jobs_module.async_session_maker() as session:
            query = select(GlobalGlyph).order_by(GlobalGlyph.key).offset(offset)
            if limit is not None:
                query = query.limit(limit)
            result = await session.execute(query)
            return [r[0] for r in result.all()]

    return await dbRetry(function)


async def count_global_glyphs() -> int:
    """Return the total number of GlobalGlyphs."""

    async def function(i: int) -> int:
        async with _jobs_module.async_session_maker() as session:
            query = select(func.count()).select_from(GlobalGlyph)
            result = await session.execute(query)
            return result.scalar() or 0

    return await dbRetry(function)
