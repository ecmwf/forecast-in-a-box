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
from pydantic import BaseModel, Field, PositiveInt, model_validator


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


class JobExecuteV2Request(BaseModel):
    """Request body for POST /job/execute_v2.

    Exactly one of `job_definition_id` or `spec` must be provided.  When
    `job_definition_id` is given the referenced JobDefinition is compiled and
    executed; when `spec` is given a one-off JobDefinition is first persisted
    with source=oneoff_execution.
    """

    job_definition_id: str | None = None
    """Reference to an existing saved JobDefinition."""
    job_definition_version: int | None = None
    """Specific version to use; omit to use the latest version."""
    spec: ExecutionSpecification | None = None
    """Raw ExecutionSpecification for a one-off execution."""

    @model_validator(mode="after")
    def _check_exactly_one(self) -> "JobExecuteV2Request":
        has_ref = self.job_definition_id is not None
        has_spec = self.spec is not None
        if has_ref == has_spec:
            raise ValueError("Exactly one of job_definition_id or spec must be provided.")
        return self


class JobExecuteV2Response(BaseModel):
    """Response from POST /job/execute_v2."""

    execution_id: str
    """Logical v2 execution id (JobExecution.id)."""
    id: str
    """Cascade job id; compatible with the v1 SubmitJobResponse."""
    definition_id: str
    """The JobDefinition id that was linked or created for this execution."""
    definition_version: int
    """The JobDefinition version that was linked or created."""
