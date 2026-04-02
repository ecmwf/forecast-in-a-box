# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Canonical job-execution entity routes — /run/*"""

PREFIX = "/api/v1/run"
import asyncio
import io
import logging
import os
import pathlib
import zipfile
from typing import Annotated, cast

import cascade.gateway.api as cascade_api
import cascade.gateway.client as cascade_client
import orjson
from cascade.low.core import DatasetId, TaskId
from fastapi import APIRouter, Depends, Response
from fastapi.exceptions import HTTPException
from pydantic import BaseModel

import forecastbox.domain.run.db as run_db
import forecastbox.domain.run.service as run_service
from forecastbox.domain.run.cascade import encode_result
from forecastbox.domain.run.exceptions import RunAccessDenied, RunNotFound
from forecastbox.domain.run.service import ProductToOutputId
from forecastbox.entrypoint.auth.users import get_auth_context
from forecastbox.routes.gateway import Globals
from forecastbox.utility.auth import AuthContext
from forecastbox.utility.config import config
from forecastbox.utility.pagination import PaginationSpec

logger = logging.getLogger(__name__)

router = APIRouter(
    tags=["execution"],
    responses={404: {"description": "Not found"}},
)


# ---------------------------------------------------------------------------
# Route-local contracts
# ---------------------------------------------------------------------------


class RunId(BaseModel):
    """Identifies a job execution attempt, optionally pinning a specific attempt.

    Used as a Depends()-based query-param group on GET endpoints, and as a
    request body field on endpoints that address a specific attempt.
    """

    run_id: str
    attempt_count: int | None = None


class RunCreateRequest(BaseModel):
    blueprint_id: str
    blueprint_version: int | None = None


class RunCreateResponse(BaseModel):
    run_id: str
    attempt_count: int


class RunDetailResponse(BaseModel):
    run_id: str
    attempt_count: int
    status: str
    created_at: str
    updated_at: str
    blueprint_id: str
    blueprint_version: int
    error: str | None = None
    progress: str | None = None
    cascade_job_id: str | None = None


class RunListResponse(BaseModel):
    runs: list[RunDetailResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class RunRestartRequest(BaseModel):
    """Identifies the attempt to restart. ``attempt_count`` must match the current latest attempt."""

    run_id: str
    attempt_count: int


class RunRestartResponse(BaseModel):
    run_id: str
    attempt_count: int


class RunDeleteRequest(BaseModel):
    """Identifies the attempt to delete. ``attempt_count`` must match the current latest attempt."""

    run_id: str
    attempt_count: int


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _to_run_detail(domain_detail: run_service.RunDetail) -> RunDetailResponse:
    return RunDetailResponse(
        run_id=domain_detail.run_id,
        attempt_count=domain_detail.attempt_count,
        status=domain_detail.status,
        created_at=domain_detail.created_at,
        updated_at=domain_detail.updated_at,
        blueprint_id=domain_detail.blueprint_id,
        blueprint_version=domain_detail.blueprint_version,
        error=domain_detail.error,
        progress=domain_detail.progress,
        cascade_job_id=domain_detail.cascade_job_id,
    )


async def _resolve_run_with_cascade(
    execution_spec: RunId,
    auth_context: AuthContext,
) -> tuple[run_db.Run, str]:
    """Fetch a Run and validate it has a cascade_job_id.

    Raises HTTP 404 if not found or access denied, HTTP 409 if not yet submitted.
    """
    try:
        execution = await run_db.get_run(execution_spec.run_id, execution_spec.attempt_count, auth_context=auth_context)
    except RunNotFound:
        raise HTTPException(status_code=404, detail=f"Run {execution_spec.run_id!r} not found.")
    except RunAccessDenied:
        raise HTTPException(status_code=403, detail=f"Access denied to execution {execution_spec.run_id!r}.")
    cascade_job_id = cast(str | None, execution.cascade_job_id)
    if cascade_job_id is None:
        raise HTTPException(status_code=409, detail=f"Run {execution_spec.run_id!r} has not been submitted to cascade yet.")
    return execution, cascade_job_id


async def _build_run_logs_response(cascade_job_id: str, db_entity_ser: bytes) -> Response:
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
async def create_run(
    request: RunCreateRequest,
    auth_context: AuthContext = Depends(get_auth_context),
) -> RunCreateResponse:
    """Execute a saved blueprint.

    Loads the referenced blueprint, compiles it, submits it to cascade, and
    creates a linked execution row.
    """
    blueprint = await run_service.get_blueprint_for_execution(request.blueprint_id, request.blueprint_version)
    if blueprint is None:
        raise HTTPException(status_code=404, detail=f"Blueprint {request.blueprint_id!r} not found.")
    result = await run_service.execute(blueprint, auth_context)
    if result.t is None:
        raise HTTPException(status_code=500, detail=f"Failed to execute: {result.e}")
    return RunCreateResponse(run_id=result.t.run_id, attempt_count=result.t.attempt_count)


@router.get("/list")
async def list_runs(
    pagination: Annotated[PaginationSpec, Depends()],
    auth_context: AuthContext = Depends(get_auth_context),
) -> RunListResponse:
    """List the latest attempt of every execution visible to the caller, with pagination.

    Admins see all executions; regular users see only their own.
    """
    total = await run_db.count_runs(auth_context=auth_context)
    start = pagination.start()
    total_pages = pagination.total_pages(total)
    if start >= total and total > 0:
        raise HTTPException(status_code=404, detail="Page number out of range.")
    executions = list(await run_db.list_runs(auth_context=auth_context, offset=start, limit=pagination.page_size))
    details = [_to_run_detail(run_service.execution_to_detail(e)) for e in executions]
    return RunListResponse(runs=details, total=total, page=pagination.page, page_size=pagination.page_size, total_pages=total_pages)


@router.get("/get")
async def get_run(
    spec: Annotated[RunId, Depends()],
    auth_context: AuthContext = Depends(get_auth_context),
) -> RunDetailResponse:
    try:
        domain_detail = await run_service.poll_and_update_execution(spec.run_id, spec.attempt_count, auth_context)
    except RunNotFound:
        raise HTTPException(status_code=404, detail=f"Run {spec.run_id!r} not found.")
    except RunAccessDenied:
        raise HTTPException(status_code=403, detail=f"Access denied to execution {spec.run_id!r}.")
    return _to_run_detail(domain_detail)


@router.post("/restart")
async def restart_run(
    request: RunRestartRequest,
    auth_context: AuthContext = Depends(get_auth_context),
) -> RunRestartResponse:
    """Create a new attempt of an existing execution under the same logical id.

    ``attempt_count`` must match the current latest attempt to prevent races.
    Returns 409 if it does not match.
    """
    try:
        current = await run_db.get_run(request.run_id, auth_context=auth_context)
    except RunNotFound:
        raise HTTPException(status_code=404, detail=f"Run {request.run_id!r} not found.")
    except RunAccessDenied:
        raise HTTPException(status_code=403, detail=f"Access denied to execution {request.run_id!r}.")
    if cast(int, current.attempt_count) != request.attempt_count:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Attempt count conflict for execution {request.run_id!r}: "
                f"expected {request.attempt_count}, current is {current.attempt_count}."
            ),
        )
    try:
        result = await run_service.restart_run(request.run_id, auth_context)
    except RunNotFound:
        raise HTTPException(status_code=404, detail=f"Run {request.run_id!r} not found.")
    except RunAccessDenied:
        raise HTTPException(status_code=403, detail=f"Access denied to execution {request.run_id!r}.")
    if result.t is None:
        raise HTTPException(status_code=500, detail=f"Failed to restart: {result.e}")
    return RunRestartResponse(run_id=result.t.run_id, attempt_count=result.t.attempt_count)


