# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Canonical job-definition entity routes — /job_definition/*"""

from typing import cast

from fastapi import APIRouter, Depends
from fastapi.exceptions import HTTPException
from pydantic import BaseModel

import forecastbox.domain.job_definition.db as job_definition_db
import forecastbox.domain.job_definition.service as job_definition_service
from forecastbox.api.types.fable import FableBuilder, FableSaveRequest
from forecastbox.domain.job_definition.exceptions import JobDefinitionAccessDenied, JobDefinitionNotFound
from forecastbox.entrypoint.auth.users import get_auth_context
from forecastbox.utility.auth import AuthContext

router = APIRouter(
    tags=["definition"],
    responses={404: {"description": "Not found"}},
)


# ---------------------------------------------------------------------------
# Route-local contracts
# ---------------------------------------------------------------------------


class JobDefinitionCreateRequest(BaseModel):
    builder: FableBuilder
    display_name: str | None = None
    display_description: str | None = None
    tags: list[str] = []
    parent_id: str | None = None


class JobDefinitionCreateResponse(BaseModel):
    job_definition_id: str
    version: int


class JobDefinitionGetResponse(BaseModel):
    job_definition_id: str
    version: int
    builder: FableBuilder
    display_name: str | None = None
    display_description: str | None = None
    tags: list[str] = []
    parent_id: str | None = None


class JobDefinitionListItem(BaseModel):
    job_definition_id: str
    version: int
    display_name: str | None = None
    display_description: str | None = None
    tags: list[str] | None = None
    source: str | None = None
    created_by: str | None = None


class JobDefinitionListResponse(BaseModel):
    definitions: list[JobDefinitionListItem]
    total: int


class JobDefinitionUpdateRequest(BaseModel):
    job_definition_id: str
    builder: FableBuilder
    display_name: str | None = None
    display_description: str | None = None
    tags: list[str] = []
    parent_id: str | None = None


class JobDefinitionUpdateResponse(BaseModel):
    job_definition_id: str
    version: int


class JobDefinitionDeleteRequest(BaseModel):
    job_definition_id: str


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/create")
async def create_job_definition(
    request: JobDefinitionCreateRequest,
    auth_context: AuthContext = Depends(get_auth_context),
) -> JobDefinitionCreateResponse:
    """Create a new job definition from a FableBuilder."""
    payload = FableSaveRequest(
        builder=request.builder,
        display_name=request.display_name,
        display_description=request.display_description,
        tags=request.tags,
        parent_id=request.parent_id,
    )
    try:
        result = await job_definition_service.save_builder(auth_context=auth_context, payload=payload, fable_id=None)
    except JobDefinitionNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    except JobDefinitionAccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))
    return JobDefinitionCreateResponse(job_definition_id=result.id, version=result.version)


@router.get("/get")
async def get_job_definition(
    job_definition_id: str,
    version: int | None = None,
) -> JobDefinitionGetResponse:
    """Retrieve a saved job definition by id and optional version.

    Returns the latest non-deleted version when version is omitted.
    """
    try:
        retrieved = await job_definition_service.load_builder(job_definition_id, version)
    except JobDefinitionNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    return JobDefinitionGetResponse(
        job_definition_id=retrieved.id,
        version=retrieved.version,
        builder=retrieved.builder,
        display_name=retrieved.display_name,
        display_description=retrieved.display_description,
        tags=retrieved.tags,
        parent_id=retrieved.parent_id,
    )


@router.get("/list")
async def list_job_definitions(
    auth_context: AuthContext = Depends(get_auth_context),
) -> JobDefinitionListResponse:
    """List the latest non-deleted version of every job definition visible to the caller."""
    definitions = list(await job_definition_db.list_job_definitions(auth_context=auth_context))
    items = [
        JobDefinitionListItem(
            job_definition_id=cast(str, defn.job_definition_id),
            version=cast(int, defn.version),
            display_name=cast(str | None, defn.display_name),
            display_description=cast(str | None, defn.display_description),
            tags=cast(list[str] | None, defn.tags),
            source=cast(str | None, defn.source),
            created_by=cast(str | None, defn.created_by),
        )
        for defn in definitions
    ]
    return JobDefinitionListResponse(definitions=items, total=len(items))


@router.post("/update")
async def update_job_definition(
    request: JobDefinitionUpdateRequest,
    auth_context: AuthContext = Depends(get_auth_context),
) -> JobDefinitionUpdateResponse:
    """Add a new version to an existing job definition.

    The id must reference an existing definition. Returns the new version number.
    """
    payload = FableSaveRequest(
        builder=request.builder,
        display_name=request.display_name,
        display_description=request.display_description,
        tags=request.tags,
        parent_id=request.parent_id,
    )
    try:
        result = await job_definition_service.save_builder(auth_context=auth_context, payload=payload, fable_id=request.job_definition_id)
    except JobDefinitionNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    except JobDefinitionAccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))
    return JobDefinitionUpdateResponse(job_definition_id=result.id, version=result.version)


@router.post("/delete")
async def delete_job_definition(
    request: JobDefinitionDeleteRequest,
    auth_context: AuthContext = Depends(get_auth_context),
) -> None:
    """Soft-delete all versions of a job definition."""
    try:
        await job_definition_db.soft_delete_job_definition(request.job_definition_id, auth_context=auth_context)
    except JobDefinitionNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    except JobDefinitionAccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))
