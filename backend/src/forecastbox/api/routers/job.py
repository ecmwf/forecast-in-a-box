# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Job Monitoring API Router."""

import asyncio
import io
import json
import logging
import os
import pathlib
import zipfile
from dataclasses import dataclass
from typing import Literal, cast

import cascade.gateway.api as api
import cascade.gateway.client as client
import orjson
from cascade.controller.report import JobId
from cascade.low.core import DatasetId, TaskId
from fastapi import APIRouter, Body, Depends, HTTPException, Response, UploadFile
from fastapi.responses import HTMLResponse

from forecastbox.api.execution import ProductToOutputId, SubmitJobResponse, execute2response, execute_v2, get_job_definition_for_execution, get_job_execution_specification_v2, restart_job_execution_v2
from forecastbox.api.routers.gateway import Globals
from forecastbox.api.types.jobs import ExecutionSpecification, JobExecuteV2Request, JobExecuteV2Response, JobExecutionListV2, JobExecutionStatusV2, JobSpecificationV2
from forecastbox.api.utils import encode_result
from forecastbox.auth.users import current_active_user
from forecastbox.config import config
from forecastbox.db.job import delete_all, delete_one, get_all, get_count, get_one, update_one
import forecastbox.db.jobs2 as db_jobs2
from forecastbox.schemas.job import JobRecord
from forecastbox.schemas.user import UserRead

logger = logging.getLogger(__name__)

router = APIRouter(
    tags=["job"],
    responses={404: {"description": "Not found"}},
)


STATUS = Literal["submitted", "running", "completed", "errored", "invalid", "timeout", "unknown"]


@dataclass(frozen=True, eq=True, slots=True)
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


def build_response(
    record: JobRecord, progress: str | None = None, error: str | None = None, status: STATUS | None = None
) -> JobProgressResponse:
    created_at = str(record.created_at)
    progress = progress or cast(str, record.progress) or "0.00"
    error = error or cast(str, record.error)
    status = status or cast(STATUS, record.status)
    return JobProgressResponse(progress=progress, created_at=created_at, status=status, error=error)


