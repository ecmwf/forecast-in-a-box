"""Products API Router."""

import random
from fastapi import APIRouter, Response
from fastapi.responses import FileResponse, StreamingResponse, HTMLResponse

from typing import Union
from dataclasses import dataclass

from forecastbox.products.registry import get_categories, get_product
from forecastbox.models import Model

from cascade.low.core import JobInstance, DatasetId
from cascade.controller.report import JobId, JobProgress

import cascade.gateway.api as api
import cascade.gateway.client as client

from ..database import db

from forecastbox.settings import get_settings

router = APIRouter(
    tags=["jobs"],
    responses={404: {"description": "Not found"}},
)

SETTINGS = get_settings()


@router.get("/status")
async def get_tasks() -> api.JobProgressResponse:
    """Get progress of all tasks recorded in the database."""
    # Get all job records from the MongoDB collection
    job_records = db.find("job_records", {})

    # Extract job IDs from the records
    job_ids = [record["job_id"] for record in job_records if record["status"] == "submitted"]
    completed_job_ids = [record["job_id"] for record in job_records if record["status"] == "completed"]

    if not job_ids:
        return api.JobProgressResponse(progresses={record["job_id"]: "100.00" for record in completed_job_ids}, error=None)

    response: api.JobProgressResponse = client.request_response(api.JobProgressRequest(job_ids=job_ids), f"{SETTINGS.cascade_url}")  # type: ignore
    if response.error:
        raise Exception(f"Job progress retrieval failed: {response.error}")
    
    response.progresses.update({record["job_id"]: "100.00" for record in completed_job_ids})

    # Update the job records in MongoDB to mark them as completed
    for record in job_records:
        if record["status"] == "completed":
            db.update_one("job_records", {"job_id": record["job_id"]}, {"$set": {"status": "completed"}})

    return response


@dataclass
class JobProgressResponse:
    progress: JobProgress
    error: str | None = None


@router.get("/status/{job_id}")
async def get_status_of_job(job_id: JobId) -> JobProgressResponse:
    """Get progress of a job."""

    progress_response: api.JobProgressResponse = client.request_response(
        api.JobProgressRequest(job_ids=[job_id]), f"{SETTINGS.cascade_url}"
    )  # type: ignore
    if progress_response.error:
        raise Exception(f"Job progress retrieval failed: {progress_response.error}")

    if progress_response.progresses[job_id] == "100.00":
        # Update the job record in MongoDB to mark it as completed
        db.update_one("job_records", {"job_id": job_id}, {"$set": {"status": "completed"}})
    return JobProgressResponse(progress=progress_response.progresses[job_id].removesuffix('%'), error=progress_response.error)


@router.get("/outputs/{job_id}")
async def get_outputs_of_job(job_id: JobId) -> list[str]:
    """Get outputs of a job."""
    outputs = db.find("job_records", {"job_id": job_id})
    if not outputs:
        raise Exception(f"Job {job_id} not found in the database.")
    return outputs[0]["outputs"]


@router.get("/visualise/{job_id}")
async def visualise_job(job_id: JobId) -> list[str]:
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
async def restart_job(job_id: JobId):
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
        raise Exception(f"Result retrieval failed: {response.error}")

    import tempfile
    temp = tempfile.NamedTemporaryFile(delete=False)
    with open(temp.name, "wb") as f:
        f.write(response.result)
    print(temp.name)
    return FileResponse(temp.name, media_type="application/octet-stream", filename=f"{dataset_id}.pkl")
    



@router.get("/flush")
async def flush_tasks() -> bool:
    print('DELETED', db.delete_many("job_records", {}))
    return True
