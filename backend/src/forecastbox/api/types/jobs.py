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
