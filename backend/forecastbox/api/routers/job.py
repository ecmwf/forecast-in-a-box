# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Job Monitoring API Router."""

import logging
import json
from typing import Literal
from fastapi import APIRouter, Response, Depends, UploadFile, Body
from fastapi.responses import HTMLResponse
from fastapi import HTTPException
import asyncio

from dataclasses import dataclass

from cascade.low.core import DatasetId, TaskId
from cascade.controller.report import JobId

import cascade.gateway.api as api
import cascade.gateway.client as client
from forecastbox.schemas.user import UserRead
from forecastbox.auth.users import current_active_user

from forecastbox.api.utils import encode_result

from forecastbox.config import config
from forecastbox.api.types import VisualisationOptions, ExecutionSpecification
from forecastbox.api.visualisation import visualise
from forecastbox.api.execution import execute, SubmitJobResponse
from forecastbox.db.job import get_one, update_one, get_all, delete_all, delete_one

logger = logging.getLogger(__name__)

router = APIRouter(
    tags=["job"],
    responses={404: {"description": "Not found"}},
)


STATUS = Literal["running", "completed", "errored", "invalid", "timeout", "unknown"]


@dataclass
class JobProgressResponse:
    """Job Progress Response."""

    progress: str
    """Progress of the job as a percentage."""
    status: STATUS
    """Status of the job."""
    created_at: str | None = None
    """Creation timestamp of the job."""
    error: str | None = None
    """Error message if the job encountered an error, otherwise None."""


@dataclass
class JobProgressResponses:
    """Job Progress Responses.

    Contains progress information for multiple jobs.
    """

    progresses: dict[JobId, JobProgressResponse]
    """A dictionary mapping job IDs to their progress responses."""
    error: str | None = None
    """An error message if there was an issue retrieving job progress, otherwise None."""


def validate_job_id(job_id: JobId) -> JobId | None:
    """Validate the job ID."""
    # NOTE we could query the db here, but since next step is a conditional db retrieval anyway, this extra query makes low sense
    return job_id


def validate_dataset_id(dataset_id: str) -> str:
    """Validate the dataset ID."""
    return dataset_id


