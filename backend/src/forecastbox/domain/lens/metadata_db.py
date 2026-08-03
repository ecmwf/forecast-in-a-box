# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Persistence layer for generic per-lens metadata (LensMetadata).

Structurally mirrors ``domain.glyphs.global_db``: each user owns their own row
per (lens_id, lens_metadata_id) pair, and rows marked ``public`` are visible to
everyone (an admin-provided default/template), but only mutable by their owner.
"""

import datetime as dt
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any, cast

from sqlalchemy import Select, delete, func, or_, select, update

import forecastbox.schemata.jobs as _jobs_module
from forecastbox.schemata.lens import LensMetadata
from forecastbox.utility.auth import AuthContext
from forecastbox.utility.db import dbRetry
from forecastbox.utility.time import current_time


@dataclass(frozen=True, eq=True, slots=True)
class LensMetadataRecord:
    lens_id: str
    lens_metadata_id: str
    metadata_content: Any
    public: bool
    created_by: str
    created_at: dt.datetime
    updated_at: dt.datetime


def _to_record(row: LensMetadata) -> LensMetadataRecord:
    return LensMetadataRecord(
        lens_id=cast(str, row.lens_id),
        lens_metadata_id=cast(str, row.lens_metadata_id),
        metadata_content=cast(Any, row.metadata_content),
        public=cast(bool, row.public),
        created_by=cast(str, row.created_by),
        created_at=cast(dt.datetime, row.created_at),
        updated_at=cast(dt.datetime, row.updated_at),
    )


def _visibility_filter(query: Select, auth_context: AuthContext) -> Select:  # type: ignore[type-arg]
    """Restrict a query to rows the caller is allowed to see.

    Admins see every row. Non-admins see their own rows plus any row that has
    ``public=True`` (an admin-provided default/template).
    """
    if not auth_context.has_admin():
        query = query.where(
            or_(
                LensMetadata.created_by == auth_context.user_id,
                LensMetadata.public.is_(True),
            )
        )
    return query


def upsert_lens_metadata(
    lens_id: str,
    lens_metadata_id: str,
    metadata_content: Any,
    public: bool,
    auth_context: AuthContext,
) -> LensMetadataRecord:
    """Insert or update a LensMetadata row by (lens_id, lens_metadata_id, created_by).

    Each user owns their own row per (lens_id, lens_metadata_id); callers can only
    upsert their own rows -- the caller always becomes (or remains) the owner.
    """
    ref_time = current_time("dbref")

    def function(i: int) -> LensMetadataRecord:
        with _jobs_module.sync_session_maker() as session:
            result = session.execute(
                select(LensMetadata).where(
                    LensMetadata.lens_id == lens_id,
                    LensMetadata.lens_metadata_id == lens_metadata_id,
                    LensMetadata.created_by == auth_context.user_id,
                )
            )
            existing: LensMetadata | None = result.scalar_one_or_none()
            if existing is not None:
                session.execute(
                    update(LensMetadata)
                    .where(
                        LensMetadata.lens_id == lens_id,
                        LensMetadata.lens_metadata_id == lens_metadata_id,
                        LensMetadata.created_by == auth_context.user_id,
                    )
                    .values(metadata_content=metadata_content, public=public, updated_at=ref_time)
                )
                session.commit()
                refreshed = session.execute(
                    select(LensMetadata).where(
                        LensMetadata.lens_id == lens_id,
                        LensMetadata.lens_metadata_id == lens_metadata_id,
                        LensMetadata.created_by == auth_context.user_id,
                    )
                ).scalar_one()
                return _to_record(refreshed)
            new = LensMetadata(
                lens_id=lens_id,
                lens_metadata_id=lens_metadata_id,
                created_by=auth_context.user_id,
                metadata_content=metadata_content,
                public=public,
                created_at=ref_time,
                updated_at=ref_time,
            )
            session.add(new)
            session.commit()
            return _to_record(new)

    return dbRetry(function)


def list_lens_metadata(
    lens_id: str,
    auth_context: AuthContext,
    offset: int = 0,
    limit: int | None = None,
    lens_metadata_id: str | None = None,
) -> Iterable[LensMetadataRecord]:
    """Return LensMetadata rows for ``lens_id`` visible to the caller, with optional paging.

    Admins see all rows for the given lens. Non-admins see their own rows plus
    all public rows. When ``lens_metadata_id`` is given, only rows with that
    exact id are returned -- this may still yield more than one row (e.g. the
    caller's own row plus a public row from another user); the frontend is
    responsible for merging these as needed.
    """

    def function(i: int) -> list[LensMetadataRecord]:
        with _jobs_module.sync_session_maker() as session:
            query = _visibility_filter(
                select(LensMetadata)
                .where(LensMetadata.lens_id == lens_id)
                .order_by(LensMetadata.lens_metadata_id, LensMetadata.created_by)
                .offset(offset),
                auth_context,
            )
            if lens_metadata_id is not None:
                query = query.where(LensMetadata.lens_metadata_id == lens_metadata_id)
            if limit is not None:
                query = query.limit(limit)
            result = session.execute(query)
            return [_to_record(r[0]) for r in result.all()]

    return dbRetry(function)


def count_lens_metadata(lens_id: str, auth_context: AuthContext, lens_metadata_id: str | None = None) -> int:
    """Return the total number of LensMetadata rows for ``lens_id`` visible to the caller."""

    def function(i: int) -> int:
        with _jobs_module.sync_session_maker() as session:
            query = _visibility_filter(select(func.count()).select_from(LensMetadata).where(LensMetadata.lens_id == lens_id), auth_context)
            if lens_metadata_id is not None:
                query = query.where(LensMetadata.lens_metadata_id == lens_metadata_id)
            result = session.execute(query)
            return result.scalar() or 0

    return dbRetry(function)


def delete_lens_metadata(lens_id: str, lens_metadata_id: str, auth_context: AuthContext) -> LensMetadataRecord | None:
    """Delete the caller's own LensMetadata row for (lens_id, lens_metadata_id).

    Always scoped to the caller's own row (``created_by == auth_context.user_id``),
    even for admins -- there is no cross-user delete. Returns the deleted row on
    success, or None if the caller has no such row.
    """

    def function(i: int) -> LensMetadataRecord | None:
        with _jobs_module.sync_session_maker() as session:
            result = session.execute(
                select(LensMetadata).where(
                    LensMetadata.lens_id == lens_id,
                    LensMetadata.lens_metadata_id == lens_metadata_id,
                    LensMetadata.created_by == auth_context.user_id,
                )
            )
            row: LensMetadata | None = result.scalar_one_or_none()
            if row is None:
                return None
            dto = _to_record(row)
            session.execute(
                delete(LensMetadata).where(
                    LensMetadata.lens_id == lens_id,
                    LensMetadata.lens_metadata_id == lens_metadata_id,
                    LensMetadata.created_by == auth_context.user_id,
                )
            )
            session.commit()
            return dto

    return dbRetry(function)
