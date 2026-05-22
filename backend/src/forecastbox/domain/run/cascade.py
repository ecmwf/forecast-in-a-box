# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import logging
import time
from pathlib import Path
from typing import Literal

from cascade.gateway.api import JobSpec, SubmitJobRequest, SubmitJobResponse
from cascade.gateway.client import request_response
from cascade.low.core import JobInstance, JobInstanceRich, TaskId
from fiab_core.fable import BlockInstanceId
from pydantic import Field

from forecastbox.domain.artifact.manager import ArtifactManager, submit_artifact_download
from forecastbox.domain.blueprint.cascade import EnvironmentSpecification
from forecastbox.domain.gateway.service import get_gateway_url
from forecastbox.utility.config import config
from forecastbox.utility.pydantic import FiabBaseModel

logger = logging.getLogger(__name__)


class RawCascadeJob(FiabBaseModel):
    job_type: Literal["raw_cascade_job"]
    job_instance: JobInstance


class ExecutionSpecification(FiabBaseModel):
    job: RawCascadeJob  # = Field(discriminator="job_type")
    environment: EnvironmentSpecification
    shared: bool = Field(default=False)


class RunOutputCharacteristic(FiabBaseModel):
    mime_type: str = "application/octet-stream"
    original_block: BlockInstanceId


class RunOutputs(FiabBaseModel):
    outputs: dict[TaskId, RunOutputCharacteristic]


def execute_cascade(spec: ExecutionSpecification) -> SubmitJobResponse:
    """Convert spec to JobInstance and submit to cascade api.

    ``spec.job.job_instance.ext_outputs`` must already be set by the caller
    (``compile_builder`` sets it as part of compilation).
    """
    runtime_artifacts = spec.environment.runtime_artifacts
    if runtime_artifacts:
        missing_artifacts = [art for art in runtime_artifacts if art not in ArtifactManager.locally_available]

        download_ids = []
        for artifact_id in missing_artifacts:
            result = submit_artifact_download(artifact_id)
            if result.e:
                error_msg = f"Failed to submit download for {artifact_id}: {result.e}"
                logger.error(error_msg)
                return SubmitJobResponse(job_id=None, error=error_msg)
            download_ids.append(artifact_id)

        if download_ids:
            max_wait_seconds = 3600
            start_time = time.time()

            while True:
                remaining = {e for e in download_ids if e not in ArtifactManager.locally_available}

                if not remaining:
                    logger.info(f"All runtime artifacts downloaded: {download_ids}")
                    break

                if time.time() - start_time > max_wait_seconds:
                    error_msg = "Timeout waiting for runtime artifacts to download"
                    logger.error(error_msg)
                    return SubmitJobResponse(job_id=None, error=error_msg)

                time.sleep(1)

    job = spec.job.job_instance

    environment = spec.environment
    hosts = min(config.cascade.max_hosts, environment.hosts or config.cascade.default_hosts)
    workers_per_host = min(config.cascade.max_workers_per_host, environment.workers_per_host or config.cascade.default_workers_per_host)

    r = SubmitJobRequest(
        job=JobSpec(
            workers_per_host=workers_per_host,
            hosts=hosts,
            envvars=env_vars,
            use_slurm=False,
            job_instance=JobInstanceRich(jobInstance=job, checkpointSpec=None),
        )
    )
    try:
        submit_job_response: SubmitJobResponse = request_response(r, get_gateway_url())  # type: ignore
    except Exception as e:
        return SubmitJobResponse(job_id=None, error=repr(e))

    return submit_job_response
