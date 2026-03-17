# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Related to jobs endpoints"""

from typing import Literal

from cascade.low.core import JobInstance
from fiab_core.artifacts import CompositeArtifactId
from pydantic import BaseModel, Field, PositiveInt


class EnvironmentSpecification(BaseModel):
    hosts: PositiveInt | None = Field(default=None)
    workers_per_host: PositiveInt | None = Field(default=None)
    environment_variables: dict[str, str] = Field(default_factory=dict)
    runtime_artifacts: list[CompositeArtifactId] = Field(default_factory=list)


class RawCascadeJob(BaseModel):
    job_type: Literal["raw_cascade_job"]
    job_instance: JobInstance


class ExecutionSpecification(BaseModel):
    job: RawCascadeJob  # = Field(discriminator="job_type")
    environment: EnvironmentSpecification
    shared: bool = Field(default=False)


class JobExecuteRequest(BaseModel):
    """Request body for POST /job/execute.

    References an existing saved JobDefinition by id and optional version.
    """

    job_definition_id: str
    """Reference to an existing saved JobDefinition."""
    job_definition_version: int | None = None
    """Specific version to use; omit to use the latest version."""


class JobExecuteResponse(BaseModel):
    """Response from POST /job/execute."""

    execution_id: str
    """Logical execution id (JobExecution.id)."""
    attempt_count: int
    """Attempt number; always 1 on a fresh execution."""


class JobExecutionDetail(BaseModel):
    """Detail of a single job execution attempt."""

    execution_id: str
    attempt_count: int
    status: str
    created_at: str
    updated_at: str
    job_definition_id: str
    job_definition_version: int
    error: str | None = None
    progress: str | None = None
    cascade_job_id: str | None = None


class JobExecutionList(BaseModel):
    """List of latest-attempt job execution details with pagination metadata."""

    executions: list[JobExecutionDetail]
    total: int
    """Total number of executions in the database."""
    page: int
    """Current page number."""
    page_size: int
    """Number of items per page."""
    total_pages: int
    """Total number of pages."""


class JobSpecification(BaseModel):
    """Specification payload linked to a job execution attempt."""

    definition_id: str
    definition_version: int
    blocks: dict | None = None
    environment_spec: dict | None = None
