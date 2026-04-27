# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import io
import logging
import time
from pathlib import Path
from typing import Any, Literal, Sequence

import cloudpickle
import earthkit.data
import numpy as np
import xarray as xr
from cascade.gateway.api import JobSpec, ResultRetrievalResponse, SubmitJobRequest, SubmitJobResponse, decoded_result
from cascade.gateway.client import request_response
from cascade.low import views
from cascade.low.core import JobInstance, JobInstanceRich
from pydantic import Field

from forecastbox.domain.artifact.manager import ArtifactManager, submit_artifact_download
from forecastbox.domain.blueprint.cascade import EnvironmentSpecification
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


def encode_result(result: ResultRetrievalResponse) -> tuple[bytes, str]:
    """Converts cascade Result response to bytes+mime"""
    obj = decoded_result(result, job=None)  # type: ignore
    if isinstance(obj, bytes):
        return obj, "application/pickle"
    if isinstance(obj, tuple):
        if len(obj) == 2 and isinstance(obj[0], bytes):
            return obj[0], obj[1]
        else:
            raise ValueError("Tuple result must contain exactly two elements: (bytes, mime_type)")

    try:
        from earthkit.plots import (  # type: ignore[unresolved-import]
            Figure,  # NOTE plots is an optional dependency -- import inside body allowed
        )

        if isinstance(obj, Figure):
            buf = io.BytesIO()
            obj.save(buf)
            return buf.getvalue(), "image/png"
    except ImportError:
        pass

    if isinstance(obj, earthkit.data.FieldList):
        encoder = earthkit.data.create_encoder("grib")
        if isinstance(obj, earthkit.data.Field):
            return encoder.encode(obj).to_bytes(), "application/grib"  # type: ignore
        elif isinstance(obj, earthkit.data.FieldList):
            return encoder.encode(obj[0], template=obj[0]).to_bytes(), "application/grib"  # type: ignore

    elif isinstance(obj, (xr.Dataset, xr.DataArray)):
        buf = io.BytesIO()
        obj.to_netcdf(buf, format="NETCDF4")  # type: ignore
        return buf.getvalue(), "application/netcdf"

    elif isinstance(obj, np.ndarray):
        buf = io.BytesIO()
        np.save(buf, obj)
        return buf.getvalue(), "application/numpy"

    return cloudpickle.dumps(obj), "application/clpkl"


class ProductToOutputId(FiabBaseModel):
    product_name: str
    product_spec: dict[str, Any]
    output_ids: Sequence[str]


def execute_cascade(spec: ExecutionSpecification) -> tuple[SubmitJobResponse, list[ProductToOutputId]]:
    """Convert spec to JobInstance and submit to cascade api, returning response."""
    runtime_artifacts = spec.environment.runtime_artifacts
    if runtime_artifacts:
        missing_artifacts = [art for art in runtime_artifacts if art not in ArtifactManager.locally_available]

        download_ids = []
        for artifact_id in missing_artifacts:
            result = submit_artifact_download(artifact_id)
            if result.e:
                error_msg = f"Failed to submit download for {artifact_id}: {result.e}"
                logger.error(error_msg)
                return SubmitJobResponse(job_id=None, error=error_msg), []
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
                    return SubmitJobResponse(job_id=None, error=error_msg), []

                time.sleep(1)

    job = spec.job.job_instance
    sinks = views.sinks(job)
    sinks = [s for s in sinks if not s.task.startswith("run_as_earthkit")]
    job.ext_outputs = sinks
    product_to_id_mappings = [ProductToOutputId(product_name="All Outputs", product_spec={}, output_ids=[x.task for x in sinks])]

    environment = spec.environment
    hosts = min(config.cascade.max_hosts, environment.hosts or config.cascade.default_hosts)
    workers_per_host = min(config.cascade.max_workers_per_host, environment.workers_per_host or config.cascade.default_workers_per_host)
    env_vars = {"TMPDIR": config.cascade.venv_temp_dir}

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
        submit_job_response: SubmitJobResponse = request_response(r, f"{config.cascade.cascade_url}")  # type: ignore
    except Exception as e:
        return SubmitJobResponse(job_id=None, error=repr(e)), []

    return submit_job_response, product_to_id_mappings
