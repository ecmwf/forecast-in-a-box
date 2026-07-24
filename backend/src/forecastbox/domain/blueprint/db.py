# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Synchronous persistence helpers for Blueprint.

Each helper owns its session and transaction and must be submitted to the
``ConcurrentPools.JobsDb`` worker by a route, service, or background-thread
orchestrator.
"""

import datetime as dt
import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any, cast

from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

import forecastbox.schemata.jobs as _jobs_module
from forecastbox.domain.blueprint.exceptions import BlueprintAccessDenied, BlueprintNotFound, BlueprintVersionConflict
from forecastbox.domain.blueprint.types import BlueprintId
from forecastbox.domain.plugin.compatibility import get_fiabcore_version
from forecastbox.schemata.jobs import Blueprint, BlueprintSource
from forecastbox.utility.auth import AuthContext
from forecastbox.utility.db import dbRetry
from forecastbox.utility.time import current_time


@dataclass(frozen=True, eq=True, slots=True)
class BlueprintRecord:
    blueprint_id: str
    version: int
    created_by: str
    created_at: dt.datetime
    source: BlueprintSource
    parent_id: str | None
    display_name: str | None
    display_description: str | None
    tags: list[dict[str, Any]] | None
    builder: dict[str, Any] | None
    fiabcore_major: int
    is_deleted: bool


@dataclass(frozen=True, eq=True, slots=True)
class BlueprintLatest:
    """A visible version paired with the entity's true creation time."""

    blueprint: BlueprintRecord
    created_at: dt.datetime


def _to_record(row: Blueprint) -> BlueprintRecord:
    return BlueprintRecord(
        blueprint_id=cast(str, row.blueprint_id),
        version=cast(int, row.version),
        created_by=cast(str, row.created_by),
        created_at=cast(dt.datetime, row.created_at),
        source=cast(BlueprintSource, row.source),
        parent_id=cast(str | None, row.parent_id),
        display_name=cast(str | None, row.display_name),
        display_description=cast(str | None, row.display_description),
        tags=cast(list[dict[str, Any]] | None, row.tags),
        builder=cast(dict[str, Any] | None, row.builder),
        fiabcore_major=cast(int, row.fiabcore_major),
        is_deleted=cast(bool, row.is_deleted),
    )


def upsert_blueprint(
    *,
    auth_context: AuthContext,
    blueprint_id: BlueprintId | None = None,
    source: BlueprintSource,
    created_by: str,
    builder: dict[str, Any] | None = None,
    display_name: str | None = None,
    display_description: str | None = None,
    tags: list[dict[str, Any]] | None = None,
    parent_id: str | None = None,
    expected_version: int | None = None,
) -> tuple[BlueprintId, int]:
    """Insert a new version of a Blueprint and return ``(id, version)``."""
    id_provided = blueprint_id is not None
    effective_blueprint_id = blueprint_id if blueprint_id is not None else BlueprintId(str(uuid.uuid4()))
    ref_time = current_time("dbref")

    def function(i: int) -> int:
        with _jobs_module.session_maker() as session:
            result = session.execute(select(func.max(Blueprint.version)).where(Blueprint.blueprint_id == effective_blueprint_id))
            max_version = cast(int | None, result.scalar())

            if id_provided:
                if max_version is None:
                    raise BlueprintNotFound(f"No Blueprint with id={effective_blueprint_id!r} exists; cannot add a new version.")
                if expected_version is not None and max_version != expected_version:
                    raise BlueprintVersionConflict(
                        f"Version conflict for Blueprint {effective_blueprint_id!r}: expected version {expected_version}, current is {max_version}."
                    )
                owner_query = (
                    select(Blueprint.created_by)
                    .where(
                        Blueprint.blueprint_id == effective_blueprint_id,
                        Blueprint.is_deleted.is_(False),
                    )
                    .order_by(Blueprint.version.desc())
                    .limit(1)
                )
                owner_result = session.execute(owner_query)
                row = owner_result.first()
                if row is not None:
                    owner = cast(str, row[0])
                    if not auth_context.allowed(owner):
                        raise BlueprintAccessDenied(
                            f"User {auth_context.user_id!r} is not allowed to modify Blueprint {effective_blueprint_id!r}."
                        )

            new_version = (max_version or 0) + 1
            session.add(
                Blueprint(
                    blueprint_id=effective_blueprint_id,
                    version=new_version,
                    created_by=created_by,
                    created_at=ref_time,
                    source=source,
                    parent_id=parent_id,
                    display_name=display_name,
                    display_description=display_description,
                    tags=tags,
                    builder=builder,
                    fiabcore_major=get_fiabcore_version().major,
                    is_deleted=False,
                )
            )
            session.commit()
            return new_version

    new_version = dbRetry(function)
    return effective_blueprint_id, new_version


def get_blueprint(blueprint_id: BlueprintId, version: int | None = None) -> BlueprintRecord | None:
    """Return a specific or the latest non-deleted version of a Blueprint."""

    def function(i: int) -> BlueprintRecord | None:
        with _jobs_module.session_maker() as session:
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
            row = session.execute(query).scalar_one_or_none()
            return None if row is None else _to_record(row)

    return dbRetry(function)


