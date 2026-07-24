# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Synchronous persistence helpers for ExperimentDefinition.

Each helper owns its session and transaction and must be submitted to the
``ConcurrentPools.JobsDb`` worker by a route, service, or background-thread
orchestrator.

Authorization remains helper-specific: route-facing list/update/delete helpers
apply ownership scoping, while ``get_experiment_definition`` is the
intentional internal no-auth lookup documented below.
"""

import datetime as dt
import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any, cast

from sqlalchemy import func, select, update

import forecastbox.schemata.jobs as _jobs_module
from forecastbox.domain.blueprint.types import BlueprintId
from forecastbox.domain.experiment.exceptions import ExperimentAccessDenied, ExperimentNotFound
from forecastbox.domain.experiment.types import ExperimentDefinitionId
from forecastbox.schemata.jobs import ExperimentDefinition, ExperimentType
from forecastbox.utility.auth import AuthContext
from forecastbox.utility.db import dbRetry
from forecastbox.utility.time import current_time


@dataclass(frozen=True, eq=True, slots=True)
class ExperimentDefinitionRecord:
    experiment_definition_id: str
    version: int
    created_by: str
    created_at: dt.datetime
    display_name: str | None
    display_description: str | None
    tags: list[str] | None
    blueprint_id: str
    blueprint_version: int
    experiment_type: ExperimentType
    experiment_definition: dict[str, Any] | None
    is_deleted: bool


@dataclass(frozen=True, eq=True, slots=True)
class ExperimentLatest:
    """A visible ExperimentDefinition version paired with the entity's true creation time."""

    experiment: ExperimentDefinitionRecord
    created_at: dt.datetime


def _to_record(row: ExperimentDefinition) -> ExperimentDefinitionRecord:
    return ExperimentDefinitionRecord(
        experiment_definition_id=cast(str, row.experiment_definition_id),
        version=cast(int, row.version),
        created_by=cast(str, row.created_by),
        created_at=cast(dt.datetime, row.created_at),
        display_name=cast(str | None, row.display_name),
        display_description=cast(str | None, row.display_description),
        tags=cast(list[str] | None, row.tags),
        blueprint_id=cast(str, row.blueprint_id),
        blueprint_version=cast(int, row.blueprint_version),
        experiment_type=cast(ExperimentType, row.experiment_type),
        experiment_definition=cast(dict[str, Any] | None, row.experiment_definition),
        is_deleted=cast(bool, row.is_deleted),
    )


def upsert_experiment_definition(
    *,
    auth_context: AuthContext,
    experiment_definition_id: ExperimentDefinitionId | None = None,
    blueprint_id: BlueprintId,
    blueprint_version: int,
    experiment_type: ExperimentType,
    created_by: str,
    experiment_definition: dict[str, Any] | None = None,
    display_name: str | None = None,
    display_description: str | None = None,
    tags: list[str] | None = None,
) -> tuple[ExperimentDefinitionId, int]:
    """Insert a new version of an ExperimentDefinition and return ``(id, version)``.

    If ``experiment_definition_id`` is omitted a fresh UUID is generated and
    version 1 is inserted. For updates, the caller must own the latest visible
    version or have admin access.

    Raises ``ExperimentNotFound`` if an explicit id does not exist and
    ``ExperimentAccessDenied`` if the actor is not allowed to modify it.
    """
    id_provided = experiment_definition_id is not None
    experiment_id = experiment_definition_id if experiment_definition_id is not None else ExperimentDefinitionId(str(uuid.uuid4()))
    ref_time = current_time("dbref")

    def function(i: int) -> int:
        with _jobs_module.session_maker() as session:
            result = session.execute(
                select(func.max(ExperimentDefinition.version)).where(ExperimentDefinition.experiment_definition_id == experiment_id)
            )
            max_version = cast(int | None, result.scalar())

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
                owner_result = session.execute(owner_query)
                row = owner_result.first()
                if row is not None:
                    owner = cast(str, row[0])
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
            session.commit()
            return new_version

    new_version = dbRetry(function)
    return experiment_id, new_version


