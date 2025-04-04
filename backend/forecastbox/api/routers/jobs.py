"""Products API Router."""

import random
from fastapi import APIRouter, Response

from typing import Union
from dataclasses import dataclass

from forecastbox.products.registry import get_categories, get_product
from forecastbox.models import Model

from ..types import GraphSpecification

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

    response: api.JobProgressResponse = client.request_response(api.JobProgressRequest(job_ids=job_ids), f"{SETTINGS.cascade_url}")  # type: ignore
    if response.error:
        raise Exception(f"Job progress retrieval failed: {response.error}")
    response.progresses.update({record["job_id"]: "100" for record in job_records if record["status"] == "completed"})
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

    if progress_response.progresses[job_id] == "100":
        # Update the job record in MongoDB to mark it as completed
        db.update_one("job_records", {"job_id": job_id}, {"$set": {"status": "completed"}})
    return JobProgressResponse(progress=progress_response.progresses[job_id], error=progress_response.error)


@router.get("/outputs/{job_id}")
async def get_outputs_of_job(job_id: JobId) -> list[str]:
    """Get outputs of a job."""
    outputs = db.find("job_records", {"job_id": job_id})
    if not outputs:
        raise Exception(f"No outputs found for job ID: {job_id}")
    return outputs[0]["outputs"]


@router.post("/result")
async def get_result(job_id: JobId, dataset_id: DatasetId) -> api.ResultRetrievalResponse:
    return client.request_response(api.ResultRetrievalRequest(job_id=job_id, dataset_id=dataset_id), f"{SETTINGS.cascade_url}")  # type: ignore


@router.get("/flush")
async def flush_tasks() -> bool:
    db.delete_many("job_records", {})
    return True
