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
from pathlib import Path
from typing import Literal, cast

from cascade.controller.report import JobId
from cascade.gateway import api
from cascade.gateway.api import (
    JobSpec,
    LocalProcesses,
    ResultDeletionRequest,
    SlurmCluster,
    SshCluster,
    SubmitJobRequest,
    SubmitJobResponse,
)
from cascade.gateway.client import request_response
from cascade.low.core import DatasetId, JobInstance, JobInstanceRich, TaskId
from cascade.low.func import assert_never
from fiab_core.fable import BlockInstanceId
from pydantic import Field

from forecastbox.domain.blueprint.cascade import EnvironmentSpecification
from forecastbox.domain.gateway.service import get_gateway_url
from forecastbox.domain.run.exceptions import RunOutputRetrievalFailed
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
        assert_never(requested_infra)


class RawCascadeJob(FiabBaseModel):
    job_type: Literal["raw_cascade_job"]
    job_instance: JobInstance


class ExecutionSpecification(FiabBaseModel):
    job: RawCascadeJob  # = Field(discriminator="job_type")
    environment: EnvironmentSpecification
    shared: bool = Field(default=False)


stored_output_max_length = 10 * 1024**2


class RunOutputCharacteristic(FiabBaseModel):
    mime_type: str = "application/octet-stream"
    display_name: str | None = None
    dimension_kvs: list[tuple[str, str]] | None = None
    original_block: BlockInstanceId
    value: str | None = Field(
        default=None,
        description=f"If the actual output value is textual (text/plain) and has already been computed, we will store it here, trimmed to {stored_output_max_length} characters",
    )


class RunOutputs(FiabBaseModel):
    outputs: dict[TaskId, RunOutputCharacteristic]


def execute_cascade(spec: ExecutionSpecification) -> SubmitJobResponse:
    """Convert spec to JobInstance and submit to cascade api.

    ``spec.job.job_instance.ext_outputs`` must already be set by the caller
    (``compile_builder`` sets it as part of compilation) and all runtime artifacts
    of ``spec.environment`` must already be available locally. Gateway exceptions
    are returned as a ``SubmitJobResponse`` with ``job_id=None``.
    """
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
            envvars=spec.environment.environment_variables,
            job_instance=JobInstanceRich(jobInstance=job, checkpointSpec=None),
        )
    )
    try:
        submit_job_response: SubmitJobResponse = request_response(r, get_gateway_url())  # type: ignore
    except Exception as e:
        return SubmitJobResponse(job_id=None, error=repr(e))

    return submit_job_response


def delete_cascade_datasets(cascade_job_id: str) -> None:
    """Delete all datasets of the given job in the gateway. Errors reported by the gateway are ignored."""
    request = ResultDeletionRequest(datasets={JobId(cascade_job_id): []})
    request_response(request, get_gateway_url())


def retrieve_output_bytes(cascade_job_id: str, dataset: DatasetId) -> bytes:
    """Blocking gateway retrieval and decode of a dataset. Raises RunOutputRetrievalFailed with a user-facing message on failure."""
    response = request_response(
        api.ResultRetrievalRequest(job_id=JobId(cascade_job_id), dataset_id=dataset),
        get_gateway_url(),
    )
    response = cast(api.ResultRetrievalResponse, response)
    if response.error:
        raise RunOutputRetrievalFailed(f"Result retrieval failed: {response.error}")
    try:
        decoded = api.decoded_result(response, job=None)  # type: ignore[attr-defined]
    except Exception as e:
        raise RunOutputRetrievalFailed(f"Result decoding failed: {e}")
    if not isinstance(decoded, bytes):
        raise RunOutputRetrievalFailed(f"Result decoding failed: expected bytes, got {type(decoded).__name__}")
    return decoded
