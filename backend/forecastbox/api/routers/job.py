# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Job Monitoring API Router."""

from functools import lru_cache
import json
from typing import Literal
from fastapi import APIRouter, BackgroundTasks, Response, Depends, UploadFile, Body
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

from forecastbox.config import config
from forecastbox.api.types import VisualisationOptions, ExecutionSpecification
from forecastbox.api.routers.execution import execute, SubmitJobResponse

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

    record = collection.find_one({"id": job_id})
    if record:
        return job_id
    raise HTTPException(status_code=404, detail=f"Job {job_id} not found in the database.")


def get_cascade_job_id(job_id: JobId) -> JobId | None:
    """Get the cascade job ID from the job ID.

    Returns None if the record exists, but the job ID is not found in the database.
    Raises HTTPException if the job ID is not found in the database.
    """
    collection = db.get_collection("job_records")
    record = collection.find_one({"id": job_id})
    if record:
        return record.get("job_id", None)
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
    cascade_job_id = get_cascade_job_id(job_id)

    if not cascade_job_id:
        id_record = collection.find_one({"id": job_id})
        return JobProgressResponse(
            progress="0.00",
            status=id_record.get("status", "unknown"),
            created_at=str(id_record.get("created_at", None)),
            error=id_record.get("error", None),
        )

    try:
        response: api.JobProgressResponse = client.request_response(
            api.JobProgressRequest(job_ids=[cascade_job_id]), f"{config.cascade.cascade_url}"
        )  # type: ignore
    except TimeoutError as e:
        collection.update_one({"id": job_id}, {"$set": {"status": "timeout"}})
        error_on_request = f"TimeoutError: {e}"
    except KeyError as e:
        collection.update_one({"id": job_id}, {"$set": {"status": "invalid"}})
        error_on_request = f"KeyError: {e}"
    except Exception as e:
        collection.update_one({"id": job_id}, {"$set": {"status": "errored"}})
        error_on_request = f"Exception: {e}"

    finally:
        if response is None:
            return JobProgressResponse(
                progress="0.00",
                status=collection.find({"id": job_id})[0]["status"],
                error=error_on_request,
            )

    if response.error:
        collection.update_one({"id": job_id}, {"$set": {"status": "errored"}})
        collection.update_one({"id": job_id}, {"$set": {"error": response.error}})

    jobprogress = response.progresses.get(cascade_job_id, None)

    if not jobprogress:
        collection.update_one({"id": job_id}, {"$set": {"status": "invalid"}})
        return JobProgressResponse(
            progress="0.00",
            status="invalid",
            error="Job not found in the database.",
        )
    elif jobprogress.failure:
        # Update the job record in MongoDB to mark it as errored
        collection.update_one({"id": job_id}, {"$set": {"status": "errored"}})
        collection.update_one({"id": job_id}, {"$set": {"error": jobprogress.failure}})
    elif jobprogress.completed or jobprogress.pct == "100.00":
        # Update the job record in MongoDB to mark it as completed
        collection.update_one({"id": job_id}, {"$set": {"status": "completed"}})
    else:
        # Update the job record in MongoDB to mark it as running
        collection.update_one({"id": job_id}, {"$set": {"status": "running"}})

    progress = jobprogress.pct if jobprogress.pct else "0.00" if jobprogress.failure else "100.00"

    return JobProgressResponse(
        progress=progress,
        created_at=str(collection.find_one({"id": job_id})["created_at"]),
        status=collection.find_one({"id": job_id})["status"],
        error=jobprogress.failure,
    )


@router.get("/status")
async def get_status() -> JobProgressResponses:
    """Get progress of all tasks recorded in the database."""

    collection = db.get_collection("job_records")
    job_records = collection.find({})

    # Extract job IDs from the records
    job_ids = [record["id"] for record in job_records]

    for_status_job_ids = [id for id in job_ids if collection.find_one({"id": id})["status"] in ["running", "submitted"]]
    db_status_ids = list(set(job_ids) - set(for_status_job_ids))

    progresses = {job_id: get_job_progress(job_id) for job_id in for_status_job_ids}

    for id in db_status_ids:
        id_record = collection.find({"id": id})[0]
        status = id_record.get("status", "unknown")
        error = id_record.get("error", None)
        created_at = id_record.get("created_at", None)

        progresses[id] = JobProgressResponse(
            progress="0.00" if not status == "completed" else "100.00",
            status=status,
            created_at=str(created_at) if created_at else created_at,
            error=error,
        )

    # Sort job records by created_at timestamp
    sorted_job_ids = sorted(job_ids, key=lambda id: collection.find_one({"id": id}).get("created_at", 0))

    # Update progresses to reflect the sorted order
    progresses = {id: progresses[id] for id in sorted_job_ids if id in progresses}

    return JobProgressResponses(progresses=progresses, error=None)


@router.get("/{job_id}/status")
async def get_status_of_job(job_id: JobId = Depends(validate_job_id)) -> JobProgressResponse:
    """Get progress of a particular job."""
    return get_job_progress(job_id)


@router.get("/{job_id}/outputs")
async def get_outputs_of_job(job_id: JobId = Depends(validate_job_id)) -> list[TaskId]:
    """Get outputs of a job."""
    collection = db.get_collection("job_records")
    outputs = collection.find_one({"id": job_id})
    return outputs.get("outputs", [])


