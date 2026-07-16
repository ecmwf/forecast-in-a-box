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
from dataclasses import dataclass
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
    sufficient read access. This is intentional and relied upon by internal
    callers (scheduling, update/delete write paths, ...) that already possess a
    validated foreign key or have performed their own ownership check. Route
    handlers exposing an ExperimentDefinition to a caller by id must NOT use this
    function -- use ``list_experiment_definitions`` (with ``experiment_definition_id``
    set) instead, which applies the same ownership scoping as the list endpoint.
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


@dataclass
class ExperimentLatest:
    """An ExperimentDefinition (a specific or the latest visible version) paired with the entity's true creation time."""

    experiment: ExperimentDefinition
    created_at: dt.datetime


async def list_experiment_definitions(
    *,
    auth_context: AuthContext,
    experiment_type: str | None = None,
    offset: int = 0,
    limit: int | None = None,
    experiment_definition_id: ExperimentDefinitionId | None = None,
    version: int | None = None,
) -> Iterable[ExperimentLatest]:
    """Return the latest (or a pinned) non-deleted version of every ExperimentDefinition visible to the caller.

    Admins and passthrough callers (``auth_context.has_admin()``) see all experiment definitions.
    Authenticated non-admin users see only their own experiment definitions.

    ``experiment_definition_id`` narrows the result to a single entity; combined
    with ``limit=1`` this backs a single "get" lookup while still applying the
    same ownership scoping as the list endpoint -- there is deliberately no
    separate, unauthenticated single-row query for route handlers (see
    ``get_experiment_definition`` for the internal, unauthenticated equivalent).
    ``version`` optionally pins that entity to a specific version instead of its
    latest one; it is only meaningful together with ``experiment_definition_id``.

    Each returned row is paired with the entity's true ``created_at``
    (the first version's creation time), alongside the returned version's own
    ``created_at`` which represents that version's ``updated_at``.
    """

    async def function(i: int) -> list[ExperimentLatest]:
        async with _jobs_module.async_session_maker() as session:
            subq = select(
                ExperimentDefinition.experiment_definition_id,
                func.max(ExperimentDefinition.version).label("max_version"),
                func.min(ExperimentDefinition.created_at).label("first_created_at"),
            ).where(ExperimentDefinition.is_deleted.is_(False))
            if experiment_definition_id is not None:
                # Safe and cheap to filter here: experiment_definition_id is the GROUP BY key
                # itself, so restricting rows before grouping cannot change
                # max_version/first_created_at for the remaining group -- it just avoids
                # aggregating over every other experiment. NOTE: created_by and
                # experiment_type are deliberately NOT filtered here -- they are attributes of
                # individual version rows, and filtering them pre-aggregation would match "any
                # version satisfies the filter" instead of "the returned version does", and
                # could even change which version is picked as the latest one.
                subq = subq.where(ExperimentDefinition.experiment_definition_id == experiment_definition_id)
            subq = subq.group_by(ExperimentDefinition.experiment_definition_id).subquery()

            if version is not None:
                join_condition = (ExperimentDefinition.experiment_definition_id == subq.c.experiment_definition_id) & (
                    ExperimentDefinition.version == version
                )
            else:
                join_condition = (ExperimentDefinition.experiment_definition_id == subq.c.experiment_definition_id) & (
                    ExperimentDefinition.version == subq.c.max_version
                )

            query = select(ExperimentDefinition, subq.c.first_created_at).join(subq, join_condition)
            if experiment_type is not None:
                query = query.where(ExperimentDefinition.experiment_type == experiment_type)
            if not auth_context.has_admin():
                query = query.where(ExperimentDefinition.created_by == auth_context.user_id)
            query = query.offset(offset)
            if limit is not None:
                query = query.limit(limit)
            result = await session.execute(query)
            return [ExperimentLatest(experiment=r[0], created_at=r[1]) for r in result.all()]

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
