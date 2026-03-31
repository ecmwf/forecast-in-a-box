# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Canonical job-job-execution entity routes — /execution/*"""

import asyncio
import io
import logging
import os
import pathlib
import zipfile
from typing import cast

import cascade.gateway.api as cascade_api
import cascade.gateway.client as cascade_client
import orjson
from cascade.low.core import DatasetId, TaskId
from fastapi import APIRouter, Depends, Response
from fastapi.exceptions import HTTPException
from pydantic import BaseModel

import forecastbox.domain.job_execution.db as job_execution_db
import forecastbox.domain.job_execution.service as job_execution_service
from forecastbox.api.routers.gateway import Globals
from forecastbox.api.utils import encode_result
from forecastbox.domain.job_execution.exceptions import JobExecutionAccessDenied, JobExecutionNotFound
from forecastbox.domain.job_execution.service import ProductToOutputId
from forecastbox.entrypoint.auth.users import get_auth_context
from forecastbox.utility.auth import AuthContext
from forecastbox.utility.config import config

logger = logging.getLogger(__name__)

router = APIRouter(
    tags=["execution"],
    responses={404: {"description": "Not found"}},
)


# ---------------------------------------------------------------------------
# Route-local contracts
# ---------------------------------------------------------------------------


class JobExecutionCreateRequest(BaseModel):
    job_definition_id: str
    job_definition_version: int | None = None


class JobExecutionCreateResponse(BaseModel):
    execution_id: str
    attempt_count: int


class JobExecutionDetail(BaseModel):
    execution_id: str
    attempt_count: int
    status: str
    created_at: str
    updated_at: str
    job_definition_id: str
    job_definition_version: int
    error: str | None = None
    progress: str | None = None
    cascade_job_id: str | None = None


class JobExecutionListResponse(BaseModel):
    executions: list[JobExecutionDetail]
    total: int
    page: int
    page_size: int
    total_pages: int


class JobExecutionRestartRequest(BaseModel):
    execution_id: str


class JobExecutionRestartResponse(BaseModel):
    execution_id: str
    attempt_count: int


class JobExecutionDeleteRequest(BaseModel):
    execution_id: str
    attempt_count: int | None = None


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _to_job_execution_detail(domain_detail) -> JobExecutionDetail:
    return JobExecutionDetail(
        execution_id=domain_detail.execution_id,
        attempt_count=domain_detail.attempt_count,
        status=domain_detail.status,
        created_at=domain_detail.created_at,
        updated_at=domain_detail.updated_at,
        job_definition_id=domain_detail.job_definition_id,
        job_definition_version=domain_detail.job_definition_version,
        error=domain_detail.error,
        progress=domain_detail.progress,
        cascade_job_id=domain_detail.cascade_job_id,
    )


