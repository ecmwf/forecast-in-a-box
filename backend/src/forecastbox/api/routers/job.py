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
import logging
import os
import pathlib
import zipfile
from typing import cast

import cascade.gateway.api as api
import cascade.gateway.client as client
import orjson
from cascade.low.core import DatasetId, TaskId
from fastapi import APIRouter, Depends, HTTPException, Response

import forecastbox.domain.job_execution.db as job_execution_db
import forecastbox.domain.job_execution.service as job_execution_service
from forecastbox.api.types.jobs import (
    JobExecuteRequest,
    JobExecuteResponse,
    JobExecutionDetail,
    JobExecutionList,
    JobSpecification,
)
from forecastbox.api.utils import encode_result
from forecastbox.domain.job_execution.exceptions import JobExecutionAccessDenied, JobExecutionNotFound
from forecastbox.domain.job_execution.service import ProductToOutputId
from forecastbox.entrypoint.auth.users import get_auth_context
from forecastbox.routes.gateway import Globals
from forecastbox.utility.auth import AuthContext
from forecastbox.utility.config import config

logger = logging.getLogger(__name__)

router = APIRouter(
    tags=["job"],
    responses={404: {"description": "Not found"}},
)


def validate_dataset_id(dataset_id: str) -> str:
    """Validate the dataset ID."""
    return dataset_id


async def _get_logs(cascade_job_id: str, db_entity_ser: bytes) -> Response:
    try:
        request = api.JobProgressRequest(job_ids=[cascade_job_id])
        gw_state = client.request_response(request, f"{config.cascade.cascade_url}").model_dump()
    except TimeoutError:
        gw_state = {"progresses": {}, "datasets": {}, "error": "TimeoutError"}
    except Exception as e:
        gw_state = {"progresses": {}, "datasets": {}, "error": repr(e)}
    logger.debug(f"{gw_state=} for {cascade_job_id}")

    def _build_zip() -> tuple[bytes, str]:
        try:
            buffer = io.BytesIO()
            with zipfile.ZipFile(buffer, "a", zipfile.ZIP_DEFLATED) as zf:
                zf.writestr("db_entity.json", db_entity_ser)
                zf.writestr("gw_state.json", orjson.dumps(gw_state))
                if not Globals.logs_directory:
                    zf.writestr("logs_directory.error.txt", "logs directory missing")
                else:
                    p = pathlib.Path(Globals.logs_directory.name)
                    f = ""
                    try:
                        for f in os.listdir(p):
                            jPref = f"job_{cascade_job_id}"
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


async def _resolve_execution_with_cascade(
    execution_id: str,
    attempt_count: int | None,
    auth_context: AuthContext,
) -> tuple[job_execution_db.JobExecution, str]:
    """Fetch a JobExecution and validate it has a cascade_job_id.

    Raises HTTP 404 if not found or access denied, HTTP 409 if not yet submitted.
    """
    try:
        execution = await job_execution_db.get_job_execution(execution_id, attempt_count, auth_context=auth_context)
    except JobExecutionNotFound:
        raise HTTPException(status_code=404, detail=f"JobExecution {execution_id!r} not found.")
    except JobExecutionAccessDenied:
        raise HTTPException(status_code=403, detail=f"Access denied to JobExecution {execution_id!r}.")

    cascade_job_id = cast(str | None, execution.cascade_job_id)
    if cascade_job_id is None:
        raise HTTPException(status_code=409, detail=f"JobExecution {execution_id!r} has not been submitted to cascade yet.")
    return execution, cascade_job_id


@router.post("/execute")
async def execute_api(request: JobExecuteRequest, auth_context: AuthContext = Depends(get_auth_context)) -> JobExecuteResponse:
    """Execute a job

    Loads the referenced JobDefinition from the jobs store, compiles it, and
    submits it to cascade, always creating a linked JobExecution row.

    Parameters
    ----------
    request : JobExecuteRequest
        job_definition_id (+ optional version) referencing a saved JobDefinition.
    user : UserRead, optional
        The current active user.

    Returns
    -------
    JobExecuteResponse
        Contains the logical execution_id and attempt_count.
    """
    definition = await job_execution_service.get_job_definition_for_execution(request.job_definition_id, request.job_definition_version)
    if definition is None:
        raise HTTPException(status_code=404, detail=f"JobDefinition {request.job_definition_id!r} not found")
    result = await job_execution_service.execute(definition, auth_context)
    if result.t is None:
        raise HTTPException(status_code=500, detail=f"Failed to execute because of {result.e}")
    return result.t


# ---------------------------------------------------------------------------
# read endpoints
# ---------------------------------------------------------------------------


@router.get("/status")
async def get_status(
    auth_context: AuthContext = Depends(get_auth_context),
    page: int = 1,
    page_size: int = 10,
) -> JobExecutionList:
    """List the latest attempt of every job execution visible to the caller, with pagination.

    Admins see all executions.  Regular users see only their own.
    Orders by creation time, descending.
    """
    if page < 1 or page_size < 1:
        raise HTTPException(status_code=400, detail="Page and page_size must be greater than 0.")

    total = await job_execution_db.count_job_executions(auth_context=auth_context)
    start = (page - 1) * page_size
    total_pages = (total + page_size - 1) // page_size if total > 0 else 0

    if start >= total and total > 0:
        raise HTTPException(status_code=404, detail="Page number out of range.")

    executions = list(await job_execution_db.list_job_executions(auth_context=auth_context, offset=start, limit=page_size))
    details = [job_execution_service.execution_to_detail(e) for e in executions]
    return JobExecutionList(executions=details, total=total, page=page, page_size=page_size, total_pages=total_pages)