def list_blueprints(
    *,
    auth_context: AuthContext,
    offset: int = 0,
    limit: int | None = None,
    created_by: str | None = None,
    source: BlueprintSource | None = None,
    blueprint_id: BlueprintId | None = None,
    version: int | None = None,
) -> Iterable[BlueprintLatest]:
    """Return the latest (or a pinned) visible version of each Blueprint."""

    def function(i: int) -> list[BlueprintLatest]:
        with _jobs_module.session_maker() as session:
            subq = select(
                Blueprint.blueprint_id,
                func.max(Blueprint.version).label("max_version"),
                func.min(Blueprint.created_at).label("first_created_at"),
            ).where(Blueprint.is_deleted.is_(False))
            if blueprint_id is not None:
                subq = subq.where(Blueprint.blueprint_id == blueprint_id)
            subq = subq.group_by(Blueprint.blueprint_id).subquery()

            join_condition = Blueprint.blueprint_id == subq.c.blueprint_id
            if version is not None:
                join_condition = join_condition & (Blueprint.version == version)
            else:
                join_condition = join_condition & (Blueprint.version == subq.c.max_version)

            query = select(Blueprint, subq.c.first_created_at).join(subq, join_condition)
            if not auth_context.has_admin():
                query = query.where(
                    or_(
                        Blueprint.source == "plugin_template",
                        Blueprint.created_by == auth_context.user_id,
                    )
                )
            if created_by is not None:
                query = query.where(Blueprint.created_by == created_by)
            if source is not None:
                query = query.where(Blueprint.source == source)
            query = query.order_by(Blueprint.created_at.desc()).offset(offset)
            if limit is not None:
                query = query.limit(limit)
            result = session.execute(query)
            return [BlueprintLatest(blueprint=_to_record(row[0]), created_at=cast(dt.datetime, row[1])) for row in result.all()]

    return dbRetry(function)


def count_blueprints(*, auth_context: AuthContext, created_by: str | None = None, source: BlueprintSource | None = None) -> int:
    """Return the total number of distinct non-deleted Blueprint ids visible to the actor."""

    def function(i: int) -> int:
        with _jobs_module.session_maker() as session:
            query = select(func.count(func.distinct(Blueprint.blueprint_id))).where(Blueprint.is_deleted.is_(False))
            if not auth_context.has_admin():
                query = query.where(
                    or_(
                        Blueprint.source == "plugin_template",
                        Blueprint.created_by == auth_context.user_id,
                    )
                )
            if created_by is not None:
                query = query.where(Blueprint.created_by == created_by)
            if source is not None:
                query = query.where(Blueprint.source == source)
            result = session.execute(query)
            return cast(int, result.scalar() or 0)

    return dbRetry(function)


def find_plugin_template_id(*, created_by: str, display_name: str) -> BlueprintId | None:
    """Return the latest non-deleted plugin-template blueprint id for one display name."""

    def function(i: int) -> BlueprintId | None:
        with _jobs_module.session_maker() as session:
            query = (
                select(Blueprint.blueprint_id)
                .where(
                    Blueprint.source == "plugin_template",
                    Blueprint.created_by == created_by,
                    Blueprint.display_name == display_name,
                    Blueprint.is_deleted.is_(False),
                )
                .order_by(Blueprint.version.desc())
                .limit(1)
            )
            result = session.execute(query)
            row = result.first()
            return BlueprintId(str(row[0])) if row is not None else None

    return dbRetry(function)


def soft_delete_blueprint(blueprint_id: BlueprintId, *, expected_version: int, auth_context: AuthContext) -> None:
    """Mark all versions of a Blueprint as deleted."""

    def function(i: int) -> None:
        with _jobs_module.session_maker() as session:
            existing = session.execute(
                select(Blueprint)
                .where(
                    Blueprint.blueprint_id == blueprint_id,
                    Blueprint.is_deleted.is_(False),
                )
                .order_by(Blueprint.version.desc())
                .limit(1)
            ).scalar_one_or_none()
            if existing is None:
                raise BlueprintNotFound(f"No Blueprint with id={blueprint_id!r}.")
            if cast(int, existing.version) != expected_version:
                raise BlueprintVersionConflict(
                    f"Version conflict for Blueprint {blueprint_id!r}: expected version {expected_version}, current is {existing.version}."
                )
            if not auth_context.allowed(cast(str, existing.created_by)):
                raise BlueprintAccessDenied(f"User {auth_context.user_id!r} is not allowed to delete Blueprint {blueprint_id!r}.")
            session.execute(update(Blueprint).where(Blueprint.blueprint_id == blueprint_id).values(is_deleted=True))
            session.commit()

    dbRetry(function)


def soft_delete_plugin_template(*, created_by: str, display_name: str) -> None:
    """Mark all plugin-template rows for one display name as deleted."""

    def function(i: int) -> None:
        with _jobs_module.session_maker() as session:
            session.execute(
                update(Blueprint)
                .where(
                    Blueprint.source == "plugin_template",
                    Blueprint.created_by == created_by,
                    Blueprint.display_name == display_name,
                )
                .values(is_deleted=True)
            )
            session.commit()

    dbRetry(function)


def soft_delete_all_plugin_templates(*, created_by: str) -> None:
    """Mark all plugin-template rows owned by one plugin as deleted."""

    def function(i: int) -> None:
        with _jobs_module.session_maker() as session:
            session.execute(
                update(Blueprint)
                .where(
                    Blueprint.source == "plugin_template",
                    Blueprint.created_by == created_by,
                )
                .values(is_deleted=True)
            )
            session.commit()

    dbRetry(function)