@router.post("/{job_id}/visualise")
async def visualise_job(job_id: JobId = Depends(validate_job_id), options: VisualisationOptions = Body(None)) -> HTMLResponse:
    """Visualise a job's execution graph.

    Retrieves the job's graph specification from the database, converts it to a cascade graph,
    and generates an HTML visualisation of the graph.
    """
    collection = db.get_collection("job_records")
    job = collection.find({"id": job_id})

    if not options:
        options = VisualisationOptions()

    spec = ExecutionSpecification(**json.loads(job[0]["graph_specification"]))

    from .execution import convert_to_cascade

    try:
        graph = convert_to_cascade(spec)
    except Exception as e:
        return HTMLResponse(str(e), status_code=500)

    import tempfile

    with tempfile.NamedTemporaryFile(suffix=".html") as dest:
        graph.visualise(dest.name, **options.model_dump())

        with open(dest.name, "r") as f:
            return HTMLResponse(f.read(), media_type="text/html")


@router.get("/{job_id}/specification")
async def get_job_specification(job_id: JobId = Depends(validate_job_id)) -> ExecutionSpecification:
    """Get specification in the database of a job."""
    collection = db.get_collection("job_records")
    job = collection.find_one({"id": job_id})
    return ExecutionSpecification(**json.loads(job["graph_specification"]))


@router.get("/{job_id}/restart")
async def restart_job(
    background_tasks: BackgroundTasks, job_id: JobId = Depends(validate_job_id), user: UserRead = Depends(current_active_user)
) -> SubmitJobResponse:
    """Restart a job by executing its specification."""
    collection = db.get_collection("job_records")
    job = collection.find_one({"id": job_id})

    spec = job.get("graph_specification", None)
    if not spec:
        raise HTTPException(status_code=404, detail=f"Job {job_id} had no specification.")

    spec = ExecutionSpecification(**json.loads(spec))
    response = await execute(spec, user=user, background_tasks=background_tasks)
    return response


@router.post("/upload")
async def upload_job(
    file: UploadFile, background_tasks: BackgroundTasks, user: UserRead = Depends(current_active_user)
) -> SubmitJobResponse:
    """Upload a job specification file and execute it."""
    if not file:
        raise HTTPException(status_code=400, detail="No file provided for upload.")

    spec = await file.read()
    import json

    spec = ExecutionSpecification(**json.loads(spec))
    response = await execute(spec, user=user, background_tasks=background_tasks)

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
    response: api.JobProgressResponse = client.request_response(
        api.JobProgressRequest(job_ids=[get_cascade_job_id(job_id)]), f"{config.cascade.cascade_url}"
    )

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

    cascade_job_id = get_cascade_job_id(job_id)
    try:
        response: api.JobProgressResponse = client.request_response(
            api.JobProgressRequest(job_ids=[cascade_job_id]), f"{config.cascade.cascade_url}"
        )
    except ValueError as e:
        raise HTTPException(status_code=500, detail=f"Job retrieval failed: {e}")

    if cascade_job_id not in response.datasets:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found in the database.")

    return DatasetAvailabilityResponse(dataset_id in [x.task for x in response.datasets[cascade_job_id]])


def to_bytes(obj) -> tuple[bytes, str]:
    """Convert an object to bytes."""
    import io

    if isinstance(obj, bytes):
        return obj, "application/pickle"

    try:
        from earthkit.plots import Figure

        if isinstance(obj, Figure):
            buf = io.BytesIO()
            obj.save(buf)
            return buf.getvalue(), "image/png"
    except ImportError:
        pass

    import earthkit.data as ekd
    import xarray as xr
    import numpy as np

    if isinstance(obj, ekd.FieldList):
        encoder = ekd.create_encoder("grib")
        if isinstance(obj, ekd.Field):
            return encoder.encode(obj).to_bytes(), "application/grib"
        elif isinstance(obj, ekd.FieldList):
            return encoder.encode(obj[0], template=obj[0]).to_bytes(), "application/grib"

    elif isinstance(obj, (xr.Dataset, xr.DataArray)):
        buf = io.BytesIO()
        obj.to_netcdf(buf, format="NETCDF4")
        return buf.getvalue(), "application/netcdf"

    elif isinstance(obj, np.ndarray):
        buf = io.BytesIO()
        np.save(buf, obj)
        return buf.getvalue(), "application/numpy"

    raise TypeError(f"Unsupported type: {type(obj)}")


@lru_cache
def result_cache(
    job_id: JobId = Depends(validate_job_id), dataset_id: TaskId = Depends(validate_dataset_id)
) -> api.ResultRetrievalResponse:
    """Retrieve the result of a job from Cascade.

    This function caches the result retrieval to avoid multiple requests for the same job and dataset ID.
    """
    return client.request_response(
        api.ResultRetrievalRequest(job_id=get_cascade_job_id(job_id), dataset_id=DatasetId(task=dataset_id, output="0")),
        f"{config.cascade.cascade_url}",
    )


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
    response = result_cache(job_id, dataset_id)
    if response.error:
        result_cache.cache_clear()
        raise HTTPException(500, f"Result retrieval failed: {response.error}")

    try:
        from cascade.gateway.api import decoded_result

        result = decoded_result(response, job=None)
        bytez, media_type = to_bytes(result)
    except Exception:
        import cloudpickle

        media_type = "application/clpkl"
        bytez = cloudpickle.dumps(result)

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
        result_cache.cache_clear()
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
        delete = db.get_collection("job_records").delete_one({"id": job_id})
    return JobDeletionResponse(deleted_count=delete.deleted_count)
