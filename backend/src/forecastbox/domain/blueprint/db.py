# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Persistence layer for Blueprint, with auth-scoped authorization.

Uses the same session maker as ``forecastbox.db.jobs`` so that all tables
share a single SQLite connection pool and in-process tests can monkeypatch
a single ``async_session_maker`` attribute to inject an in-memory database.
"""

import datetime as dt
import uuid
from collections.abc import Iterable
from typing import cast

from sqlalchemy import func, or_, select, update

import forecastbox.db.jobs as _jobs_module
from forecastbox.db.core import dbRetry, executeAndCommit, querySingle
from forecastbox.domain.blueprint.exceptions import BlueprintAccessDenied, BlueprintNotFound, BlueprintVersionConflict
from forecastbox.schemas.jobs import Blueprint, BlueprintSource
from forecastbox.utility.auth import AuthContext


async def upsert_blueprint(
    *,
    auth_context: AuthContext,
    blueprint_id: str | None = None,
    source: BlueprintSource,
    created_by: str | None,
    blocks: dict | None = None,
    environment_spec: dict | None = None,
    display_name: str | None = None,
    display_description: str | None = None,
    tags: list[str] | None = None,
    parent_id: str | None = None,
    expected_version: int | None = None,
) -> tuple[str, int]:
    """Insert a new version of a Blueprint and return ``(id, version)``.

    If ``blueprint_id`` is omitted a fresh UUID is generated (version 1).
    If ``blueprint_id`` is supplied the next version is derived from the DB;
    raises ``BlueprintNotFound`` if it does not exist yet,
    ``BlueprintAccessDenied`` if the actor is not the owner or an admin, and
    ``BlueprintVersionConflict`` if ``expected_version`` is provided and does not
    match the current maximum version.
    """
    id_provided = blueprint_id is not None
    blueprint_id = blueprint_id or str(uuid.uuid4())
    ref_time = dt.datetime.now()

    async def function(i: int) -> int:
        async with _jobs_module.async_session_maker() as session:
            result = await session.execute(select(func.max(Blueprint.version)).where(Blueprint.blueprint_id == blueprint_id))
            max_version: int | None = result.scalar()

            if id_provided:
                if max_version is None:
                    raise BlueprintNotFound(f"No Blueprint with id={blueprint_id!r} exists; cannot add a new version.")
                if expected_version is not None and max_version != expected_version:
                    raise BlueprintVersionConflict(
                        f"Version conflict for Blueprint {blueprint_id!r}: expected version {expected_version}, current is {max_version}."
                    )
                # Ownership check on the latest (non-deleted) version.
                owner_query = (
                    select(Blueprint.created_by)
                    .where(
                        Blueprint.blueprint_id == blueprint_id,
                        Blueprint.is_deleted.is_(False),
                    )
                    .order_by(Blueprint.version.desc())
                    .limit(1)
                )
                owner_result = await session.execute(owner_query)
                row = owner_result.first()
                if row is not None:
                    owner: str | None = row[0]
                    if not auth_context.allowed(owner):
                        raise BlueprintAccessDenied(f"User {auth_context.user_id!r} is not allowed to modify Blueprint {blueprint_id!r}.")

            new_version = (max_version or 0) + 1
            session.add(
                Blueprint(
                    blueprint_id=blueprint_id,
                    version=new_version,
                    created_by=created_by,
                    created_at=ref_time,
                    source=source,
                    parent_id=parent_id,
                    display_name=display_name,
                    display_description=display_description,
                    tags=tags,
                    blocks=blocks,
                    environment_spec=environment_spec,
                    is_deleted=False,
                )
            )
            await session.commit()
            return new_version

    new_version = await dbRetry(function)
    return blueprint_id, new_version


async def get_blueprint(blueprint_id: str, version: int | None = None) -> Blueprint | None:
    """Return a specific or the latest non-deleted version of a Blueprint.

    No authorization is applied; possession of the blueprint ID is treated as
    sufficient read access.
    """
    if version is not None:
        query = select(Blueprint).where(
            Blueprint.blueprint_id == blueprint_id,
            Blueprint.version == version,
            Blueprint.is_deleted.is_(False),
        )
    else:
        query = (
            select(Blueprint)
            .where(
                Blueprint.blueprint_id == blueprint_id,
                Blueprint.is_deleted.is_(False),
            )
            .order_by(Blueprint.version.desc())
            .limit(1)
        )
    return await querySingle(query, _jobs_module.async_session_maker)


async def list_blueprints(*, auth_context: AuthContext) -> Iterable[Blueprint]:
    """Return the latest non-deleted version of every Blueprint visible to the caller.

    Admins and passthrough callers (``auth_context.has_admin()``) see all blueprints.
    Authenticated non-admin users see only their own blueprints and plugin templates.
    """

    async def function(i: int) -> list[Blueprint]:
        async with _jobs_module.async_session_maker() as session:
            subq = (
                select(
                    Blueprint.blueprint_id,
                    func.max(Blueprint.version).label("max_version"),
                )
                .where(Blueprint.is_deleted.is_(False))
                .group_by(Blueprint.blueprint_id)
                .subquery()
            )
            query = select(Blueprint).join(
                subq,
                (Blueprint.blueprint_id == subq.c.blueprint_id) & (Blueprint.version == subq.c.max_version),
            )
            if not auth_context.has_admin():
                query = query.where(
                    or_(
                        Blueprint.source == "plugin_template",
                        Blueprint.created_by == auth_context.user_id,
                    )
                )
            result = await session.execute(query)
            return [r[0] for r in result.all()]

    return await dbRetry(function)


async def soft_delete_blueprint(blueprint_id: str, *, expected_version: int, auth_context: AuthContext) -> None:
    """Mark all versions of a Blueprint as deleted.

    Raises ``BlueprintNotFound`` if the blueprint does not exist,
    ``BlueprintAccessDenied`` if the actor is not the owner or an admin, and
    ``BlueprintVersionConflict`` if ``expected_version`` does not match the
    current latest version.
    """
    existing = await get_blueprint(blueprint_id)
    if existing is None:
        raise BlueprintNotFound(f"No Blueprint with id={blueprint_id!r}.")
    if cast(int, existing.version) != expected_version:
        raise BlueprintVersionConflict(
            f"Version conflict for Blueprint {blueprint_id!r}: expected version {expected_version}, current is {existing.version}."
        )
    if not auth_context.allowed(cast(str | None, existing.created_by)):
        raise BlueprintAccessDenied(f"User {auth_context.user_id!r} is not allowed to delete Blueprint {blueprint_id!r}.")
    stmt = update(Blueprint).where(Blueprint.blueprint_id == blueprint_id).values(is_deleted=True)
    await executeAndCommit(stmt, _jobs_module.async_session_maker)
