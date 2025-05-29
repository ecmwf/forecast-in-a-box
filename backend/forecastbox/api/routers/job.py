# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Products API Router."""

from functools import lru_cache
import json
from fastapi import APIRouter, Response, Depends, UploadFile, Body
from fastapi.responses import HTMLResponse
from fastapi import HTTPException

from dataclasses import dataclass


from cascade.low.core import DatasetId, TaskId
from cascade.controller.report import JobId

import cascade.gateway.api as api
import cascade.gateway.client as client
from forecastbox.schemas.user import User
from forecastbox.auth.users import current_active_user

from forecastbox.db import db

from forecastbox.settings import CASCADE_SETTINGS
from forecastbox.api.types import VisualisationOptions, ExecutionSpecification

router = APIRouter(
    tags=["job"],
    responses={404: {"description": "Not found"}},
)


@dataclass
class JobProgressResponse:
    progress: str
    status: str
    created_at: str | None = None
    error: str | None = None


@dataclass
class JobProgressResponses:
    progresses: dict[JobId, JobProgressResponse]
    error: str | None = None


def validate_job_id(job_id: JobId) -> bool:
    collection = db.get_collection("job_records")
    if collection.find_one({"job_id": job_id}):
        return job_id
    raise HTTPException(status_code=404, detail=f"Job {job_id} not found in the database.")


def get_job_progress(job_id: JobId = Depends(validate_job_id)) -> JobProgressResponse:
    """Get progress of a job."""
    response = None
    error_on_request = None

    collection = db.get_collection("job_records")

    try:
        response: api.JobProgressResponse = client.request_response(
            api.JobProgressRequest(job_ids=[job_id]), f"{CASCADE_SETTINGS.cascade_url}"
        )  # type: ignore
    except TimeoutError as e:
        collection.update_one({"job_id": job_id}, {"$set": {"status": "errored"}})
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
        collection.update_one({"job_id": job_id}, {"$set": {"status": "errored"}})
        collection.update_one({"job_id": job_id}, {"$set": {"error": response.error}})

    jobprogress = response.progresses.get(job_id, None)

    if not jobprogress:
        collection.update_one({"job_id": job_id}, {"$set": {"status": "invalid"}})
        return JobProgressResponse(
            progress="0.00",
            status="invalid",
            error="Job not found in the database.",
        )
    elif jobprogress.failure:
        # Update the job record in MongoDB to mark it as errored
        collection.update_one({"job_id": job_id}, {"$set": {"status": "errored"}})
        collection.update_one({"job_id": job_id}, {"$set": {"error": jobprogress.failure}})
    elif jobprogress.completed or jobprogress.pct == "100.00":
        # Update the job record in MongoDB to mark it as completed
        collection.update_one({"job_id": job_id}, {"$set": {"status": "completed"}})
    else:
        # Update the job record in MongoDB to mark it as running
        collection.update_one({"job_id": job_id}, {"$set": {"status": "running"}})

    progress = jobprogress.pct if jobprogress.pct else "0.00" if jobprogress.failure else "100.00"

    return JobProgressResponse(
        progress=progress,
        created_at=collection.find({"job_id": job_id})[0]["created_at"],
        status=collection.find({"job_id": job_id})[0]["status"],
        error=jobprogress.failure,
    )


@router.get("/status")
async def get_status() -> JobProgressResponses:
    """Get progress of all tasks recorded in the database."""

    collection = db.get_collection("job_records")
    job_records = collection.find({})

    # Extract job IDs from the records
    job_ids = [record["job_id"] for record in job_records]

    for_status_job_ids = [id for id in job_ids if collection.find_one({"job_id": id})["status"] in ["running", "submitted"]]
    db_status_ids = list(set(job_ids) - set(for_status_job_ids))

    progresses = {job_id: get_job_progress(job_id) for job_id in for_status_job_ids}

    for id in db_status_ids:
        id_record = collection.find({"job_id": id})[0]
        status = id_record["status"]
        error = id_record["error"]
        created_at = id_record.get("created_at", None)
        progresses[id] = JobProgressResponse(
            progress="0.00" if not status == "completed" else "100.00", status=status, created_at=created_at, error=error
        )

    # Sort job records by created_at timestamp
    sorted_job_ids = sorted(job_ids, key=lambda id: collection.find_one({"job_id": id}).get("created_at", 0))

    # Update progresses to reflect the sorted order
    progresses = {id: progresses[id] for id in sorted_job_ids if id in progresses}

    return JobProgressResponses(progresses=progresses, error=None)


@router.get("/{job_id}/status")
async def get_status_of_job(job_id: JobId = Depends(validate_job_id)) -> JobProgressResponse:
    """Get progress of a job."""
    return get_job_progress(job_id)


@router.get("/{job_id}/outputs")
async def get_outputs_of_job(job_id: JobId = Depends(validate_job_id)) -> list[TaskId]:
    """Get outputs of a job."""
    collection = db.get_collection("job_records")
    outputs = collection.find({"job_id": job_id})
    return outputs[0]["outputs"]


@router.post("/{job_id}/visualise")
async def visualise_job(job_id: JobId = Depends(validate_job_id), options: VisualisationOptions = Body(None)) -> HTMLResponse:
    """Get outputs of a job."""
    collection = db.get_collection("job_records")
    job = collection.find({"job_id": job_id})

    if not options:
        options = VisualisationOptions()

    spec = ExecutionSpecification(**json.loads(job[0]["graph_specification"]))

    from .graph import convert_to_cascade

    try:
        graph = await convert_to_cascade(spec)
    except Exception as e:
        return HTMLResponse(str(e), status_code=500)

    import tempfile

    with tempfile.NamedTemporaryFile(suffix=".html") as dest:
        graph.visualise(dest.name, **options.model_dump())

        with open(dest.name, "r") as f:
            return HTMLResponse(f.read(), media_type="text/html")


