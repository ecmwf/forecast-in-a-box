# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""ORM models for the jobs2 database.

Tables are versioned/immutable (JobDefinition, ExperimentDefinition) or
append-only with a mutable runtime state (JobExecution).  Soft-delete is
supported on all main tables via `is_deleted`; garbage collection is out of
scope for this stage.
"""

from sqlalchemy import Boolean, Column, DateTime, ForeignKeyConstraint, Integer, JSON, String
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


class JobDefinition(Base):
    """Captures everything needed to execute a job.

    Immutable once written; a new version is appended for each save.
    The composite primary key is (id, version).  `source` distinguishes
    plugin templates, user-defined definitions, and one-off executions.
    `parent_id` tracks lineage without pinning a version.
    """

    __tablename__ = "job_definition"

    id = Column(String(255), primary_key=True, nullable=False)
    version = Column(Integer, primary_key=True, nullable=False)
    created_by = Column(String(255), nullable=True)
    created_at = Column(DateTime, nullable=False)

    # Extensible string enum: plugin_template | user_defined | oneoff_execution
    source = Column(String(64), nullable=False)
    # Optional lineage reference – deliberately no version to keep it stable
    parent_id = Column(String(255), nullable=True)

    display_name = Column(String(255), nullable=True)
    display_description = Column(String(1024), nullable=True)
    tags = Column(JSON, nullable=True)

    # Payload stored as JSON to avoid over-normalisation
    builder_spec = Column(JSON, nullable=True)

    is_deleted = Column(Boolean, nullable=False, default=False)


class ExperimentDefinition(Base):
    """Captures that a JobDefinition should execute multiple times.

    Immutable; composite primary key is (id, version).
    `experiment_type` is one of: cron_schedule | batch_execution | external_trigger.
    `experiment_definition` is a JSON blob whose schema depends on the type.
    """

    __tablename__ = "experiment_definition"

    id = Column(String(255), primary_key=True, nullable=False)
    version = Column(Integer, primary_key=True, nullable=False)
    created_by = Column(String(255), nullable=True)
    created_at = Column(DateTime, nullable=False)

    display_name = Column(String(255), nullable=True)
    display_description = Column(String(1024), nullable=True)
    tags = Column(JSON, nullable=True)

    job_definition_id = Column(String(255), nullable=False)
    job_definition_version = Column(Integer, nullable=False)

    # Extensible string enum: cron_schedule | batch_execution | external_trigger
    experiment_type = Column(String(64), nullable=False)
    experiment_definition = Column(JSON, nullable=True)

    is_deleted = Column(Boolean, nullable=False, default=False)

    __table_args__ = (
        ForeignKeyConstraint(
            ["job_definition_id", "job_definition_version"],
            ["job_definition.id", "job_definition.version"],
        ),
    )


class JobExecution(Base):
    """A single computation that has happened or is happening.

    Mutable (status, outputs, error, cascade identifiers are written at runtime).
    Composite primary key is (id, attempt_count); re-runs share the same `id`.
    The optional `experiment_id` links this execution to an experiment.
    `compiler_runtime_context` carries per-execution dynamic values (e.g.
    cron tick time, batch element) that were used to resolve the spec.
    """

    __tablename__ = "job_execution"

    id = Column(String(255), primary_key=True, nullable=False)
    attempt_count = Column(Integer, primary_key=True, nullable=False)
    created_by = Column(String(255), nullable=True)
    created_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False)

    job_definition_id = Column(String(255), nullable=False)
    job_definition_version = Column(Integer, nullable=False)

    experiment_id = Column(String(255), nullable=True)
    compiler_runtime_context = Column(JSON, nullable=True)

    status = Column(String(50), nullable=False)
    outputs = Column(JSON, nullable=True)
    error = Column(String(255), nullable=True)
    progress = Column(String(255), nullable=True)

    # Filled after successful cascade submission
    cascade_job_id = Column(String(255), nullable=True)
    cascade_proc = Column(String(255), nullable=True)

    is_deleted = Column(Boolean, nullable=False, default=False)

    __table_args__ = (
        ForeignKeyConstraint(
            ["job_definition_id", "job_definition_version"],
            ["job_definition.id", "job_definition.version"],
        ),
    )


class GlobalDefaults(Base):
    """Stores installation-wide default option and value specs.

    Schema is complete now; business logic is deferred to a future stage.
    """

    __tablename__ = "global_defaults"

    id = Column(String(255), primary_key=True, nullable=False)
    created_by = Column(String(255), nullable=True)
    created_at = Column(DateTime, nullable=False)

    option_specs = Column(JSON, nullable=True)
    value_specs = Column(JSON, nullable=True)


class ExperimentNext(Base):
    """Mutable table tracking the next scheduled run time for an experiment.

    Kept separate from the immutable ExperimentDefinition so that updating
    the next-run time does not create a new version.
    """

    __tablename__ = "experiment_next"

    id = Column(String(255), primary_key=True, nullable=False)
    experiment_id = Column(String(255), nullable=False, unique=True)
    scheduled_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False)