@router.get("/outputAvailability")
async def get_run_output_availability(
    spec: Annotated[RunId, Depends()],
    auth_context: AuthContext = Depends(get_auth_context),
) -> list[TaskId]:
    """Check which output tasks are available for a given execution."""
    _, cascade_job_id = await _resolve_run_with_cascade(spec, auth_context)
    response = cascade_client.request_response(cascade_api.JobProgressRequest(job_ids=[cascade_job_id]), f"{config.cascade.cascade_url}")
    response = cast(cascade_api.JobProgressResponse, response)
    if cascade_job_id not in response.datasets:
        raise HTTPException(status_code=404, detail=f"Job {cascade_job_id} not found in gateway.")
    return [x.task for x in response.datasets[cascade_job_id]]


@router.get("/outputContent")
async def get_run_output_content(
    spec: Annotated[RunId, Depends()],
    dataset_id: str,
    auth_context: AuthContext = Depends(get_auth_context),
) -> Response:
    """Retrieve the result of a specific output task, encoded as bytes."""
    _, cascade_job_id = await _resolve_run_with_cascade(spec, auth_context)
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


@router.get("/logs")
async def get_run_logs(
    spec: Annotated[RunId, Depends()],
    auth_context: AuthContext = Depends(get_auth_context),
) -> Response:
    """Return a zip archive of logs for the given execution attempt."""
    db_entity, cascade_job_id = await _resolve_run_with_cascade(spec, auth_context)
    entity_dict = {col.name: getattr(db_entity, col.name) for col in db_entity.__table__.columns}
    return await _build_run_logs_response(cascade_job_id, orjson.dumps(entity_dict))


@router.post("/delete")
async def delete_run(
    request: RunDeleteRequest,
    auth_context: AuthContext = Depends(get_auth_context),
) -> None:
    """Delete an execution from the database and cascade.

    ``attempt_count`` must match the current latest attempt to prevent races.
    Returns 409 if it does not match.
    """
    try:
        current = await run_db.get_run(request.run_id, auth_context=auth_context)
    except RunNotFound:
        raise HTTPException(status_code=404, detail=f"Run {request.run_id!r} not found.")
    except RunAccessDenied:
        raise HTTPException(status_code=403, detail=f"Access denied to execution {request.run_id!r}.")
    if cast(int, current.attempt_count) != request.attempt_count:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Attempt count conflict for execution {request.run_id!r}: "
                f"expected {request.attempt_count}, current is {current.attempt_count}."
            ),
        )
    spec = RunId(run_id=request.run_id, attempt_count=request.attempt_count)
    _, cascade_job_id = await _resolve_run_with_cascade(spec, auth_context)
    try:
        cascade_client.request_response(
            cascade_api.ResultDeletionRequest(datasets={cascade_job_id: []}),  # type: ignore[invalid-argument-type]
            f"{config.cascade.cascade_url}",
        )
    except Exception as e:
        raise HTTPException(500, f"Job deletion failed: {e}")
    finally:
        try:
            await run_db.soft_delete_run(request.run_id, auth_context=auth_context)
        except (RunNotFound, RunAccessDenied):
            pass