@dataclass(frozen=True, eq=True, slots=True)
class JobProgressResponses:
    """Job Progress Responses.

    Contains progress information for multiple jobs with pagination metadata.
    """

    progresses: dict[JobId, JobProgressResponse]
    """A dictionary mapping job IDs to their progress responses."""
    total: int
    """Total number of jobs in the database matching the filtering status."""
    page: int
    """Current page number."""
    page_size: int
    """Number of items per page."""
    total_pages: int
    """Total number of pages."""
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
    job = await get_one(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found in the database.")

    if job.status in ("running", "submitted"):
        try:
            response = client.request_response(api.JobProgressRequest(job_ids=[job_id]), f"{config.cascade.cascade_url}")
            response = cast(api.JobProgressResponse, response)
        except TimeoutError:
            # NOTE we dont update db because the job may still be running
            return build_response(job, status="timeout", error="failed to communicate with gateway")
        except Exception as e:
            logger.debug(f"inquiry for {job_id=} failed with {repr(e)}")
            # TODO this is either network or internal (eg serde) problem. Ideally fine-grain network into TimeoutError branch
            result = {"status": "unknown", "error": f"internal cascade failure: {repr(e)}"}
            await update_one(job_id, **result)
            return build_response(job, **result)  # type: ignore[invalid-argument-type] # literal not recognized
        if response.error:
            # NOTE we dont update db because the job may still be running
            return build_response(job, status="unknown", error=response.error)

        jobprogress = response.progresses.get(job_id)
        if jobprogress is None:
            result = {"status": "invalid", "error": "evicted from gateway"}
            await update_one(job_id, **result)
            return build_response(job, **result)  # type: ignore[invalid-argument-type] # literal not recognized
        elif jobprogress.failure:
            result = {"status": "errored", "error": jobprogress.failure}
            await update_one(job_id, **result)
            return build_response(job, **result)  # type: ignore[invalid-argument-type] # literal not recognized
        elif jobprogress.completed or jobprogress.pct == "100.00":
            result = {"status": "completed", "progress": "100.00"}
            await update_one(job_id, **result)
            return build_response(job, **result)  # type: ignore[invalid-argument-type] # literal not recognized
        else:
            result = {"status": "running", "progress": jobprogress.pct}
            await update_one(job_id, **result)
            return build_response(job, **result)  # type: ignore[invalid-argument-type] # literal not recognized

    else:
        return build_response(job)


@router.get("/status")
async def get_status(
    user: UserRead = Depends(current_active_user), page: int = 1, page_size: int = 10, status: STATUS | None = None
) -> JobProgressResponses:
    """Get progress of all tasks recorded in the database with pagination and filtering.

    Parameters
    ----------
    user : UserRead
        The current active user.
    page : int
        Page number (1-indexed).
    page_size : int
        Number of items per page.
    status : STATUS | None
        Filter by job status (submitted, running, completed, errored, invalid, timeout, unknown).

    Returns
    -------
    JobProgressResponses
        Paginated job progress responses with metadata.
    """

    if page < 1 or page_size < 1:
        raise HTTPException(status_code=400, detail="Page and page_size must be greater than 0.")

    total_jobs = await get_count(status)
    start = (page - 1) * page_size
    total_pages = (total_jobs + page_size - 1) // page_size if total_jobs > 0 else 0

    if start >= total_jobs and total_jobs > 0:
        raise HTTPException(status_code=404, detail="Page number out of range.")

    job_records = list(await get_all(status, start, page_size))

    progresses = {
        str(job.job_id): (await update_and_get_progress(job.job_id) if job.status in ["running", "submitted"] else build_response(job))
        for job in job_records
    }

    return JobProgressResponses(
        progresses=progresses, total=total_jobs, page=page, page_size=page_size, total_pages=total_pages, error=None
    )


@router.get("/{job_id}/status")
async def get_status_of_job(job_id: JobId = Depends(validate_job_id), user: UserRead = Depends(current_active_user)) -> JobProgressResponse:
    """Get progress of a particular job."""
    return await update_and_get_progress(job_id)


@router.get("/{job_id}/outputs")
async def get_outputs_of_job(job_id: JobId = Depends(validate_job_id), user=Depends(current_active_user)) -> list[ProductToOutputId]:
    """Get outputs of a job."""
    job = await get_one(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found in the database.")

    product_to_id_mappings = json.loads(str(job.outputs))
    if len(product_to_id_mappings) == 0:
        raise HTTPException(status_code=204, detail=f"Job {job_id} had no outputs recorded.")
    return [ProductToOutputId(**item) for item in product_to_id_mappings]


@router.get("/{job_id}/specification")
async def get_job_specification(
    job_id: JobId = Depends(validate_job_id), user: UserRead = Depends(current_active_user)
) -> ExecutionSpecification:
    """Get specification in the database of a job."""
    job = await get_one(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found in the database.")
    if job.graph_specification is None:
        raise HTTPException(status_code=404, detail=f"Job {job_id} had no specification.")
    spec = job.graph_specification
    if not spec:
        raise HTTPException(status_code=404, detail=f"Job {job_id} had no specification.")
    spec = cast(str, spec)
    return ExecutionSpecification(**json.loads(spec))


@router.post("/{job_id}/restart")
async def restart_job(job_id: JobId = Depends(validate_job_id), user: UserRead | None = Depends(current_active_user)) -> SubmitJobResponse:
    """Restart a job by executing its specification."""
    job = await get_one(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found in the database.")
    spec = job.graph_specification
    if not spec:
        raise HTTPException(status_code=404, detail=f"Job {job_id} had no specification.")
    spec = cast(str, spec)
    spec = ExecutionSpecification(**json.loads(spec))
    return await execute2response(spec, user)


@router.post("/upload")
async def upload_job(file: UploadFile, user: UserRead | None = Depends(current_active_user)) -> SubmitJobResponse:
    """Upload a job specification file and execute it."""
    if not file:
        raise HTTPException(status_code=400, detail="No file provided for upload.")

    # Validate file type
    if file.content_type not in ["application/json", "text/plain"]:
        raise HTTPException(status_code=400, detail=f"Invalid file type: {file.content_type}. Only JSON files are accepted.")

    # Validate file size (max 10MB)
    max_size = 10 * 1024 * 1024
    content = await file.read()
    if len(content) > max_size:
        raise HTTPException(status_code=413, detail=f"File too large. Maximum size is {max_size} bytes.")

    try:
        spec = ExecutionSpecification(**json.loads(content))
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON format: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid specification format: {str(e)}")

    return await execute2response(spec, user)


@dataclass(frozen=True, eq=True, slots=True)
class DatasetAvailabilityResponse:
    """Dataset Availability Response."""

    available: bool
    """Indicates whether the dataset is available for download."""


@router.get("/{job_id}/available")
async def get_job_availability(job_id: JobId = Depends(validate_job_id), user: UserRead = Depends(current_active_user)) -> list[TaskId]:
    """Check which results are available for a given job_id.

    Parameters
    ----------
    job_id : str
        Job ID of the task
    user: UserRead | None
        The current active user, if any.

    Returns
    -------
    list[TaskId]
        List of TaskIds that have an available output within this job.
    """
    response = client.request_response(api.JobProgressRequest(job_ids=[job_id]), f"{config.cascade.cascade_url}")
    response = cast(api.JobProgressResponse, response)

    if job_id not in response.datasets:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found in gateway.")

    return [x.task for x in response.datasets[job_id]]


@router.get("/{job_id}/{dataset_id}/available")
async def get_result_availability(
    job_id: JobId = Depends(validate_job_id),
    dataset_id: TaskId = Depends(validate_dataset_id),
    user: UserRead = Depends(current_active_user),
) -> DatasetAvailabilityResponse:
    """Check if the result is available for a given job_id and dataset_id.
    *DEPRECATED* use `get_job_availability` -- this one may malfunction for long or slashy or proxyed dataset_ids

    This is used to check if the result is available for download.

    Parameters
    ----------
    job_id : str
        Job ID of the task
    dataset_id : str
        Dataset Id of the task
        NOTE -- the param is TaskId, and we check if any of the actual DatasetIds corresponds to that task
    user: UserRead | None
        The current active user, if any.

    Returns
    -------
    DatasetAvailabilityResponse
        {'available': Availability of the result}
    """

    try:
        response = client.request_response(api.JobProgressRequest(job_ids=[job_id]), f"{config.cascade.cascade_url}")
        response = cast(api.JobProgressResponse, response)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Job retrieval failed: {repr(e)}")

    if job_id not in response.datasets:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found in gateway.")

    return DatasetAvailabilityResponse(dataset_id in [x.task for x in response.datasets[job_id]])


@router.get("/{job_id}/logs")
async def get_logs(job_id: JobId = Depends(validate_job_id), user: UserRead = Depends(current_active_user)) -> Response:
    """Returns a zip file with logs and other data for the purpose of troubleshooting"""

    logger.debug(f"getting logs for {job_id}")
    try:
        db_entity_raw = await get_one(job_id)
        db_entity = {c.name: getattr(db_entity_raw, c.name) for c in db_entity_raw.__table__.columns}
    except Exception as e:
        db_entity = {"error": repr(e)}
    logger.debug(f"{db_entity=} for {job_id}")

    try:
        request = api.JobProgressRequest(job_ids=[job_id])
        gw_state = client.request_response(request, f"{config.cascade.cascade_url}").model_dump()
    except TimeoutError:
        gw_state = {"progresses": {}, "datasets": {}, "error": "TimeoutError"}
    except Exception as e:
        gw_state = {"progresses": {}, "datasets": {}, "error": repr(e)}
    logger.debug(f"{gw_state=} for {job_id}")

    def _build_zip() -> tuple[bytes, str]:
        try:
            buffer = io.BytesIO()
            with zipfile.ZipFile(buffer, "a", zipfile.ZIP_DEFLATED) as zf:
                zf.writestr("db_entity.json", orjson.dumps(db_entity))
                zf.writestr("gw_state.json", orjson.dumps(gw_state))
                if not Globals.logs_directory:
                    zf.writestr("logs_directory.error.txt", "logs directory missing")
                else:
                    p = pathlib.Path(Globals.logs_directory.name)
                    f = ""
                    try:
                        for f in os.listdir(p):
                            jPref = f"job_{job_id}"
                            if f.startswith("gateway") or f.startswith(jPref):
                                zf.write(f"{p / f}", arcname=f)
                    except Exception as e:
                        zf.writestr("logs_directory.error.txt", f"{f} => {repr(e)}")
            return buffer.getvalue(), ""
        except Exception as e:
            logger.exception("building zip")
            return b"", repr(e)

    loop = asyncio.get_running_loop()
    bytez, error = await loop.run_in_executor(None, _build_zip)  # IO bound

    if not error:
        return Response(
            content=bytez,
            status_code=200,
            media_type="application/zip",
        )
    else:
        return Response(
            content=error,
            status_code=500,
            media_type="text/plain",
        )


@router.get("/{job_id}/results")
async def get_result(
    job_id: JobId = Depends(validate_job_id),
    dataset_id: TaskId = Depends(validate_dataset_id),
    user: UserRead = Depends(current_active_user),
) -> Response:
    """Get the result of a job.

    Parameters
    ----------
    job_id : JobId
        Job ID of the task, expected to be the id in the database, not the cascade job id.
    dataset_id : TaskId
        Dataset Id of the task, these can be found from /{job_id}/outputs.
        NOTE -- the param is TaskId, the actual DatasetId is formed by appending "0"
    user: UserRead | None
        The current active user, if any.

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
    response = cast(api.ResultRetrievalResponse, response)

    if response.error:
        raise HTTPException(500, f"Result retrieval failed: {response.error}")

    try:
        bytez, media_type = encode_result(response)
    except Exception as e:
        logger.exception("decoding failure")
        raise HTTPException(500, f"Result decoding failed: {repr(e)}")

    return Response(bytez, media_type=media_type)


@router.get("/{job_id}/results/{dataset_id}")
async def get_result_old(
    job_id: JobId = Depends(validate_job_id),
    dataset_id: TaskId = Depends(validate_dataset_id),
    user: UserRead = Depends(current_active_user),
) -> Response:
    """Get the result of a job.
    **Deprecated**: dataset_id may contain slashes, be too long, thwarted by proxy... Use `get_results` instead
    """

    return await get_result(job_id, dataset_id, user)


@dataclass(frozen=True, eq=True, slots=True)
class JobDeletionResponse:
    """Job Deletion Response."""

    deleted_count: int
    """Number of jobs deleted from the database."""


@router.post("/flush")
async def flush_job(user: UserRead = Depends(current_active_user)) -> JobDeletionResponse:
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
async def delete_job(job_id: JobId = Depends(validate_job_id), user: UserRead = Depends(current_active_user)) -> JobDeletionResponse:
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


@router.post("/execute")
async def execute_api(spec: ExecutionSpecification, user: UserRead | None = Depends(current_active_user)) -> SubmitJobResponse:
    """Execute a job based on the provided execution specification.

    Parameters
    ----------
    spec : ExecutionSpecification
        Execution specification containing model and product details.
    user : UserRead, optional
        User object, by default Depends(current_active_user)

    Returns
    -------
    SubmitJobResponse
        Job submission response containing the job ID.
    """
    return await execute2response(spec, user)


@router.post("/execute_v2")
async def execute_v2_api(request: JobExecuteV2Request, user: UserRead | None = Depends(current_active_user)) -> JobExecuteV2Response:
    """Execute a job via the v2 persistence path.

    Loads the referenced JobDefinition from the jobs2 store, compiles it, and
    submits it to cascade, always creating a linked JobExecution row.

    Parameters
    ----------
    request : JobExecuteV2Request
        job_definition_id (+ optional version) referencing a saved JobDefinition.
    user : UserRead, optional
        The current active user.

    Returns
    -------
    JobExecuteV2Response
        Contains the logical execution_id and attempt_count.
    """
    definition = await get_job_definition_for_execution(request.job_definition_id, request.job_definition_version)
    if definition is None:
        raise HTTPException(status_code=404, detail=f"JobDefinition {request.job_definition_id!r} not found")
    user_id = str(user.id) if user is not None else None
    result = await execute_v2(definition, user_id)
    if result.t is None:
        raise HTTPException(status_code=500, detail=f"Failed to execute because of {result.e}")
    return result.t


# ---------------------------------------------------------------------------
# v2 read endpoints
# ---------------------------------------------------------------------------


def _execution_to_status_v2(execution: object) -> JobExecutionStatusV2:
    from forecastbox.schemas.jobs2 import JobExecution as JobExecutionModel

    ex = cast(JobExecutionModel, execution)  # ty:ignore[redundant-cast]
    return JobExecutionStatusV2(
        execution_id=str(ex.id),  # ty:ignore[invalid-argument-type]
        attempt_count=cast(int, ex.attempt_count),
        status=cast(str, ex.status),
        created_at=str(ex.created_at),
        updated_at=str(ex.updated_at),
        job_definition_id=str(ex.job_definition_id),  # ty:ignore[invalid-argument-type]
        job_definition_version=cast(int, ex.job_definition_version),
        error=cast(str | None, ex.error),
        progress=cast(str | None, ex.progress),
        cascade_job_id=cast(str | None, ex.cascade_job_id),
    )


async def _poll_and_update_v2(execution_id: str, attempt_count: int | None) -> JobExecutionStatusV2:
    """Fetch a JobExecution, poll cascade if active, update db, and return current status."""
    from forecastbox.schemas.jobs2 import JobExecution as JobExecutionModel

    execution = await db_jobs2.get_job_execution(execution_id, attempt_count)
    if execution is None:
        raise HTTPException(status_code=404, detail=f"JobExecution {execution_id!r} not found.")

    ex = cast(JobExecutionModel, execution)  # ty:ignore[redundant-cast]
    actual_attempt = cast(int, ex.attempt_count)
    cascade_job_id = cast(str | None, ex.cascade_job_id)
    status = cast(str, ex.status)

    def _build(status_override: str | None = None, error_override: str | None = None, progress_override: str | None = None) -> JobExecutionStatusV2:
        return JobExecutionStatusV2(
            execution_id=str(ex.id),  # ty:ignore[invalid-argument-type]
            attempt_count=actual_attempt,
            status=status_override or status,
            created_at=str(ex.created_at),
            updated_at=str(ex.updated_at),
            job_definition_id=str(ex.job_definition_id),  # ty:ignore[invalid-argument-type]
            job_definition_version=cast(int, ex.job_definition_version),
            error=error_override if error_override is not None else cast(str | None, ex.error),
            progress=progress_override if progress_override is not None else cast(str | None, ex.progress),
            cascade_job_id=cascade_job_id,
        )

    if status in ("submitted", "preparing", "running") and cascade_job_id:
        try:
            response = client.request_response(api.JobProgressRequest(job_ids=[cascade_job_id]), f"{config.cascade.cascade_url}")
            response = cast(api.JobProgressResponse, response)
        except TimeoutError:
            return _build(status_override="unknown", error_override="failed to communicate with gateway")
        except Exception as e:
            return _build(status_override="unknown", error_override=f"internal cascade failure: {repr(e)}")

        if response.error:
            return _build(status_override="unknown", error_override=response.error)

        jobprogress = response.progresses.get(cascade_job_id)
        if jobprogress is None:
            await db_jobs2.update_job_execution_runtime(execution_id, actual_attempt, status="failed", error="evicted from gateway")
            return _build(status_override="failed", error_override="evicted from gateway")
        elif jobprogress.failure:
            await db_jobs2.update_job_execution_runtime(execution_id, actual_attempt, status="failed", error=jobprogress.failure)
            return _build(status_override="failed", error_override=jobprogress.failure)
        elif jobprogress.completed or jobprogress.pct == "100.00":
            await db_jobs2.update_job_execution_runtime(execution_id, actual_attempt, status="finished", progress="100.00")
            return _build(status_override="finished", progress_override="100.00")
        else:
            await db_jobs2.update_job_execution_runtime(execution_id, actual_attempt, status="running", progress=jobprogress.pct)
            return _build(status_override="running", progress_override=jobprogress.pct)

    return _build()


@router.get("/status_v2")
async def get_status_v2(user: UserRead = Depends(current_active_user)) -> JobExecutionListV2:
    """List the latest attempt of every v2 job execution."""
    executions = list(await db_jobs2.list_job_executions())
    statuses = [_execution_to_status_v2(e) for e in executions]
    return JobExecutionListV2(executions=statuses, total=len(statuses))


@router.get("/{execution_id}/status_v2")
async def get_status_of_execution_v2(
    execution_id: str,
    attempt_count: int | None = None,
    user: UserRead = Depends(current_active_user),
) -> JobExecutionStatusV2:
    """Get status for a specific v2 execution; defaults to the latest attempt."""
    return await _poll_and_update_v2(execution_id, attempt_count)


@router.get("/{execution_id}/outputs_v2")
async def get_outputs_of_execution_v2(
    execution_id: str,
    attempt_count: int | None = None,
    user: UserRead = Depends(current_active_user),
) -> list[ProductToOutputId]:
    """Get outputs for a specific v2 execution; defaults to the latest attempt."""
    execution = await db_jobs2.get_job_execution(execution_id, attempt_count)
    if execution is None:
        raise HTTPException(status_code=404, detail=f"JobExecution {execution_id!r} not found.")
    from forecastbox.schemas.jobs2 import JobExecution as JobExecutionModel

    ex = cast(JobExecutionModel, execution)  # ty:ignore[redundant-cast]
    raw_outputs = ex.outputs
    if not raw_outputs:
        raise HTTPException(status_code=204, detail=f"JobExecution {execution_id!r} has no outputs recorded.")
    return [ProductToOutputId(**item) for item in cast(list[dict], raw_outputs)]


@router.get("/{execution_id}/specification_v2")
async def get_specification_of_execution_v2(
    execution_id: str,
    attempt_count: int | None = None,
    user: UserRead = Depends(current_active_user),
) -> JobSpecificationV2:
    """Get the linked JobDefinition specification for a v2 execution attempt."""
    spec = await get_job_execution_specification_v2(execution_id, attempt_count)
    if spec is None:
        raise HTTPException(status_code=404, detail=f"JobExecution {execution_id!r} or its definition not found.")
    return spec


@router.post("/{execution_id}/restart_v2")
async def restart_execution_v2(
    execution_id: str,
    user: UserRead | None = Depends(current_active_user),
) -> JobExecuteV2Response:
    """Create a new attempt of an existing v2 execution under the same logical id."""
    user_id = str(user.id) if user is not None else None
    result = await restart_job_execution_v2(execution_id, user_id)
    if result.t is None:
        raise HTTPException(status_code=500, detail=f"Failed to restart: {result.e}")
    return result.t