@router.get("/{execution_id}/status")
async def get_status_of_execution(
    execution_id: str,
    attempt_count: int | None = None,
    auth_context: AuthContext = Depends(get_auth_context),
) -> JobExecutionDetail:
    """Get status for a specific execution; defaults to the latest attempt."""
    try:
        return await job_execution_service.poll_and_update_execution(execution_id, attempt_count, auth_context)
    except JobExecutionNotFound:
        raise HTTPException(status_code=404, detail=f"JobExecution {execution_id!r} not found.")
    except JobExecutionAccessDenied:
        raise HTTPException(status_code=403, detail=f"Access denied to JobExecution {execution_id!r}.")


@router.get("/{execution_id}/outputs")
async def get_outputs_of_execution(
    execution_id: str,
    attempt_count: int | None = None,
    auth_context: AuthContext = Depends(get_auth_context),
) -> list[ProductToOutputId]:
    """Get outputs for a specific execution; defaults to the latest attempt."""
    try:
        execution = await job_execution_db.get_job_execution(execution_id, attempt_count, auth_context=auth_context)
    except JobExecutionNotFound:
        raise HTTPException(status_code=404, detail=f"JobExecution {execution_id!r} not found.")
    except JobExecutionAccessDenied:
        raise HTTPException(status_code=403, detail=f"Access denied to JobExecution {execution_id!r}.")

    raw_outputs = execution.outputs
    if not raw_outputs:
        raise HTTPException(status_code=204, detail=f"JobExecution {execution_id!r} has no outputs recorded.")
    return [ProductToOutputId(**item) for item in cast(list[dict], raw_outputs)]


@router.get("/{execution_id}/specification")
async def get_specification_of_execution(
    execution_id: str,
    attempt_count: int | None = None,
    auth_context: AuthContext = Depends(get_auth_context),
) -> JobSpecification:
    """Get the linked JobDefinition specification for a execution attempt."""
    try:
        return await job_execution_service.get_job_execution_specification(execution_id, attempt_count, auth_context)
    except JobExecutionNotFound:
        raise HTTPException(status_code=404, detail=f"JobExecution {execution_id!r} or its definition not found.")
    except JobExecutionAccessDenied:
        raise HTTPException(status_code=403, detail=f"Access denied to JobExecution {execution_id!r}.")


@router.post("/{execution_id}/restart")
async def restart_execution(
    execution_id: str,
    auth_context: AuthContext = Depends(get_auth_context),
) -> JobExecuteResponse:
    """Create a new attempt of an existing execution under the same logical id."""
    try:
        result = await job_execution_service.restart_job_execution(execution_id, auth_context)
    except JobExecutionNotFound:
        raise HTTPException(status_code=404, detail=f"JobExecution {execution_id!r} not found.")
    except JobExecutionAccessDenied:
        raise HTTPException(status_code=403, detail=f"Access denied to JobExecution {execution_id!r}.")
    if result.t is None:
        raise HTTPException(status_code=500, detail=f"Failed to restart: {result.e}")
    return result.t


@router.get("/{execution_id}/available")
async def get_job_availability(
    execution_id: str, attempt_count: int | None = None, auth_context: AuthContext = Depends(get_auth_context)
) -> list[TaskId]:
    """Check which results are available for a given execution."""
    _, cascade_job_id = await _resolve_execution_with_cascade(execution_id, attempt_count, auth_context)
    response = client.request_response(api.JobProgressRequest(job_ids=[cascade_job_id]), f"{config.cascade.cascade_url}")
    response = cast(api.JobProgressResponse, response)
    if cascade_job_id not in response.datasets:
        raise HTTPException(status_code=404, detail=f"Job {cascade_job_id} not found in gateway.")

    return [x.task for x in response.datasets[cascade_job_id]]


@router.get("/{execution_id}/results")
async def get_result(
    execution_id: str,
    attempt_count: int | None = None,
    dataset_id: TaskId = Depends(validate_dataset_id),
    auth_context: AuthContext = Depends(get_auth_context),
) -> Response:
    """Get the result of a job. Returns response containing the result of the job, encoded as bytes."""
    _, cascade_job_id = await _resolve_execution_with_cascade(execution_id, attempt_count, auth_context)
    response = client.request_response(
        api.ResultRetrievalRequest(job_id=cascade_job_id, dataset_id=DatasetId(task=dataset_id, output="0")),
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


@router.get("/{execution_id}/logs")
async def get_logs(execution_id: str, attempt_count: int | None = None, auth_context: AuthContext = Depends(get_auth_context)) -> Response:
    db_entity, cascade_job_id = await _resolve_execution_with_cascade(execution_id, attempt_count, auth_context)
    entity_dict = {col.name: getattr(db_entity, col.name) for col in db_entity.__table__.columns}
    return await _get_logs(cascade_job_id, orjson.dumps(entity_dict))


@router.delete("/delete")
async def delete_job(execution_id: str, attempt_count: int | None = None, auth_context: AuthContext = Depends(get_auth_context)) -> None:
    """Delete a job from the database and cascade."""
    _, cascade_job_id = await _resolve_execution_with_cascade(execution_id, attempt_count, auth_context)
    try:
        client.request_response(api.ResultDeletionRequest(datasets={cascade_job_id: []}), f"{config.cascade.cascade_url}")  # type: ignore
    except Exception as e:
        raise HTTPException(500, f"Job deletion failed: {e}")
    finally:
        try:
            await job_execution_db.soft_delete_job_execution(execution_id, auth_context=auth_context)
        except (JobExecutionNotFound, JobExecutionAccessDenied):
            pass  # best-effort; cascade deletion already attempted
