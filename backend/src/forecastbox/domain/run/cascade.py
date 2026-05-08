# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import logging
import tempfile
import time
from pathlib import Path
from typing import Literal

from cascade.gateway.api import JobSpec, LocalProcesses, SlurmCluster, SshCluster, SubmitJobRequest, SubmitJobResponse
from cascade.gateway.client import request_response
from cascade.low.core import JobInstance, JobInstanceRich, TaskId
from fiab_core.fable import BlockInstanceId
from pydantic import Field

from forecastbox.domain.artifact.manager import ArtifactManager, submit_artifact_download
from forecastbox.domain.blueprint.cascade import EnvironmentSpecification
from forecastbox.domain.gateway.service import get_gateway_url
from forecastbox.utility.config import CascadeInfrastructureType, UnmanagedGateway, config
from forecastbox.utility.pydantic import FiabBaseModel

logger = logging.getLogger(__name__)


def _select_cascade_infra(environment: EnvironmentSpecification) -> CascadeInfrastructureType:
    if "cascade_infra" in environment.model_fields_set:
        return environment.cascade_infra
    return config.cascade.constraints.default_cascade_infra


def _build_infra_spec(
    environment: EnvironmentSpecification, workers_per_host: int, hosts: int
) -> LocalProcesses | SlurmCluster | SshCluster:
    requested_infra = _select_cascade_infra(environment)
    gateway = config.cascade.gateway

    if requested_infra == "localProcess":
        return LocalProcesses(workers_per_host=workers_per_host, hosts=hosts)

    elif requested_infra == "slurm":
        if not isinstance(gateway, UnmanagedGateway):
            if not gateway.startup_params.shared_path:
                raise ValueError(
                    "slurm submissions with managed gateway require setting config value of cascade.gateway.startup_params.shared_path"
                )
        return SlurmCluster(workers_per_host=workers_per_host, hosts=hosts)

    elif requested_infra == "sshCluster":
        if isinstance(gateway, UnmanagedGateway):
            raise ValueError("sshCluster submission currently not supported for unmanaged gateway")
        ssh_cluster_spec = gateway.startup_params.ssh_cluster_spec
        if ssh_cluster_spec is None:
            raise ValueError("sshCluster submissions require setting config value of cascade.gateway.startup_params.ssh_cluster_spec")
        return SshCluster(
            controller_url=ssh_cluster_spec.controller_url,
            worker_urls=ssh_cluster_spec.worker_urls,
            workers_per_host=workers_per_host,
        )

    else:
        assert_never(request_infra)


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
    # block_id → filesystem path for sinks that write to disk (Zarr, GRIB, NetCDF…).
    # Populated at compile time by walking sink blocks' `path`/`dir` config keys.
    stored_outputs: dict[BlockInstanceId, str] = {}


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
    hosts = min(config.cascade.constraints.max_hosts, environment.hosts or config.cascade.constraints.default_hosts)
    workers_per_host = min(
        config.cascade.constraints.max_workers_per_host, environment.workers_per_host or config.cascade.constraints.default_workers_per_host
    )

    infra_spec = _build_infra_spec(environment, workers_per_host=workers_per_host, hosts=hosts)

    r = SubmitJobRequest(
        job=JobSpec(
            infra_spec=infra_spec,
            envvars={},
            job_instance=JobInstanceRich(jobInstance=job, checkpointSpec=None),
        )
    )
    try:
        submit_job_response: SubmitJobResponse = request_response(r, get_gateway_url())  # type: ignore
    except Exception as e:
        return SubmitJobResponse(job_id=None, error=repr(e))

    return submit_job_response
