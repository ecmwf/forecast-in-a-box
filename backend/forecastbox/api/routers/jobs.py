"""Products API Router."""

from fastapi import APIRouter, Response
from fastapi.responses import FileResponse, StreamingResponse, HTMLResponse
from fastapi import HTTPException

from typing import Union
from dataclasses import dataclass

from forecastbox.products.registry import get_categories, get_product
from forecastbox.models import Model

from cascade.low.core import JobInstance, DatasetId
from cascade.controller.report import JobId, JobProgress

import cascade.gateway.api as api
import cascade.gateway.client as client

from ..database import db

from forecastbox.settings import APISettings

router = APIRouter(
    tags=["jobs"],
    responses={404: {"description": "Not found"}},
)

SETTINGS = APISettings()

@dataclass
class JobProgressResponse:
    progress: JobProgress
    status: str
    error: str | None = None


@dataclass
class JobProgressResponses():
    progresses: dict[JobId, JobProgressResponse]
    error: str | None = None


def get_job_progress(job_id: str) -> JobProgressResponse:
    """Get progress of a job."""
    try:
        response: api.JobProgressResponse = client.request_response(api.JobProgressRequest(job_ids=[job_id]), f"{SETTINGS.cascade_url}")  # type: ignore
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving job progress: {e}")
    
    if response.error:
        db.update_one("job_records", {"job_id": job_id}, {"$set": {"status": "errored"}})

    progress = response.progresses.get(job_id, "0.00").removesuffix('%')

    if progress == "100.00":
        # Update the job record in MongoDB to mark it as completed
        db.update_one("job_records", {"job_id": job_id}, {"$set": {"status": "completed"}})
    if float(progress) > 0.00:
        db.update_one("job_records", {"job_id": job_id}, {"$set": {"status": "running"}})
    else:
        db.update_one("job_records", {"job_id": job_id}, {"$set": {"status": "unknown"}})

    # Check if the job_id exists in the database
    if not db.find("job_records", {"job_id": job_id}):
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

    return JobProgressResponse(
        progress=progress.removesuffix('%'),
        status=db.find("job_records", {"job_id": job_id})[0]["status"],
        error=response.error
    )

@router.get("/status")
async def get_status() -> JobProgressResponses:
    """Get progress of all tasks recorded in the database."""
    # Get all job records from the MongoDB collection
    job_records = db.find("job_records", {})

    # Extract job IDs from the records
    job_ids = [record["job_id"] for record in job_records]

    completed_job_ids = [record["job_id"] for record in job_records if record["status"] == "completed"]
    for_status_job_ids = list(set(job_ids) - set(completed_job_ids))

    completed_job_progresses = {job_id: JobProgressResponse(progress="100.00", status="completed") for job_id in completed_job_ids}

    if not job_ids:
        return JobProgressResponses(progresses=completed_job_progresses)
    
    progresses = {job_id: get_job_progress(job_id) for job_id in for_status_job_ids}

    progresses.update(completed_job_progresses)
    progresses.update({job_id: JobProgressResponse(progress="0.00", status="unknown") for job_id in set(job_ids) - set(progresses.keys())})

    # Sort job records by created_at timestamp
    sorted_job_records = sorted(job_records, key=lambda record: record.get("created_at", 0))

    # Update progresses to reflect the sorted order
    progresses = {
        record["job_id"]: progresses[record["job_id"]]
        for record in sorted_job_records if record["job_id"] in progresses
    }

    return JobProgressResponses(
        progresses=progresses,
        error=None
    )


@router.get("/status/{job_id}")
async def get_status_of_job(job_id: JobId) -> JobProgressResponse:
    """Get progress of a job."""
    return get_job_progress(job_id)


@router.get("/outputs/{job_id}")
async def get_outputs_of_job(job_id: JobId) -> list[str]:
    """Get outputs of a job."""
    outputs = db.find("job_records", {"job_id": job_id})
    if not outputs:
        raise Exception(f"Job {job_id} not found in the database.")
    return outputs[0]["outputs"]


@router.get("/visualise/{job_id}")
async def visualise_job(job_id: JobId) -> HTMLResponse:
    """Get outputs of a job."""
    job = db.find("job_records", {"job_id": job_id})
    if not job:
        raise Exception(f"Job {job_id} not found in the database.")
    
    spec = job[0]["graph_specification"]    

    from .graph import convert_to_cascade
    graph = await convert_to_cascade(spec)

    import tempfile

    with tempfile.NamedTemporaryFile(suffix=".html") as dest:
        graph.visualise(dest.name, preset="blob")

        with open(dest.name, "r") as f:
            return HTMLResponse(f.read(), media_type="text/html")

@router.get("/restart/{job_id}")
async def restart_job(job_id: JobId) -> api.SubmitJobResponse:
    """Get outputs of a job."""
    job = db.find("job_records", {"job_id": job_id})
    if not job:
        raise Exception(f"Job {job_id} not found in the database.")
    
    spec = job[0]["graph_specification"]    

    from .graph import execute
    return await execute(spec)

@router.get("/result/{job_id}/{dataset_id}")
async def get_result(job_id: str, dataset_id: str) -> FileResponse:
    response: api.ResultRetrievalResponse = client.request_response(
        api.ResultRetrievalRequest(job_id=job_id, dataset_id=DatasetId(task = dataset_id, output='0')), f"{SETTINGS.cascade_url}"
    )
    if not response.result:
        raise HTTPException(404, f"Result retrieval failed: {response.error}")
    
    from cascade.gateway.api import decoded_result
    result = decoded_result(response, job=None)

    bytez, media_type = to_bytes(result)
    return Response(bytez, media_type=media_type)

@dataclass
class DatasetAvailabilityResponse:
    available: bool

@router.get("/available/{job_id}/{dataset_id}")
async def get_result_availablity(job_id: str, dataset_id: str) -> DatasetAvailabilityResponse:
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
    response: api.ResultRetrievalResponse = client.request_response(
        api.ResultRetrievalRequest(job_id=job_id, dataset_id=DatasetId(task = dataset_id, output='0')), f"{SETTINGS.cascade_url}"
    )
    if not response.result:
        return {'available': False}
    
    return {'available': True}
    
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

@dataclass
class JobDeletionResponse:
    deleted_count: int

@router.get("/flush")
async def flush_job() -> JobDeletionResponse:
    """Flush all job from the database and cascade.

    Returns number of deleted jobs.    
    """
    client.request_response(api.ResultDeletionRequest(datasets = {}), f"{SETTINGS.cascade_url}")  # type: ignore
    return db.delete_many("job_records", {})

@router.get("/delete/{job_id}")
async def delete_job(job_id) -> JobDeletionResponse:
    """Delete a job from the database and cascade.
    
    Returns number of deleted jobs.
    """
    client.request_response(api.ResultDeletionRequest(datasets = {job_id: []}), f"{SETTINGS.cascade_url}")  # type: ignore
    return db.delete_one("job_records", {'job_id': job_id})