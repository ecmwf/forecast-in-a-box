# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Persistence layer for JobDefinition, with auth-scoped authorization.

Uses the same session maker as ``forecastbox.db.jobs`` so that all tables
share a single SQLite connection pool and in-process tests can monkeypatch
a single ``async_session_maker`` attribute to inject an in-memory database.
"""

import datetime as dt
import uuid
from collections.abc import Iterable

from sqlalchemy import func, or_, select, update

import forecastbox.db.jobs as _jobs_module
from forecastbox.db.core import dbRetry, executeAndCommit, querySingle
from forecastbox.domain.job_definition.exceptions import JobDefinitionAccessDenied, JobDefinitionNotFound
from forecastbox.schemas.jobs import JobDefinition, JobDefinitionSource
from forecastbox.utility.auth import AuthContext


async def upsert_job_definition(
    *,
    actor: AuthContext,
    definition_id: str | None = None,
    source: JobDefinitionSource,
    created_by: str | None,
    blocks: dict | None = None,
    environment_spec: dict | None = None,
    display_name: str | None = None,
    display_description: str | None = None,
    tags: list[str] | None = None,
    parent_id: str | None = None,
) -> tuple[str, int]:
    """Insert a new version of a JobDefinition and return ``(id, version)``.

    If ``definition_id`` is omitted a fresh UUID is generated (version 1).
    If ``definition_id`` is supplied the next version is derived from the DB;
    raises ``JobDefinitionNotFound`` if it does not exist yet, and
    ``JobDefinitionAccessDenied`` if the actor is not the owner or an admin.
    """
    id_provided = definition_id is not None
    definition_id = definition_id or str(uuid.uuid4())
    ref_time = dt.datetime.now()

    async def function(i: int) -> int:
        async with _jobs_module.async_session_maker() as session:
            result = await session.execute(select(func.max(JobDefinition.version)).where(JobDefinition.job_definition_id == definition_id))
            max_version: int | None = result.scalar()

            if id_provided:
                if max_version is None:
                    raise JobDefinitionNotFound(f"No JobDefinition with id={definition_id!r} exists; cannot add a new version.")
                # Ownership check on the latest (non-deleted) version.
                owner_query = (
                    select(JobDefinition.created_by)
                    .where(
                        JobDefinition.job_definition_id == definition_id,
                        JobDefinition.is_deleted.is_(False),
                    )
                    .order_by(JobDefinition.version.desc())
                    .limit(1)
                )
                owner_result = await session.execute(owner_query)
                row = owner_result.first()
                if row is not None:
                    owner: str | None = row[0]
                    if not actor.is_admin and actor.user_id != owner:
                        raise JobDefinitionAccessDenied(f"User {actor.user_id!r} is not allowed to modify JobDefinition {definition_id!r}.")

            new_version = (max_version or 0) + 1
            session.add(
                JobDefinition(
                    job_definition_id=definition_id,
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
    return definition_id, new_version


async def get_job_definition(definition_id: str, version: int | None = None) -> JobDefinition | None:
    """Return a specific or the latest non-deleted version of a JobDefinition.

    No authorization is applied; possession of the job definition ID is treated as
    sufficient read access.
    """
    if version is not None:
        query = select(JobDefinition).where(
            JobDefinition.job_definition_id == definition_id,
            JobDefinition.version == version,
            JobDefinition.is_deleted.is_(False),
        )
    else:
        query = (
            select(JobDefinition)
            .where(
                JobDefinition.job_definition_id == definition_id,
                JobDefinition.is_deleted.is_(False),
            )
            .order_by(JobDefinition.version.desc())
            .limit(1)
        )
    return await querySingle(query, _jobs_module.async_session_maker)


async def list_job_definitions(*, actor: AuthContext) -> Iterable[JobDefinition]:
    """Return the latest non-deleted version of every JobDefinition visible to the actor.

    Admins see all definitions.  Non-admins see only their own definitions and
    plugin templates.  Unauthenticated callers (``actor.user_id`` is ``None``)
    see only plugin templates.
    """

    async def function(i: int) -> list[JobDefinition]:
        async with _jobs_module.async_session_maker() as session:
            subq = (
                select(
                    JobDefinition.job_definition_id,
                    func.max(JobDefinition.version).label("max_version"),
                )
                .where(JobDefinition.is_deleted.is_(False))
                .group_by(JobDefinition.job_definition_id)
                .subquery()
            )
            query = select(JobDefinition).join(
                subq,
                (JobDefinition.job_definition_id == subq.c.job_definition_id) & (JobDefinition.version == subq.c.max_version),
            )
            if not actor.is_admin:
                if actor.user_id is not None:
                    query = query.where(
                        or_(
                            JobDefinition.source == "plugin_template",
                            JobDefinition.created_by == actor.user_id,
                        )
                    )
                else:
                    query = query.where(JobDefinition.source == "plugin_template")
            result = await session.execute(query)
            return [r[0] for r in result.all()]

    return await dbRetry(function)


async def soft_delete_job_definition(definition_id: str, *, actor: AuthContext) -> None:
    """Mark all versions of a JobDefinition as deleted.

    Raises ``JobDefinitionNotFound`` if the definition does not exist,
    and ``JobDefinitionAccessDenied`` if the actor is not the owner or an admin.
    """
    existing = await get_job_definition(definition_id)
    if existing is None:
        raise JobDefinitionNotFound(f"No JobDefinition with id={definition_id!r}.")
    if not actor.is_admin and actor.user_id != existing.created_by:
        raise JobDefinitionAccessDenied(f"User {actor.user_id!r} is not allowed to delete JobDefinition {definition_id!r}.")
    stmt = update(JobDefinition).where(JobDefinition.job_definition_id == definition_id).values(is_deleted=True)
    await executeAndCommit(stmt, _jobs_module.async_session_maker)
