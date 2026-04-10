# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""ORM models and database setup for the jobs database.

Tables are versioned/immutable (Blueprint, ExperimentDefinition) or
append-only with a mutable runtime state (Run).  Soft-delete is
supported on all main tables via `is_deleted`.

Exposes ``create_db_and_tables`` so the entrypoint can discover and run it
via automatic schemata iteration.
# TODO for later: implement garbage collection
"""

from typing import Literal

from sqlalchemy import JSON, Boolean, Column, DateTime, ForeignKeyConstraint, Integer, String, UniqueConstraint
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from forecastbox.utility.config import config

BlueprintSource = Literal["plugin_template", "user_defined", "oneoff_execution"]
ExperimentType = Literal["cron_schedule", "batch_execution", "external_trigger"]
RunStatus = Literal["submitted", "preparing", "running", "completed", "failed"]


class Base(DeclarativeBase):
    pass


class Blueprint(Base):
    """Captures everything needed to execute a job.

    Immutable once written; a new version is appended for each save.
    The composite primary key is (blueprint_id, version).  `source` distinguishes
    plugin templates, user-defined blueprints, and one-off runs.
    `parent_id` tracks lineage without pinning a version.
    """

    __tablename__ = "blueprint"

    blueprint_id = Column(String(255), primary_key=True, nullable=False)
    version = Column(Integer, primary_key=True, nullable=False)
    created_by = Column(String(255), nullable=True)
    created_at = Column(DateTime, nullable=False)

    # TODO later -- make sure entity validates this
    source = Column(String(64), nullable=False)
    # Optional lineage reference – deliberately no version to keep it discoverable
    parent_id = Column(String(255), nullable=True)

    display_name = Column(String(255), nullable=True)
    display_description = Column(String(1024), nullable=True)
    tags = Column(JSON, nullable=True)

    # stores the forecastbox.domain.blueprint.BlueprintBuilder
    blocks = Column(JSON, nullable=True)
    # stores the forecastbox.domain.blueprint.cascade.EnvironmentSpecification
    environment_spec = Column(JSON, nullable=True)
    # stores local glyphs dict[str, str] from BlueprintBuilder
    local_glyphs = Column(JSON, nullable=True)

    is_deleted = Column(Boolean, nullable=False, default=False)


class GlobalGlyph(Base):
    """A user-defined glyph available for interpolation in all blueprint configurations.

    Each key is unique; upsert replaces the value when the key already exists.
    """

    __tablename__ = "global_glyph"

    global_glyph_id = Column(String(255), primary_key=True, nullable=False)
    key = Column(String(255), nullable=False)
    value = Column(String(1024), nullable=False)
    public = Column(Boolean, nullable=False, default=False)
    created_by = Column(String(255), nullable=True)
    created_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False)

    __table_args__ = (UniqueConstraint("key", name="uq_global_glyph_key"),)


class ExperimentDefinition(Base):
    """Captures that a Blueprint should execute multiple times.

    Immutable; composite primary key is (experiment_definition_id, version).
    `experiment_type` is one of: cron_schedule | batch_execution | external_trigger.
    `experiment_definition` is a JSON blob whose schema depends on the type.
    """

    __tablename__ = "experiment_definition"

    experiment_definition_id = Column(String(255), primary_key=True, nullable=False)
    version = Column(Integer, primary_key=True, nullable=False)
    created_by = Column(String(255), nullable=True)
    created_at = Column(DateTime, nullable=False)

    display_name = Column(String(255), nullable=True)
    display_description = Column(String(1024), nullable=True)
    tags = Column(JSON, nullable=True)

    blueprint_id = Column(String(255), nullable=False)
    blueprint_version = Column(Integer, nullable=False)

    # TODO later -- make sure entity validates this
    experiment_type = Column(String(64), nullable=False)
    experiment_definition = Column(JSON, nullable=True)

    is_deleted = Column(Boolean, nullable=False, default=False)

    __table_args__ = (
        ForeignKeyConstraint(
            ["blueprint_id", "blueprint_version"],
            ["blueprint.blueprint_id", "blueprint.version"],
        ),
    )


class Run(Base):
    """A single computation that has happened or is happening.

    Mutable (status, outputs, error, cascade identifiers are written at runtime).
    Composite primary key is (run_id, attempt_count); re-runs share the same `run_id`.
    The optional `experiment_id` links this execution to an experiment.
    `compiler_runtime_context` carries per-execution dynamic values (e.g.
    cron tick time, batch element) that were used to resolve the spec.
    """

    __tablename__ = "run"

    run_id = Column(String(255), primary_key=True, nullable=False)
    attempt_count = Column(Integer, primary_key=True, nullable=False)
    created_by = Column(String(255), nullable=True)
    created_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False)

    blueprint_id = Column(String(255), nullable=False)
    blueprint_version = Column(Integer, nullable=False)

    experiment_id = Column(String(255), nullable=True)
    experiment_version = Column(Integer, nullable=True)
    compiler_runtime_context = Column(JSON, nullable=False)
    experiment_context = Column(String(255), nullable=True)

    # TODO later -- make sure entity validates this
    status = Column(String(50), nullable=False)
    outputs = Column(JSON, nullable=True)
    error = Column(String(255), nullable=True)
    progress = Column(String(255), nullable=True)

    # Filled after successful cascade submission
    cascade_job_id = Column(String(255), nullable=True)
    cascade_proc = Column(Integer, nullable=True)

    is_deleted = Column(Boolean, nullable=False, default=False)

    __table_args__ = (
        ForeignKeyConstraint(
            ["blueprint_id", "blueprint_version"],
            ["blueprint.blueprint_id", "blueprint.version"],
        ),
    )


class ExperimentNext(Base):
    """Mutable table tracking the next scheduled run time for an experiment.

    Kept separate from the immutable ExperimentDefinition so that updating
    the next-run time does not create a new version.
    """

    __tablename__ = "experiment_next"

    experiment_next_id = Column(String(255), primary_key=True, nullable=False)
    experiment_id = Column(String(255), nullable=False, unique=True)
    scheduled_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False)


async_url = f"sqlite+aiosqlite:///{config.db.sqlite_jobdb_path}"
async_engine = create_async_engine(async_url, pool_pre_ping=True)
async_session_maker = async_sessionmaker(async_engine, expire_on_commit=False)


async def create_db_and_tables() -> None:
    """Create the jobs database and all its tables on startup."""
    async with async_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