async def _resolve_job_execution_with_cascade(
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
        raise HTTPException(status_code=403, detail=f"Access denied to execution {execution_id!r}.")
    cascade_job_id = cast(str | None, execution.cascade_job_id)
    if cascade_job_id is None:
        raise HTTPException(status_code=409, detail=f"JobExecution {execution_id!r} has not been submitted to cascade yet.")
    return execution, cascade_job_id


async def _build_job_execution_logs_response(cascade_job_id: str, db_entity_ser: bytes) -> Response:
    try:
        request = cascade_api.JobProgressRequest(job_ids=[cascade_job_id])
        gw_state = cascade_client.request_response(request, f"{config.cascade.cascade_url}").model_dump()
    except TimeoutError:
        gw_state = {"progresses": {}, "datasets": {}, "error": "TimeoutError"}
    except Exception as e:
        gw_state = {"progresses": {}, "datasets": {}, "error": repr(e)}

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
                            j_pref = f"job_{cascade_job_id}"
                            if f.startswith("gateway") or f.startswith(j_pref):
                                zf.write(f"{p / f}", arcname=f)
                    except Exception as e:
                        zf.writestr("logs_directory.error.txt", f"{f} => {repr(e)}")
            return buffer.getvalue(), ""
        except Exception as e:
            logger.exception("building zip")
            return b"", repr(e)

    loop = asyncio.get_running_loop()
    bytez, error = await loop.run_in_executor(None, _build_zip)
    if not error:
        return Response(content=bytez, status_code=200, media_type="application/zip")
    return Response(content=error, status_code=500, media_type="text/plain")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/create")
async def create_job_execution(
    request: JobExecutionCreateRequest,
    auth_context: AuthContext = Depends(get_auth_context),
) -> JobExecutionCreateResponse:
    """Execute a saved job definition.

    Loads the referenced definition, compiles it, submits it to cascade, and
    creates a linked execution row.
    """
    definition = await job_execution_service.get_job_definition_for_execution(request.job_definition_id, request.job_definition_version)
    if definition is None:
        raise HTTPException(status_code=404, detail=f"JobDefinition {request.job_definition_id!r} not found.")
    result = await job_execution_service.execute(definition, auth_context)
    if result.t is None:
        raise HTTPException(status_code=500, detail=f"Failed to execute: {result.e}")
    return JobExecutionCreateResponse(execution_id=result.t.execution_id, attempt_count=result.t.attempt_count)


@router.get("/list")
async def list_job_executions(
    auth_context: AuthContext = Depends(get_auth_context),
    page: int = 1,
    page_size: int = 10,
) -> JobExecutionListResponse:
    """List the latest attempt of every execution visible to the caller, with pagination.

    Admins see all executions; regular users see only their own.
    """
    if page < 1 or page_size < 1:
        raise HTTPException(status_code=400, detail="page and page_size must be greater than 0.")
    total = await job_execution_db.count_job_executions(auth_context=auth_context)
    start = (page - 1) * page_size
    total_pages = (total + page_size - 1) // page_size if total > 0 else 0
    if start >= total and total > 0:
        raise HTTPException(status_code=404, detail="Page number out of range.")
    executions = list(await job_execution_db.list_job_executions(auth_context=auth_context, offset=start, limit=page_size))
    details = [_to_job_execution_detail(job_execution_service.execution_to_detail(e)) for e in executions]
    return JobExecutionListResponse(executions=details, total=total, page=page, page_size=page_size, total_pages=total_pages)


@router.get("/get")
async def get_job_execution(
    execution_id: str,
    attempt_count: int | None = None,
    auth_context: AuthContext = Depends(get_auth_context),
) -> JobExecutionDetail:
    """Get status and detail for a specific execution; defaults to the latest attempt."""
    try:
        domain_detail = await job_execution_service.poll_and_update_execution(execution_id, attempt_count, auth_context)
    except JobExecutionNotFound:
        raise HTTPException(status_code=404, detail=f"JobExecution {execution_id!r} not found.")
    except JobExecutionAccessDenied:
        raise HTTPException(status_code=403, detail=f"Access denied to execution {execution_id!r}.")
    return _to_job_execution_detail(domain_detail)


@router.post("/restart")
async def restart_job_execution(
    request: JobExecutionRestartRequest,
    auth_context: AuthContext = Depends(get_auth_context),
) -> JobExecutionRestartResponse:
    """Create a new attempt of an existing execution under the same logical id."""
    try:
        result = await job_execution_service.restart_job_execution(request.execution_id, auth_context)
    except JobExecutionNotFound:
        raise HTTPException(status_code=404, detail=f"JobExecution {request.execution_id!r} not found.")
    except JobExecutionAccessDenied:
        raise HTTPException(status_code=403, detail=f"Access denied to execution {request.execution_id!r}.")
    if result.t is None:
        raise HTTPException(status_code=500, detail=f"Failed to restart: {result.e}")
    return JobExecutionRestartResponse(execution_id=result.t.execution_id, attempt_count=result.t.attempt_count)


@router.get("/outputAvailability")
async def get_job_execution_output_availability(
    execution_id: str,
    attempt_count: int | None = None,
    auth_context: AuthContext = Depends(get_auth_context),
) -> list[TaskId]:
    """Check which output tasks are available for a given execution."""
    _, cascade_job_id = await _resolve_job_execution_with_cascade(execution_id, attempt_count, auth_context)
    response = cascade_client.request_response(cascade_api.JobProgressRequest(job_ids=[cascade_job_id]), f"{config.cascade.cascade_url}")
    response = cast(cascade_api.JobProgressResponse, response)
    if cascade_job_id not in response.datasets:
        raise HTTPException(status_code=404, detail=f"Job {cascade_job_id} not found in gateway.")
    return [x.task for x in response.datasets[cascade_job_id]]


@router.get("/outputContent")
async def get_job_execution_output_content(
    execution_id: str,
    dataset_id: str,
    attempt_count: int | None = None,
    auth_context: AuthContext = Depends(get_auth_context),
) -> Response:
    """Retrieve the result of a specific output task, encoded as bytes."""
    _, cascade_job_id = await _resolve_job_execution_with_cascade(execution_id, attempt_count, auth_context)
    response = cascade_client.request_response(
        cascade_api.ResultRetrievalRequest(job_id=cascade_job_id, dataset_id=DatasetId(task=dataset_id, output="0")),
        f"{config.cascade.cascade_url}",
    )
    response = cast(cascade_api.ResultRetrievalResponse, response)
    if response.error:
        raise HTTPException(500, f"Result retrieval failed: {response.error}")
    try:
        bytez, media_type = encode_result(response)
    except Exception as e:
        logger.exception("decoding failure")
        raise HTTPException(500, f"Result decoding failed: {repr(e)}")
    return Response(bytez, media_type=media_type)


@router.get("/definition")
async def get_job_execution_definition(
    execution_id: str,
    attempt_count: int | None = None,
    auth_context: AuthContext = Depends(get_auth_context),
):
    """Get the job specification linked to an execution attempt."""
    try:
        return await job_execution_service.get_job_execution_specification(execution_id, attempt_count, auth_context)
    except JobExecutionNotFound:
        raise HTTPException(status_code=404, detail=f"JobExecution {execution_id!r} or its definition not found.")
    except JobExecutionAccessDenied:
        raise HTTPException(status_code=403, detail=f"Access denied to execution {execution_id!r}.")


@router.get("/logs")
async def get_job_execution_logs(
    execution_id: str,
    attempt_count: int | None = None,
    auth_context: AuthContext = Depends(get_auth_context),
) -> Response:
    """Return a zip archive of logs for the given execution attempt."""
    db_entity, cascade_job_id = await _resolve_job_execution_with_cascade(execution_id, attempt_count, auth_context)
    entity_dict = {col.name: getattr(db_entity, col.name) for col in db_entity.__table__.columns}
    return await _build_job_execution_logs_response(cascade_job_id, orjson.dumps(entity_dict))


@router.post("/delete")
async def delete_job_execution(
    request: JobExecutionDeleteRequest,
    auth_context: AuthContext = Depends(get_auth_context),
) -> None:
    """Delete an execution from the database and cascade."""
    _, cascade_job_id = await _resolve_job_execution_with_cascade(request.execution_id, request.attempt_count, auth_context)
    try:
        cascade_client.request_response(
            cascade_api.ResultDeletionRequest(datasets={cascade_job_id: []}),  # type: ignore[invalid-argument-type]
            f"{config.cascade.cascade_url}",
        )
    except Exception as e:
        raise HTTPException(500, f"Job deletion failed: {e}")
    finally:
        try:
            await job_execution_db.soft_delete_job_execution(request.execution_id, auth_context=auth_context)
        except (JobExecutionNotFound, JobExecutionAccessDenied):
            pass
