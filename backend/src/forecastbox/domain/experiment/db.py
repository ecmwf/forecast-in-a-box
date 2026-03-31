# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Persistence layer for ExperimentDefinition, with auth-scoped authorization.

Uses the same session maker as ``forecastbox.db.jobs`` so that all tables
share a single SQLite connection pool and in-process tests can monkeypatch
a single ``async_session_maker`` attribute to inject an in-memory database.
"""

import datetime as dt
import uuid
from collections.abc import Iterable
from typing import cast

from sqlalchemy import func, select, update

import forecastbox.db.jobs as _jobs_module
from forecastbox.db.core import dbRetry, executeAndCommit, querySingle
from forecastbox.domain.experiment.exceptions import ExperimentAccessDenied, ExperimentNotFound
from forecastbox.schemas.jobs import ExperimentDefinition, ExperimentType
from forecastbox.utility.auth import AuthContext


async def upsert_experiment_definition(
    *,
    auth_context: AuthContext,
    experiment_definition_id: str | None = None,
    job_definition_id: str,
    job_definition_version: int,
    experiment_type: ExperimentType,
    created_by: str | None,
    experiment_definition: dict | None = None,
    display_name: str | None = None,
    display_description: str | None = None,
    tags: list[str] | None = None,
) -> tuple[str, int]:
    """Insert a new version of an ExperimentDefinition and return ``(id, version)``.

    If ``experiment_definition_id`` is omitted a fresh UUID is generated (version 1).
    Requires an authenticated actor (``actor.user_id`` must not be ``None``) for
    creates.  For updates, additionally checks that the actor is the owner or admin,
    raising ``ExperimentAccessDenied`` otherwise.  Raises ``ExperimentNotFound`` if
    an ``experiment_definition_id`` is given but does not exist.
    """
    id_provided = experiment_definition_id is not None
    experiment_id = experiment_definition_id or str(uuid.uuid4())
    ref_time = dt.datetime.now()

    if not id_provided and auth_context.user_id is None:
        raise ExperimentAccessDenied("Unauthenticated callers may not create experiment definitions.")

    async def function(i: int) -> int:
        async with _jobs_module.async_session_maker() as session:
            result = await session.execute(
                select(func.max(ExperimentDefinition.version)).where(ExperimentDefinition.experiment_definition_id == experiment_id)
            )
            max_version: int | None = result.scalar()

            if id_provided:
                if max_version is None:
                    raise ExperimentNotFound(f"No ExperimentDefinition with id={experiment_id!r} exists; cannot add a new version.")
                owner_query = (
                    select(ExperimentDefinition.created_by)
                    .where(
                        ExperimentDefinition.experiment_definition_id == experiment_id,
                        ExperimentDefinition.is_deleted.is_(False),
                    )
                    .order_by(ExperimentDefinition.version.desc())
                    .limit(1)
                )
                owner_result = await session.execute(owner_query)
                row = owner_result.first()
                if row is not None:
                    owner: str | None = row[0]
                    if not auth_context.allowed(owner):
                        raise ExperimentAccessDenied(
                            f"User {auth_context.user_id!r} is not allowed to modify ExperimentDefinition {experiment_id!r}."
                        )

            new_version = (max_version or 0) + 1
            session.add(
                ExperimentDefinition(
                    experiment_definition_id=experiment_id,
                    version=new_version,
                    created_by=created_by,
                    created_at=ref_time,
                    display_name=display_name,
                    display_description=display_description,
                    tags=tags,
                    job_definition_id=job_definition_id,
                    job_definition_version=job_definition_version,
                    experiment_type=experiment_type,
                    experiment_definition=experiment_definition,
                    is_deleted=False,
                )
            )
            await session.commit()
            return new_version

    new_version = await dbRetry(function)
    return experiment_id, new_version


async def get_experiment_definition(experiment_definition_id: str, version: int | None = None) -> ExperimentDefinition | None:
    """Return a specific or the latest non-deleted version of an ExperimentDefinition.

    No authorization is applied; possession of the experiment ID is treated as
    sufficient read access.
    """
    if version is not None:
        query = select(ExperimentDefinition).where(
            ExperimentDefinition.experiment_definition_id == experiment_definition_id,
            ExperimentDefinition.version == version,
            ExperimentDefinition.is_deleted.is_(False),
        )
    else:
        query = (
            select(ExperimentDefinition)
            .where(
                ExperimentDefinition.experiment_definition_id == experiment_definition_id,
                ExperimentDefinition.is_deleted.is_(False),
            )
            .order_by(ExperimentDefinition.version.desc())
            .limit(1)
        )
    return await querySingle(query, _jobs_module.async_session_maker)


async def list_experiment_definitions(
    *,
    auth_context: AuthContext,
    experiment_type: str | None = None,
    offset: int = 0,
    limit: int | None = None,
) -> Iterable[ExperimentDefinition]:
    """Return the latest non-deleted version of every ExperimentDefinition visible to the actor.

    Admins see all.  Authenticated users see only their own definitions.
    Unauthenticated callers receive an empty result.
    """
    if not auth_context.is_admin and auth_context.user_id is None:
        return []

    async def function(i: int) -> list[ExperimentDefinition]:
        async with _jobs_module.async_session_maker() as session:
            subq = (
                select(
                    ExperimentDefinition.experiment_definition_id,
                    func.max(ExperimentDefinition.version).label("max_version"),
                )
                .where(ExperimentDefinition.is_deleted.is_(False))
                .group_by(ExperimentDefinition.experiment_definition_id)
                .subquery()
            )
            query = select(ExperimentDefinition).join(
                subq,
                (ExperimentDefinition.experiment_definition_id == subq.c.experiment_definition_id)
                & (ExperimentDefinition.version == subq.c.max_version),
            )
            if experiment_type is not None:
                query = query.where(ExperimentDefinition.experiment_type == experiment_type)
            if not auth_context.is_admin:
                query = query.where(ExperimentDefinition.created_by == auth_context.user_id)
            query = query.offset(offset)
            if limit is not None:
                query = query.limit(limit)
            result = await session.execute(query)
            return [r[0] for r in result.all()]

    return await dbRetry(function)


async def count_experiment_definitions(
    *,
    auth_context: AuthContext,
    experiment_type: str | None = None,
) -> int:
    """Return the number of distinct non-deleted ExperimentDefinition ids visible to the actor."""
    if not auth_context.is_admin and auth_context.user_id is None:
        return 0

    async def function(i: int) -> int:
        async with _jobs_module.async_session_maker() as session:
            subq = (
                select(
                    ExperimentDefinition.experiment_definition_id,
                    func.max(ExperimentDefinition.version).label("max_version"),
                )
                .where(ExperimentDefinition.is_deleted.is_(False))
                .group_by(ExperimentDefinition.experiment_definition_id)
                .subquery()
            )
            inner = select(ExperimentDefinition.experiment_definition_id).join(
                subq,
                (ExperimentDefinition.experiment_definition_id == subq.c.experiment_definition_id)
                & (ExperimentDefinition.version == subq.c.max_version),
            )
            if experiment_type is not None:
                inner = inner.where(ExperimentDefinition.experiment_type == experiment_type)
            if not auth_context.is_admin:
                inner = inner.where(ExperimentDefinition.created_by == auth_context.user_id)
            query = select(func.count()).select_from(inner.subquery())
            result = await session.execute(query)
            return result.scalar() or 0

    return await dbRetry(function)


async def soft_delete_experiment_definition(experiment_id: str, *, auth_context: AuthContext) -> None:
    """Mark all versions of an ExperimentDefinition as deleted.

    Raises ``ExperimentNotFound`` if the definition does not exist, and
    ``ExperimentAccessDenied`` if the actor is not the owner or an admin.
    """
    existing = await get_experiment_definition(experiment_id)
    if existing is None:
        raise ExperimentNotFound(f"No ExperimentDefinition with id={experiment_id!r}.")
    if not auth_context.allowed(cast(str | None, existing.created_by)):
        raise ExperimentAccessDenied(f"User {auth_context.user_id!r} is not allowed to delete ExperimentDefinition {experiment_id!r}.")
    stmt = update(ExperimentDefinition).where(ExperimentDefinition.experiment_definition_id == experiment_id).values(is_deleted=True)
    await executeAndCommit(stmt, _jobs_module.async_session_maker)
