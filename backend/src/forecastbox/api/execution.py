# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import asyncio
import json
import logging
import time
import uuid
from typing import Any, Sequence

import cascade.gateway.api as api
import cascade.gateway.client as client
from cascade.low import views as cascade_views
from cascade.low.core import JobInstance, JobInstanceRich
from cascade.low.func import Either, assert_never
from earthkit.workflows import Cascade, fluent
from earthkit.workflows.compilers import graph2job
from earthkit.workflows.graph import Graph, deduplicate_nodes
from fastapi import HTTPException
from pydantic import BaseModel

from forecastbox.api.artifacts.manager import ArtifactManager, submit_artifact_download
from forecastbox.api.types.jobs import EnvironmentSpecification, ExecutionSpecification, RawCascadeJob
from forecastbox.api.utils import get_model_path
from forecastbox.config import config
from forecastbox.db.job import insert_one
from forecastbox.models import get_model
from forecastbox.products.registry import get_product
from forecastbox.schemas.user import UserRead

logger = logging.getLogger(__name__)


# TODO replace with just output_ids, or something more fitting, since product_ are deprecated
class ProductToOutputId(BaseModel):
    product_name: str
    product_spec: dict[str, Any]
    output_ids: Sequence[str]


def _execute_cascade(spec: ExecutionSpecification) -> tuple[api.SubmitJobResponse, list[ProductToOutputId]]:
    """Converts spec to JobInstance and submits to cascade api, returning response"""

    # Handle runtime artifacts download before job execution
    runtime_artifacts = spec.environment.runtime_artifacts
    if runtime_artifacts:
        # Check which artifacts are not locally available (without locking)
        missing_artifacts = [art for art in runtime_artifacts if art not in ArtifactManager.locally_available]

        # TODO if any are missing update the db status

        # Submit downloads for missing artifacts
        download_ids = []
        for artifact_id in missing_artifacts:
            result = submit_artifact_download(artifact_id)
            if result.e:
                error_msg = f"Failed to submit download for {artifact_id}: {result.e}"
                logger.error(error_msg)
                return api.SubmitJobResponse(job_id=None, error=error_msg), []
            download_ids.append(artifact_id)

        # TODO replace this with Future await
        # Poll for download completion
        if download_ids:
            max_wait_seconds = 3600  # 1 hour timeout
            start_time = time.time()

            while True:
                # Check for remaining downloads using set difference
                remaining = set(download_ids) - ArtifactManager.locally_available

                if not remaining:
                    logger.info(f"All runtime artifacts downloaded: {download_ids}")
                    break

                if time.time() - start_time > max_wait_seconds:
                    error_msg = f"Timeout waiting for runtime artifacts to download"
                    logger.error(error_msg)
                    return api.SubmitJobResponse(job_id=None, error=error_msg), []

                time.sleep(1)

    job = spec.job.job_instance
    sinks = cascade_views.sinks(job)
    sinks = [s for s in sinks if not s.task.startswith("run_as_earthkit")]
    job.ext_outputs = sinks
    product_to_id_mappings = [ProductToOutputId(product_name="All Outputs", product_spec={}, output_ids=[x.task for x in sinks])]

    environment = spec.environment

    hosts = min(config.cascade.max_hosts, environment.hosts or config.cascade.max_hosts)
    workers_per_host = min(config.cascade.max_workers_per_host, environment.workers_per_host or config.cascade.max_workers_per_host)

    env_vars = {"TMPDIR": config.cascade.venv_temp_dir}

    r = api.SubmitJobRequest(
        job=api.JobSpec(
            workers_per_host=workers_per_host,
            hosts=hosts,
            envvars=env_vars,
            use_slurm=False,
            job_instance=JobInstanceRich(jobInstance=job, checkpointSpec=None),
        )
    )
    try:
        submit_job_response: api.SubmitJobResponse = client.request_response(r, f"{config.cascade.cascade_url}")  # type: ignore
    except Exception as e:
        return api.SubmitJobResponse(job_id=None, error=repr(e)), []

    return submit_job_response, product_to_id_mappings


class SubmitJobResponse(BaseModel):
    """Submit Job Response."""

    id: str
    """Id of the submitted job."""


async def execute(spec: ExecutionSpecification, user_id: str | None) -> Either[SubmitJobResponse, str]:  # type: ignore[invalid-argument] # NOTE type checker issue
    try:
        loop = asyncio.get_running_loop()
        response, product_to_id_mappings = await loop.run_in_executor(None, _execute_cascade, spec)  # CPU-bound
        if not response.job_id:
            # TODO this best comes from the db... we still have a cascade conflict problem,
            # we best redesign cascade api to allow for uuid acceptance
            response.job_id = str(uuid.uuid4())

        await insert_one(
            response.job_id,
            response.error,
            user_id,
            spec.model_dump_json(),
            json.dumps([x.model_dump() for x in product_to_id_mappings]),
        )
        return Either.ok(SubmitJobResponse(id=response.job_id))
    except Exception as e:
        return Either.error(repr(e))


async def execute2response(spec: ExecutionSpecification, user: UserRead | None) -> SubmitJobResponse:
    result = await execute(spec, str(user.id) if user is not None else None)
    if result.t is None:
        raise HTTPException(status_code=500, detail=f"Failed to execute because of {result.e}")
    else:
        return result.t