@router.get("/{job_id}/specification")
async def get_job_specification(job_id: JobId = Depends(validate_job_id)) -> ExecutionSpecification:
    """Get specification of a job."""
    collection = db.get_collection("job_records")
    job = collection.find({"job_id": job_id})
    return ExecutionSpecification(**json.loads(job[0]["graph_specification"]))


@router.get("/{job_id}/restart")
async def restart_job(job_id: JobId = Depends(validate_job_id), user: User = Depends(current_active_user)) -> api.SubmitJobResponse:
    """Get outputs of a job."""
    collection = db.get_collection("job_records")
    job = collection.find({"job_id": job_id})

    spec = ExecutionSpecification(**json.loads(job[0]["graph_specification"]))

    from .graph import execute

    response = await execute(spec, user=user)
    if response.error:
        raise HTTPException(status_code=500, detail=response.error)
    return response


@router.post("/upload")
async def upload_job(file: UploadFile = None, user: User = Depends(current_active_user)) -> api.SubmitJobResponse:
    if not file:
        raise HTTPException(status_code=400, detail="No file provided for upload.")

    from .graph import execute

    spec = await file.read()
    import json

    spec = ExecutionSpecification(**json.loads(spec))
    response = await execute(spec, user=user)

    if response.error:
        raise HTTPException(status_code=500, detail=response.error)
    return response


@router.get("/{job_id}/info")
async def job_info(job_id: JobId = Depends(validate_job_id)) -> dict:
    """Get outputs of a job."""
    collection = db.get_collection("job_records")
    job = collection.find({"job_id": job_id})
    return job[0]


@dataclass
class DatasetAvailabilityResponse:
    available: bool


@router.get("/{job_id}/available")
async def get_job_availablity(job_id: JobId) -> list[TaskId]:
    """
    Check which results are available for a given job_id.

    Parameters
    ----------
    job_id : str
        Job ID of the task
    """
    response: api.JobProgressResponse = client.request_response(api.JobProgressRequest(job_ids=[job_id]), f"{CASCADE_SETTINGS.cascade_url}")

    return [x.task for x in response.datasets[job_id]]


@router.get("/{job_id}/{dataset_id}/available")
async def get_result_availablity(job_id: JobId, dataset_id: TaskId) -> DatasetAvailabilityResponse:
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
            api.JobProgressRequest(job_ids=[job_id]), f"{CASCADE_SETTINGS.cascade_url}"
        )
    except ValueError as e:
        raise HTTPException(status_code=500, detail=f"Job retrieval failed: {e}")

    if job_id not in response.datasets:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found in the database.")

    return DatasetAvailabilityResponse(dataset_id in [x.task for x in response.datasets[job_id]])


def to_bytes(obj) -> tuple[bytes, str]:
    """Convert an object to bytes."""
    import io

    if isinstance(obj, bytes):
        return obj, "application/octet-stream"

    try:
        from earthkit.plots import Figure

        if isinstance(obj, Figure):
            buf = io.BytesIO()
            obj.save(buf)
            return buf.getvalue(), "image/png"
    except ImportError:
        pass
    try:
        import earthkit.data as ekd

        encoder = ekd.create_encoder("grib")
        if isinstance(obj, ekd.Field):
            return encoder.encode(obj).to_bytes(), "application/octet-stream"
        elif isinstance(obj, ekd.FieldList):
            return encoder.encode(obj[0], template=obj[0]).to_bytes(), "application/octet-stream"
    except ImportError:
        pass

    raise TypeError(f"Unsupported type: {type(obj)}")


@lru_cache
def result_cache(job_id: JobId, dataset_id: TaskId) -> api.ResultRetrievalResponse:
    """Get the path to the result cache."""
    return client.request_response(
        api.ResultRetrievalRequest(job_id=job_id, dataset_id=DatasetId(task=dataset_id, output="0")), f"{CASCADE_SETTINGS.cascade_url}"
    )


@router.get("/{job_id}/{dataset_id}")
async def get_result(job_id: JobId, dataset_id: TaskId) -> Response:
    response = result_cache(job_id, dataset_id)
    if response.error:
        raise HTTPException(500, f"Result retrieval failed: {response.error}")

    try:
        from cascade.gateway.api import decoded_result

        result = decoded_result(response, job=None)
        bytez, media_type = to_bytes(result)
    except Exception:
        import cloudpickle

        media_type = "application/pickle"
        bytez = cloudpickle.dumps(result)
        # return Response(response.model_dump_json(), media_type=media_type)
        # raise HTTPException(500, f"Result retrieval failed: {e}")

    return Response(bytez, media_type=media_type)


@dataclass
class JobDeletionResponse:
    deleted_count: int


@router.post("/flush")
async def flush_job() -> JobDeletionResponse:
    """Flush all job from the database and cascade.

    Returns number of deleted jobs.
    """
    try:
        client.request_response(api.ResultDeletionRequest(datasets={}), f"{CASCADE_SETTINGS.cascade_url}")  # type: ignore
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
        client.request_response(api.ResultDeletionRequest(datasets={job_id: []}), f"{CASCADE_SETTINGS.cascade_url}")  # type: ignore
    except Exception as e:
        raise HTTPException(500, f"Job deletion failed: {e}")
    finally:
        delete = db.get_collection("job_records").delete_one({"job_id": job_id})
    return JobDeletionResponse(deleted_count=delete.deleted_count)
