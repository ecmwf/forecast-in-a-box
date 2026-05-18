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
from typing import Literal

import cloudpickle
import earthkit.data
import numpy as np
import xarray as xr
from cascade.gateway.api import JobSpec, ResultRetrievalResponse, SubmitJobRequest, SubmitJobResponse, decoded_result
from cascade.gateway.client import request_response
from cascade.low.core import JobInstance, JobInstanceRich, TaskId
from cascade.low.func import Either
from fiab_core.fable import BlockInstanceId
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


def encode_result(result: ResultRetrievalResponse, mime_type: str) -> Either[bytes, str]:  # ty: ignore[invalid-type-arguments]
    """Converts cascade Result response to bytes for a known mime type."""
    # TODO this function should change as follows:
    # - the preferred way is that cascade tasks return simply bytes, so thats what we'll start with
    # - the (tuple) thing should be completely dropped, it increases memory pressure and we dont really
    #   need that safety. First, drop it from all plugins, then from here
    # - all the other options should be deleted, first ensured they are not used in plugins
    obj = decoded_result(result, job=None)  # type: ignore
    if isinstance(obj, tuple):
        if len(obj) != 2 or not isinstance(obj[0], bytes) or not isinstance(obj[1], str):
            return Either.error("Tuple result must contain exactly two elements: (bytes, mime_type)")
        if obj[1] != mime_type:
            return Either.error(f"Result mime mismatch: expected {mime_type!r}, got {obj[1]!r}")
        return Either.ok(obj[0])

    if isinstance(obj, bytes):
        return Either.ok(obj)

    if mime_type == "image/png":
        try:
            from earthkit.plots import (  # type: ignore[unresolved-import]
                Figure,  # NOTE plots is an optional dependency -- import inside body allowed
            )

            if isinstance(obj, Figure):
                buf = io.BytesIO()
                obj.save(buf)
                return Either.ok(buf.getvalue())
        except ImportError:
            pass
        if isinstance(obj, bytes):
            return Either.ok(obj)
        return Either.error(f"Expected image/png-compatible result, got {type(obj).__name__}")

    if mime_type == "application/grib":
        if isinstance(obj, earthkit.data.FieldList):
            encoder = earthkit.data.create_encoder("grib")
            if isinstance(obj, earthkit.data.Field):
                return Either.ok(encoder.encode(obj).to_bytes())  # type: ignore
            elif isinstance(obj, earthkit.data.FieldList):
                return Either.ok(encoder.encode(obj[0], template=obj[0]).to_bytes())  # type: ignore
        return Either.error(f"Expected application/grib-compatible result, got {type(obj).__name__}")

    if mime_type in ("application/netcdf", "application/x-netcdf"):
        if isinstance(obj, (xr.Dataset, xr.DataArray)):
            buf = io.BytesIO()
            obj.to_netcdf(buf, format="NETCDF4")  # type: ignore
            return Either.ok(buf.getvalue())
        return Either.error(f"Expected netcdf-compatible result, got {type(obj).__name__}")

    if mime_type == "application/numpy":
        if isinstance(obj, np.ndarray):
            buf = io.BytesIO()
            np.save(buf, obj)
            return Either.ok(buf.getvalue())
        return Either.error(f"Expected numpy-compatible result, got {type(obj).__name__}")

    if mime_type == "application/pickle":
        return Either.ok(cloudpickle.dumps(obj))

    if mime_type == "application/clpkl":
        return Either.ok(cloudpickle.dumps(obj))

    if mime_type == "text/plain":
        if isinstance(obj, str):
            return Either.ok(obj.encode("utf-8"))
        return Either.error(f"Expected text/plain-compatible result, got {type(obj).__name__}")

    if mime_type == "application/octet-stream":
        if isinstance(obj, str):
            return Either.ok(obj.encode("utf-8"))
        return Either.error(f"Expected bytes-compatible result, got {type(obj).__name__}")

    return Either.error(f"Unsupported mime type {mime_type!r} for result decoding")


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
        return SubmitJobResponse(job_id=None, error=repr(e))

    return submit_job_response