def get_experiment_definition(
    experiment_definition_id: ExperimentDefinitionId, version: int | None = None
) -> ExperimentDefinitionRecord | None:
    """Return a specific or the latest non-deleted version of an ExperimentDefinition.

    No authorization is applied; possession of the experiment id is treated as
    sufficient read access. Internal callers rely on this after following a
    validated foreign key or after performing their own ownership check. Route
    handlers exposing an ExperimentDefinition by id must not use this helper.
    Use ``list_experiment_definitions`` with ``experiment_definition_id`` set
    instead so the same ownership scoping as the list endpoint is applied.
    """

    def function(i: int) -> ExperimentDefinitionRecord | None:
        with _jobs_module.session_maker() as session:
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
            row = session.execute(query).scalar_one_or_none()
            return None if row is None else _to_record(row)

    return dbRetry(function)


def list_experiment_definitions(
    *,
    auth_context: AuthContext,
    experiment_type: str | None = None,
    offset: int = 0,
    limit: int | None = None,
    experiment_definition_id: ExperimentDefinitionId | None = None,
    version: int | None = None,
) -> Iterable[ExperimentLatest]:
    """Return the latest or pinned visible version of each ExperimentDefinition.

    Admins and passthrough callers see all experiment definitions.
    Authenticated non-admin users see only their own.

    ``experiment_definition_id`` narrows the result to a single entity.
    Combined with ``limit=1`` it backs the route-layer "get" lookup while
    still applying the same ownership scoping as the list endpoint, so there
    is deliberately no separate unauthenticated single-row query for route
    handlers. ``version`` optionally pins that entity to a specific version
    instead of its latest one; it is only meaningful together with
    ``experiment_definition_id``.

    Each returned row is paired with the entity's true ``created_at`` from the
    first version. The returned version's own ``created_at`` still represents
    that version's effective ``updated_at``.
    """

    def function(i: int) -> list[ExperimentLatest]:
        with _jobs_module.session_maker() as session:
            subq = select(
                ExperimentDefinition.experiment_definition_id,
                func.max(ExperimentDefinition.version).label("max_version"),
                func.min(ExperimentDefinition.created_at).label("first_created_at"),
            ).where(ExperimentDefinition.is_deleted.is_(False))
            if experiment_definition_id is not None:
                # Safe and cheap to filter here: experiment_definition_id is
                # the GROUP BY key itself, so restricting rows before grouping
                # cannot change max_version/first_created_at for the remaining
                # group. Do not move created_by/experiment_type here: they vary
                # per version row, so a pre-aggregation filter would mean "some
                # version matches" and could even change which version is
                # selected as the latest.
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
            result = session.execute(query)
            return [ExperimentLatest(experiment=_to_record(row[0]), created_at=cast(dt.datetime, row[1])) for row in result.all()]

    return dbRetry(function)


def count_experiment_definitions(
    *,
    auth_context: AuthContext,
    experiment_type: str | None = None,
) -> int:
    """Return the number of distinct visible ExperimentDefinition ids.

    Admins and passthrough callers count all experiment definitions.
    Authenticated non-admin users count only their own.
    """

    def function(i: int) -> int:
        with _jobs_module.session_maker() as session:
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
            result = session.execute(query)
            return cast(int, result.scalar() or 0)

    return dbRetry(function)


def soft_delete_experiment_definition(experiment_id: ExperimentDefinitionId, *, auth_context: AuthContext) -> None:
    """Mark all versions of an ExperimentDefinition as deleted.

    Raises ``ExperimentNotFound`` if the experiment does not exist and
    ``ExperimentAccessDenied`` if the actor is not the owner or an admin.
    """

    def function(i: int) -> None:
        with _jobs_module.session_maker() as session:
            existing = session.execute(
                select(ExperimentDefinition)
                .where(
                    ExperimentDefinition.experiment_definition_id == experiment_id,
                    ExperimentDefinition.is_deleted.is_(False),
                )
                .order_by(ExperimentDefinition.version.desc())
                .limit(1)
            ).scalar_one_or_none()
            if existing is None:
                raise ExperimentNotFound(f"No ExperimentDefinition with id={experiment_id!r}.")
            if not auth_context.allowed(cast(str, existing.created_by)):
                raise ExperimentAccessDenied(
                    f"User {auth_context.user_id!r} is not allowed to delete ExperimentDefinition {experiment_id!r}."
                )
            session.execute(
                update(ExperimentDefinition).where(ExperimentDefinition.experiment_definition_id == experiment_id).values(is_deleted=True)
            )
            session.commit()

    dbRetry(function)
