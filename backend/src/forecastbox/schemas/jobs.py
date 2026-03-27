# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""ORM models for the jobs database.

Tables are versioned/immutable (JobDefinition, ExperimentDefinition) or
append-only with a mutable runtime state (JobExecution).  Soft-delete is
supported on all main tables via `is_deleted`.
# TODO for later: implement garbage collection
"""

from typing import Literal

from sqlalchemy import JSON, Boolean, Column, DateTime, ForeignKeyConstraint, Integer, String
from sqlalchemy.orm import DeclarativeBase

JobDefinitionSource = Literal["plugin_template", "user_defined", "oneoff_execution"]
ExperimentType = Literal["cron_schedule", "batch_execution", "external_trigger"]
JobExecutionStatus = Literal["submitted", "preparing", "running", "completed", "failed"]


class Base(DeclarativeBase):
    pass


class JobDefinition(Base):
    """Captures everything needed to execute a job.

    Immutable once written; a new version is appended for each save.
    The composite primary key is (job_definition_id, version).  `source` distinguishes
    plugin templates, user-defined definitions, and one-off executions.
    `parent_id` tracks lineage without pinning a version.
    """

    __tablename__ = "job_definition"

    job_definition_id = Column(String(255), primary_key=True, nullable=False)
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

    # Payload stored as JSON to avoid over-normalisation
    # stores the blocks field of forecastbox.api.types.fable.FableBuilder
    blocks = Column(JSON, nullable=True)
    # stores forecastbox.api.types.jobs.EnvironmentSpecification
    environment_spec = Column(JSON, nullable=True)

    is_deleted = Column(Boolean, nullable=False, default=False)


class ExperimentDefinition(Base):
    """Captures that a JobDefinition should execute multiple times.

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

    job_definition_id = Column(String(255), nullable=False)
    job_definition_version = Column(Integer, nullable=False)

    # TODO later -- make sure entity validates this
    experiment_type = Column(String(64), nullable=False)
    experiment_definition = Column(JSON, nullable=True)

    is_deleted = Column(Boolean, nullable=False, default=False)

    __table_args__ = (
        ForeignKeyConstraint(
            ["job_definition_id", "job_definition_version"],
            ["job_definition.job_definition_id", "job_definition.version"],
        ),
    )


class JobExecution(Base):
    """A single computation that has happened or is happening.

    Mutable (status, outputs, error, cascade identifiers are written at runtime).
    Composite primary key is (job_execution_id, attempt_count); re-runs share the same `job_execution_id`.
    The optional `experiment_id` links this execution to an experiment.
    `compiler_runtime_context` carries per-execution dynamic values (e.g.
    cron tick time, batch element) that were used to resolve the spec.
    """

    __tablename__ = "job_execution"

    job_execution_id = Column(String(255), primary_key=True, nullable=False)
    attempt_count = Column(Integer, primary_key=True, nullable=False)
    created_by = Column(String(255), nullable=True)
    created_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False)

    job_definition_id = Column(String(255), nullable=False)
    job_definition_version = Column(Integer, nullable=False)

    experiment_id = Column(String(255), nullable=True)
    experiment_version = Column(Integer, nullable=True)
    compiler_runtime_context = Column(JSON, nullable=True)
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
            ["job_definition_id", "job_definition_version"],
            ["job_definition.job_definition_id", "job_definition.version"],
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