async def update_and_get_progress(job_id: JobId) -> JobProgressResponse:
    """Updates the job db with the newest cascade gateway response, returns the updated result"""
    response = None
    error_on_request = None
    status = "unknown"

    try:
        response: api.JobProgressResponse = client.request_response(
            api.JobProgressRequest(job_ids=[job_id]), f"{config.cascade.cascade_url}"
        )  # type: ignore
    except (TimeoutError, KeyError, Exception) as e:
        status = {TimeoutError: "timeouted", KeyError: "invalid", Exception: "errored"}[e.__class__]
        error_on_request = repr(e)
    if response.error:
        status = "errored"
        error_on_request = response.error
    if error_on_request is not None:
        await update_one(job_id, status=status)
        return JobProgressResponse(
            progress="0.00",
            status=status,
            error=error_on_request,
        )

    jobprogress = response.progresses.get(job_id, None)
    if not jobprogress:
        # NOTE this is for cases where jobdb outlives gateway (which is legit scenario)
        await update_one(job_id, status="invalid")
        return JobProgressResponse(progress="0.00", status="invalid", error="job not tracked anymore")
    elif jobprogress.failure:
        await update_one(job_id, status="errored", error=jobprogress.failure)
    elif jobprogress.completed or jobprogress.pct == "100.00":
        await update_one(job_id, status="completed")
    else:
        await update_one(job_id, status="running")

    progress = jobprogress.pct if jobprogress.pct else "0.00" if jobprogress.failure else "100.00"

    job = await get_one(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found in the database.")
    return JobProgressResponse(
        progress=progress,
        created_at=str(job.created_at),
        status=job.status,
        error=job.error,
    )


@router.get("/status")
async def get_status() -> JobProgressResponses:
    """Get progress of all tasks recorded in the database."""

    job_records = await get_all()

    progresses = {
        job.job_id: await update_and_get_progress(job.job_id)
        if job.status in ["running", "submitted"]
        else JobProgressResponse(
            progress="0.00" if not job.status == "completed" else "100.00",
            status=job.status,
            created_at=str(job.created_at),
            error=job.error,
        )
        for job in job_records
    }

    return JobProgressResponses(progresses=progresses, error=None)


@router.get("/{job_id}/status")
async def get_status_of_job(job_id: JobId = Depends(validate_job_id)) -> JobProgressResponse:
    """Get progress of a particular job."""
    return await update_and_get_progress(job_id)


@router.get("/{job_id}/outputs")
async def get_outputs_of_job(job_id: JobId = Depends(validate_job_id)) -> list[TaskId]:
    """Get outputs of a job."""
    job = await get_one(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found in the database.")
    return json.loads(job.outputs)


@router.post("/{job_id}/visualise")
async def visualise_job(job_id: JobId = Depends(validate_job_id), options: VisualisationOptions = Body(None)) -> HTMLResponse:
    """Visualise a job's execution graph.

    Retrieves the job's graph specification from the database, converts it to a cascade graph,
    and generates an HTML visualisation of the graph.
    """
    job = await get_one(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found in the database.")
    if not options:
        options = VisualisationOptions()
    if job.graph_specification is None:
        raise HTTPException(status_code=404, detail=f"Job {job_id} had no specification.")
    spec = ExecutionSpecification(**json.loads(job.graph_specification))
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, visualise, spec, options)  # CPU bound


@router.get("/{job_id}/specification")
async def get_job_specification(job_id: JobId = Depends(validate_job_id)) -> ExecutionSpecification:
    """Get specification in the database of a job."""
    job = await get_one(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found in the database.")
    if job.graph_specification is None:
        raise HTTPException(status_code=404, detail=f"Job {job_id} had no specification.")
    return ExecutionSpecification(**json.loads(job.graph_specification))


@router.get("/{job_id}/restart")
async def restart_job(job_id: JobId = Depends(validate_job_id), user: UserRead = Depends(current_active_user)) -> SubmitJobResponse:
    """Restart a job by executing its specification."""
    job = await get_one(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found in the database.")
    spec = job.graph_specification
    if not spec:
        raise HTTPException(status_code=404, detail=f"Job {job_id} had no specification.")
    spec = ExecutionSpecification(**json.loads(spec))
    return await execute(spec, user)


@router.post("/upload")
async def upload_job(file: UploadFile, user: UserRead = Depends(current_active_user)) -> SubmitJobResponse:
    """Upload a job specification file and execute it."""
    if not file:
        raise HTTPException(status_code=400, detail="No file provided for upload.")
    spec = await file.read()
    spec = ExecutionSpecification(**json.loads(spec))
    return await execute(spec, user=user)


@dataclass
class DatasetAvailabilityResponse:
    """Dataset Availability Response."""

    available: bool
    """Indicates whether the dataset is available for download."""


@router.get("/{job_id}/available")
async def get_job_availablity(job_id: JobId = Depends(validate_job_id)) -> list[TaskId]:
    """
    Check which results are available for a given job_id.

    Parameters
    ----------
    job_id : str
        Job ID of the task
    """
    response: api.JobProgressResponse = client.request_response(api.JobProgressRequest(job_ids=[job_id]), f"{config.cascade.cascade_url}")
    return [x.task for x in response.datasets[job_id]]


@router.get("/{job_id}/{dataset_id}/available")
async def get_result_availablity(
    job_id: JobId = Depends(validate_job_id), dataset_id: TaskId = Depends(validate_dataset_id)
) -> DatasetAvailabilityResponse:
    """
    Check if the result is available for a given job_id and dataset_id.

    This is used to check if the result is available for download.

    Parameters
    ----------
    job_id : str
        Job ID of the task
    dataset_id : str
        Dataset ID of the task

    Returns
    -------
    DatasetAvailabilityResponse
        {'available': Availability of the result}
    """

    try:
        response: api.JobProgressResponse = client.request_response(
            api.JobProgressRequest(job_ids=[job_id]), f"{config.cascade.cascade_url}"
        )
    except ValueError as e:
        raise HTTPException(status_code=500, detail=f"Job retrieval failed: {e}")

    if job_id not in response.datasets:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found in the database.")

    return DatasetAvailabilityResponse(dataset_id in [x.task for x in response.datasets[job_id]])


@router.get("/{job_id}/{dataset_id}")
async def get_result(job_id: JobId = Depends(validate_job_id), dataset_id: TaskId = Depends(validate_dataset_id)) -> Response:
    """
    Get the result of a job.

    Parameters
    ----------
    job_id : JobId
        Job ID of the task, expected to be the id in the database, not the cascade job id.
    dataset_id : TaskId
        Dataset ID of the task, these can be found from /{job_id}/outputs.

    Returns
    -------
    Response
        Response containing the result of the job, encoded as bytes.

    Raises
    ------
    HTTPException
        If the result retrieval fails or if the job or dataset ID is not found in the database.
    """
    response = client.request_response(
        api.ResultRetrievalRequest(job_id=job_id, dataset_id=DatasetId(task=dataset_id, output="0")),
        f"{config.cascade.cascade_url}",
    )

    if response.error:
        raise HTTPException(500, f"Result retrieval failed: {response.error}")

    try:
        bytez, media_type = encode_result(response)
    except Exception as e:
        logger.exception("decoding failure")
        raise HTTPException(500, f"Result decoding failed: {repr(e)}")

    return Response(bytez, media_type=media_type)


@dataclass
class JobDeletionResponse:
    """Job Deletion Response."""

    deleted_count: int
    """Number of jobs deleted from the database."""


@router.post("/flush")
async def flush_job() -> JobDeletionResponse:
    """Flush all job from the database and cascade.

    Returns number of deleted jobs.
    """
    try:
        client.request_response(api.ResultDeletionRequest(datasets={}), f"{config.cascade.cascade_url}")  # type: ignore
    except Exception as e:
        raise HTTPException(500, f"Job deletion failed: {e}")
    finally:
        deleted_count = await delete_all()
    return JobDeletionResponse(deleted_count=deleted_count)


@router.delete("/{job_id}")
async def delete_job(job_id: JobId = Depends(validate_job_id)) -> JobDeletionResponse:
    """Delete a job from the database and cascade.

    Returns number of deleted jobs.
    """
    try:
        client.request_response(api.ResultDeletionRequest(datasets={job_id: []}), f"{config.cascade.cascade_url}")  # type: ignore
    except Exception as e:
        raise HTTPException(500, f"Job deletion failed: {e}")
    finally:
        deleted_count = await delete_one(job_id)
    return JobDeletionResponse(deleted_count=deleted_count)
