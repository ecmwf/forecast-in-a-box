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

from dataclasses import dataclass

from cascade.low.core import DatasetId, TaskId
from cascade.controller.report import JobId

import cascade.gateway.api as api
import cascade.gateway.client as client
from forecastbox.schemas.user import UserRead
from forecastbox.auth.users import current_active_user

from forecastbox.db import db
from forecastbox.api.utils import encode_result

from forecastbox.config import config
from forecastbox.api.types import VisualisationOptions, ExecutionSpecification
from forecastbox.api.visualisation import visualise
from forecastbox.api.execution import execute, SubmitJobResponse

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
    """Validate the job ID by checking if it exists in the database."""
    collection = db.get_collection("job_records")

    record = collection.find_one({"job_id": job_id})
    if record:
        return job_id
    raise HTTPException(status_code=404, detail=f"Job {job_id} not found in the database.")


def validate_dataset_id(dataset_id: str) -> str:
    """Validate the dataset ID."""
    return dataset_id


def get_job_progress(job_id: JobId) -> JobProgressResponse:
    """
    Get the progress of a job.

    Updates the job record in the database with the job status and error if any.

    Parameters
    ----------
    job_id : JobId
        job_id of the task, expected to be the id
        in the database, not the cascade job id.

    Returns
    -------
    JobProgressResponse
        Progress of the job as a percentage, status, creation timestamp, and error message if any.
    """
    response = None
    error_on_request = None
    collection = db.get_collection("job_records")

    try:
        response: api.JobProgressResponse = client.request_response(
            api.JobProgressRequest(job_ids=[job_id]), f"{config.cascade.cascade_url}"
        )  # type: ignore
    except TimeoutError as e:
        collection.update_one({"job_id": job_id}, {"$set": {"status": "timeout"}})
        error_on_request = f"TimeoutError: {e}"
    except KeyError as e:
        collection.update_one({"job_id": job_id}, {"$set": {"status": "invalid"}})
        error_on_request = f"KeyError: {e}"
    except Exception as e:
        collection.update_one({"job_id": job_id}, {"$set": {"status": "errored"}})
        error_on_request = f"Exception: {e}"

    finally:
        if response is None:
            return JobProgressResponse(
                progress="0.00",
                status=collection.find({"job_id": job_id})[0]["status"],
                error=error_on_request,
            )

    if response.error:
        collection.update_one({"job_id": job_id}, {"$set": {"status": "errored", "error": response.error}})

    jobprogress = response.progresses.get(job_id, None)
    if not jobprogress:
        logger.error(f"request for {job_id=} produced incompatible {response=}")
        raise HTTPException(status_code=500, detail=f"Unable to retrieve status of {job_id}")

    elif jobprogress.failure:
        collection.update_one({"job_id": job_id}, {"$set": {"status": "errored", "error": jobprogress.failure}})
    elif jobprogress.completed or jobprogress.pct == "100.00":
        collection.update_one({"job_id": job_id}, {"$set": {"status": "completed"}})
    else:
        collection.update_one({"job_id": job_id}, {"$set": {"status": "running"}})

    progress = jobprogress.pct if jobprogress.pct else "0.00" if jobprogress.failure else "100.00"

    job = collection.find_one({"job_id": job_id})
    return JobProgressResponse(
        progress=progress,
        created_at=str(job["created_at"]),
        status=job["status"],
        error=jobprogress.failure,
    )


@router.get("/status")
async def get_status() -> JobProgressResponses:
    """Get progress of all tasks recorded in the database."""

    collection = db.get_collection("job_records")
    job_records = collection.find({})

    # Extract job IDs from the records
    job_ids = [record["job_id"] for record in job_records]

    for_status_job_ids = [job_id for job_id in job_ids if collection.find_one({"job_id": job_id})["status"] in ["running", "submitted"]]
    db_status_ids = list(set(job_ids) - set(for_status_job_ids))

    progresses = {job_id: get_job_progress(job_id) for job_id in for_status_job_ids}

    for job_id in db_status_ids:
        id_record = collection.find({"job_id": job_id})[0]
        status = id_record.get("status", "unknown")
        error = id_record.get("error", None)
        created_at = id_record.get("created_at", None)

        progresses[job_id] = JobProgressResponse(
            progress="0.00" if not status == "completed" else "100.00",
            status=status,
            created_at=str(created_at) if created_at else created_at,
            error=error,
        )

    # Sort job records by created_at timestamp
    sorted_job_ids = sorted(job_ids, key=lambda id: collection.find_one({"job_id": job_id}).get("created_at", 0))

    # Update progresses to reflect the sorted order
    progresses = {job_id: progresses[job_id] for job_id in sorted_job_ids if job_id in progresses}

    return JobProgressResponses(progresses=progresses, error=None)


@router.get("/{job_id}/status")
async def get_status_of_job(job_id: JobId = Depends(validate_job_id)) -> JobProgressResponse:
    """Get progress of a particular job."""
    return get_job_progress(job_id)


@router.get("/{job_id}/outputs")
async def get_outputs_of_job(job_id: JobId = Depends(validate_job_id)) -> list[TaskId]:
    """Get outputs of a job."""
    collection = db.get_collection("job_records")
    outputs = collection.find_one({"job_id": job_id})
    return outputs.get("outputs", [])


@router.post("/{job_id}/visualise")
async def visualise_job(job_id: JobId = Depends(validate_job_id), options: VisualisationOptions = Body(None)) -> HTMLResponse:
    """Visualise a job's execution graph.

    Retrieves the job's graph specification from the database, converts it to a cascade graph,
    and generates an HTML visualisation of the graph.
    """
    collection = db.get_collection("job_records")
    job = collection.find({"job_id": job_id})

    if not options:
        options = VisualisationOptions()

    spec = ExecutionSpecification(**json.loads(job[0]["graph_specification"]))
    return visualise(spec, options)


@router.get("/{job_id}/specification")
async def get_job_specification(job_id: JobId = Depends(validate_job_id)) -> ExecutionSpecification:
    """Get specification in the database of a job."""
    collection = db.get_collection("job_records")
    job = collection.find_one({"job_id": job_id})
    return ExecutionSpecification(**json.loads(job["graph_specification"]))


@router.get("/{job_id}/restart")
async def restart_job(job_id: JobId = Depends(validate_job_id), user: UserRead = Depends(current_active_user)) -> SubmitJobResponse:
    """Restart a job by executing its specification."""
    collection = db.get_collection("job_records")
    job = collection.find_one({"job_id": job_id})

    spec = job.get("graph_specification", None)
    if not spec:
        raise HTTPException(status_code=404, detail=f"Job {job_id} had no specification.")

    spec = ExecutionSpecification(**json.loads(spec))
    response = execute(spec, user)
    return response


@router.post("/upload")
async def upload_job(file: UploadFile, user: UserRead = Depends(current_active_user)) -> SubmitJobResponse:
    """Upload a job specification file and execute it."""
    if not file:
        raise HTTPException(status_code=400, detail="No file provided for upload.")

    spec = await file.read()
    import json

    spec = ExecutionSpecification(**json.loads(spec))
    response = execute(spec, user=user)

    return response


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
        delete = db.get_collection("job_records").delete_many({})
    return JobDeletionResponse(deleted_count=delete.deleted_count)


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
        delete = db.get_collection("job_records").delete_one({"job_id": job_id})
    return JobDeletionResponse(deleted_count=delete.deleted_count)
