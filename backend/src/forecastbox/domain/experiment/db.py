# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Persistence layer for ExperimentDefinition, with auth-scoped authorization.

Uses the same session maker as ``forecastbox.schemata.jobs`` so that all tables
share a single SQLite connection pool and in-process tests can monkeypatch
a single ``async_session_maker`` attribute to inject an in-memory database.
"""

import datetime as dt
import uuid
from collections.abc import Iterable
from typing import cast

from sqlalchemy import func, select, update

import forecastbox.schemata.jobs as _jobs_module
from forecastbox.domain.blueprint.types import BlueprintId
from forecastbox.domain.experiment.exceptions import ExperimentAccessDenied, ExperimentNotFound
from forecastbox.domain.experiment.types import ExperimentDefinitionId
from forecastbox.schemata.jobs import ExperimentDefinition, ExperimentType
from forecastbox.utility.auth import AuthContext
from forecastbox.utility.db import dbRetry, executeAndCommit, querySingle
from forecastbox.utility.time import current_time


async def upsert_experiment_definition(
    *,
    auth_context: AuthContext,
    experiment_definition_id: ExperimentDefinitionId | None = None,
    blueprint_id: BlueprintId,
    blueprint_version: int,
    experiment_type: ExperimentType,
    created_by: str,
    experiment_definition: dict | None = None,
    display_name: str | None = None,
    display_description: str | None = None,
    tags: list[str] | None = None,
) -> tuple[ExperimentDefinitionId, int]:
    """Insert a new version of an ExperimentDefinition and return ``(id, version)``.

    If ``experiment_definition_id`` is omitted a fresh UUID is generated (version 1).
    For updates, checks that the caller is the owner or has admin access (via
    ``auth_context.allowed()``), raising ``ExperimentAccessDenied`` otherwise.
    Raises ``ExperimentNotFound`` if an ``experiment_definition_id`` is given but
    does not exist.
    """
    id_provided = experiment_definition_id is not None
    experiment_id = experiment_definition_id if experiment_definition_id is not None else ExperimentDefinitionId(str(uuid.uuid4()))
    ref_time = current_time("dbref")

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
                    owner: str = row[0]
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
                    blueprint_id=blueprint_id,
                    blueprint_version=blueprint_version,
                    experiment_type=experiment_type,
                    experiment_definition=experiment_definition,
                    is_deleted=False,
                )
            )
            await session.commit()
            return new_version

    new_version = await dbRetry(function)
    return experiment_id, new_version


async def get_experiment_definition(
    experiment_definition_id: ExperimentDefinitionId, version: int | None = None
) -> ExperimentDefinition | None:
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


async def get_experiment_definition_created_at(experiment_definition_id: ExperimentDefinitionId) -> dt.datetime | None:
    """Return the creation time of the first (oldest) version of an ExperimentDefinition.

    This is the entity-level ``created_at``, as distinct from a specific
    version's own ``created_at`` (which corresponds to the entity's
    ``updated_at`` for that version). Returns ``None`` if no version exists.
    """
    query = select(func.min(ExperimentDefinition.created_at)).where(
        ExperimentDefinition.experiment_definition_id == experiment_definition_id
    )

    async def function(i: int) -> dt.datetime | None:
        async with _jobs_module.async_session_maker() as session:
            result = await session.execute(query)
            return result.scalar()

    return await dbRetry(function)


class ExperimentListRow:
    """An ExperimentDefinition (latest visible version) paired with the entity's true creation time."""

    __slots__ = ("experiment", "created_at")

    def __init__(self, experiment: ExperimentDefinition, created_at: dt.datetime) -> None:
        self.experiment = experiment
        self.created_at = created_at


async def list_experiment_definitions(
    *,
    auth_context: AuthContext,
    experiment_type: str | None = None,
    offset: int = 0,
    limit: int | None = None,
) -> Iterable[ExperimentListRow]:
    """Return the latest non-deleted version of every ExperimentDefinition visible to the caller.

    Admins and passthrough callers (``auth_context.has_admin()``) see all experiment definitions.
    Authenticated non-admin users see only their own experiment definitions.

    Each returned row is paired with the entity's true ``created_at``
    (the first version's creation time), alongside the latest version's own
    ``created_at`` which represents that version's ``updated_at``.
    """

    async def function(i: int) -> list[ExperimentListRow]:
        async with _jobs_module.async_session_maker() as session:
            subq = (
                select(
                    ExperimentDefinition.experiment_definition_id,
                    func.max(ExperimentDefinition.version).label("max_version"),
                    func.min(ExperimentDefinition.created_at).label("first_created_at"),
                )
                .where(ExperimentDefinition.is_deleted.is_(False))
                .group_by(ExperimentDefinition.experiment_definition_id)
                .subquery()
            )
            query = select(ExperimentDefinition, subq.c.first_created_at).join(
                subq,
                (ExperimentDefinition.experiment_definition_id == subq.c.experiment_definition_id)
                & (ExperimentDefinition.version == subq.c.max_version),
            )
            if experiment_type is not None:
                query = query.where(ExperimentDefinition.experiment_type == experiment_type)
            if not auth_context.has_admin():
                query = query.where(ExperimentDefinition.created_by == auth_context.user_id)
            query = query.offset(offset)
            if limit is not None:
                query = query.limit(limit)
            result = await session.execute(query)
            return [ExperimentListRow(experiment=r[0], created_at=r[1]) for r in result.all()]

    return await dbRetry(function)


async def count_experiment_definitions(
    *,
    auth_context: AuthContext,
    experiment_type: str | None = None,
) -> int:
    """Return the number of distinct non-deleted ExperimentDefinition ids visible to the caller.

    Admins and passthrough callers (``auth_context.has_admin()``) count all experiment definitions.
    Authenticated non-admin users count only their own.
    """

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
            if not auth_context.has_admin():
                inner = inner.where(ExperimentDefinition.created_by == auth_context.user_id)
            query = select(func.count()).select_from(inner.subquery())
            result = await session.execute(query)
            return result.scalar() or 0

    return await dbRetry(function)


async def soft_delete_experiment_definition(experiment_id: ExperimentDefinitionId, *, auth_context: AuthContext) -> None:
    """Mark all versions of an ExperimentDefinition as deleted.

    Raises ``ExperimentNotFound`` if the blueprint does not exist, and
    ``ExperimentAccessDenied`` if the actor is not the owner or an admin.
    """
    existing = await get_experiment_definition(experiment_id)
    if existing is None:
        raise ExperimentNotFound(f"No ExperimentDefinition with id={experiment_id!r}.")
    if not auth_context.allowed(cast(str, existing.created_by)):
        raise ExperimentAccessDenied(f"User {auth_context.user_id!r} is not allowed to delete ExperimentDefinition {experiment_id!r}.")
    stmt = update(ExperimentDefinition).where(ExperimentDefinition.experiment_definition_id == experiment_id).values(is_deleted=True)
    await executeAndCommit(stmt, _jobs_module.async_session_maker)
