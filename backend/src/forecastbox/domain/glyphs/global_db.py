# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Synchronous persistence helpers for user-defined GlobalGlyphs.

Each helper owns its session and transaction and must be submitted to the
``ConcurrentPools.JobsDb`` worker by a route, service, or background-thread
orchestrator.
"""

import datetime as dt
import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any, cast

from sqlalchemy import Select, delete, func, or_, select

import forecastbox.schemata.jobs as _jobs_module
from forecastbox.domain.glyphs.types import GlobalGlyphId
from forecastbox.schemata.jobs import GlobalGlyph
from forecastbox.utility.auth import AuthContext
from forecastbox.utility.db import dbRetry
from forecastbox.utility.time import current_time


@dataclass(frozen=True, eq=True, slots=True)
class GlobalGlyphRecord:
    global_glyph_id: str
    key: str
    value: str
    public: bool
    overriddable: bool | None
    created_by: str
    created_at: dt.datetime
    updated_at: dt.datetime


@dataclass(frozen=True, eq=True, slots=True)
class GlyphResolutionBuckets:
    """The three resolution tiers for global glyphs.

    Resolution order (lowest to highest): public_overriddable < user_own < public_nonoverridable.
    """

    public_overriddable: dict[str, str]
    user_own: dict[str, str]
    public_nonoverridable: dict[str, str]


def _to_record(row: GlobalGlyph) -> GlobalGlyphRecord:
    return GlobalGlyphRecord(
        global_glyph_id=cast(str, row.global_glyph_id),
        key=cast(str, row.key),
        value=cast(str, row.value),
        public=cast(bool, row.public),
        overriddable=cast(bool | None, row.overriddable),
        created_by=cast(str, row.created_by),
        created_at=cast(dt.datetime, row.created_at),
        updated_at=cast(dt.datetime, row.updated_at),
    )


def _visibility_filter(query: Select[Any], auth_context: AuthContext) -> Select[Any]:
    """Restrict a query to rows the caller is allowed to see."""
    if not auth_context.has_admin():
        query = query.where(
            or_(
                GlobalGlyph.created_by == auth_context.user_id,
                GlobalGlyph.public.is_(True),
            )
        )
    return query


def upsert_global_glyph(key: str, value: str, public: bool, overriddable: bool | None, auth_context: AuthContext) -> GlobalGlyphRecord:
    """Insert or update a GlobalGlyph by ``(created_by, key)`` and return it."""
    ref_time = current_time("dbref")

    def function(i: int) -> GlobalGlyphRecord:
        with _jobs_module.session_maker() as session:
            existing = session.execute(
                select(GlobalGlyph).where(
                    GlobalGlyph.key == key,
                    GlobalGlyph.created_by == auth_context.user_id,
                )
            ).scalar_one_or_none()
            if existing is not None:
                existing.value = value
                existing.public = public
                existing.overriddable = overriddable
                existing.updated_at = ref_time
                session.commit()
                return _to_record(existing)

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
            session.commit()
            return _to_record(new)

    return dbRetry(function)


def get_global_glyph(global_glyph_id: GlobalGlyphId, auth_context: AuthContext) -> GlobalGlyphRecord | None:
    """Return a visible GlobalGlyph by id, or None."""

    def function(i: int) -> GlobalGlyphRecord | None:
        with _jobs_module.session_maker() as session:
            query = _visibility_filter(
                select(GlobalGlyph).where(GlobalGlyph.global_glyph_id == global_glyph_id),
                auth_context,
            )
            row = session.execute(query).scalar_one_or_none()
            return None if row is None else _to_record(row)

    return dbRetry(function)


def list_global_glyphs(
    auth_context: AuthContext, offset: int = 0, limit: int | None = None, key: str | None = None
) -> Iterable[GlobalGlyphRecord]:
    """Return GlobalGlyphs visible to the caller, ordered by key."""

    def function(i: int) -> list[GlobalGlyphRecord]:
        with _jobs_module.session_maker() as session:
            query = _visibility_filter(
                select(GlobalGlyph).order_by(GlobalGlyph.key).offset(offset),
                auth_context,
            )
            if key is not None:
                query = query.where(GlobalGlyph.key == key)
            if limit is not None:
                query = query.limit(limit)
            result = session.execute(query)
            return [_to_record(row[0]) for row in result.all()]

    return dbRetry(function)


def count_global_glyphs(auth_context: AuthContext, key: str | None = None) -> int:
    """Return the total number of GlobalGlyphs visible to the caller."""

    def function(i: int) -> int:
        with _jobs_module.session_maker() as session:
            query = _visibility_filter(select(func.count()).select_from(GlobalGlyph), auth_context)
            if key is not None:
                query = query.where(GlobalGlyph.key == key)
            result = session.execute(query)
            return cast(int, result.scalar() or 0)

    return dbRetry(function)


def get_glyphs_for_resolution(auth_context: AuthContext) -> GlyphResolutionBuckets:
    """Fetch global glyphs split into three resolution tiers for the given caller."""

    def function(i: int) -> GlyphResolutionBuckets:
        with _jobs_module.session_maker() as session:
            pub_rows_result = session.execute(select(GlobalGlyph).where(GlobalGlyph.public.is_(True)).order_by(GlobalGlyph.updated_at))
            pub_overriddable: dict[str, str] = {}
            pub_nonoverridable: dict[str, str] = {}
            for row in pub_rows_result.scalars():
                if bool(row.overriddable):
                    pub_overriddable[str(row.key)] = str(row.value)
                else:
                    pub_nonoverridable[str(row.key)] = str(row.value)

            user_result = session.execute(
                select(GlobalGlyph).where(
                    GlobalGlyph.public.is_(False),
                    GlobalGlyph.created_by == auth_context.user_id,
                )
            )
            user_own = {str(row.key): str(row.value) for row in user_result.scalars()}

            return GlyphResolutionBuckets(
                public_overriddable=pub_overriddable,
                user_own=user_own,
                public_nonoverridable=pub_nonoverridable,
            )

    return dbRetry(function)


def delete_global_glyph(global_glyph_id: GlobalGlyphId, auth_context: AuthContext) -> GlobalGlyphRecord | None:
    """Delete a GlobalGlyph by id if the caller is allowed to do so."""

    def function(i: int) -> GlobalGlyphRecord | None:
        with _jobs_module.session_maker() as session:
            query = _visibility_filter(
                select(GlobalGlyph).where(GlobalGlyph.global_glyph_id == global_glyph_id),
                auth_context,
            )
            row = session.execute(query).scalar_one_or_none()
            if row is None:
                return None
            if not auth_context.allowed(str(row.created_by)):
                return None
            record = _to_record(row)
            session.execute(delete(GlobalGlyph).where(GlobalGlyph.global_glyph_id == global_glyph_id))
            session.commit()
            return record

    return dbRetry(function)
