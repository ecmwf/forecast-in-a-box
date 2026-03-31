# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Canonical definition entity routes — /definition/*"""

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


class DefinitionCreateRequest(BaseModel):
    builder: FableBuilder
    display_name: str | None = None
    display_description: str | None = None
    tags: list[str] = []
    parent_id: str | None = None


class DefinitionCreateResponse(BaseModel):
    id: str
    version: int


class DefinitionGetResponse(BaseModel):
    id: str
    version: int
    builder: FableBuilder
    display_name: str | None = None
    display_description: str | None = None
    tags: list[str] = []
    parent_id: str | None = None


class DefinitionListItem(BaseModel):
    id: str
    version: int
    display_name: str | None = None
    display_description: str | None = None
    tags: list[str] | None = None
    source: str | None = None
    created_by: str | None = None


class DefinitionListResponse(BaseModel):
    definitions: list[DefinitionListItem]
    total: int


class DefinitionUpdateRequest(BaseModel):
    id: str
    builder: FableBuilder
    display_name: str | None = None
    display_description: str | None = None
    tags: list[str] = []
    parent_id: str | None = None


class DefinitionUpdateResponse(BaseModel):
    id: str
    version: int


class DefinitionDeleteRequest(BaseModel):
    id: str


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/create")
async def create_definition(
    request: DefinitionCreateRequest,
    auth_context: AuthContext = Depends(get_auth_context),
) -> DefinitionCreateResponse:
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
    return DefinitionCreateResponse(id=result.id, version=result.version)


@router.get("/get")
async def get_definition(
    id: str,
    version: int | None = None,
) -> DefinitionGetResponse:
    """Retrieve a saved job definition by id and optional version.

    Returns the latest non-deleted version when version is omitted.
    """
    try:
        retrieved = await job_definition_service.load_builder(id, version)
    except JobDefinitionNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    return DefinitionGetResponse(
        id=retrieved.id,
        version=retrieved.version,
        builder=retrieved.builder,
        display_name=retrieved.display_name,
        display_description=retrieved.display_description,
        tags=retrieved.tags,
        parent_id=retrieved.parent_id,
    )


@router.get("/list")
async def list_definitions(
    auth_context: AuthContext = Depends(get_auth_context),
) -> DefinitionListResponse:
    """List the latest non-deleted version of every job definition visible to the caller."""
    definitions = list(await job_definition_db.list_job_definitions(auth_context=auth_context))
    items = [
        DefinitionListItem(
            id=cast(str, defn.job_definition_id),
            version=cast(int, defn.version),
            display_name=cast(str | None, defn.display_name),
            display_description=cast(str | None, defn.display_description),
            tags=cast(list[str] | None, defn.tags),
            source=cast(str | None, defn.source),
            created_by=cast(str | None, defn.created_by),
        )
        for defn in definitions
    ]
    return DefinitionListResponse(definitions=items, total=len(items))


@router.post("/update")
async def update_definition(
    request: DefinitionUpdateRequest,
    auth_context: AuthContext = Depends(get_auth_context),
) -> DefinitionUpdateResponse:
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
        result = await job_definition_service.save_builder(auth_context=auth_context, payload=payload, fable_id=request.id)
    except JobDefinitionNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    except JobDefinitionAccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))
    return DefinitionUpdateResponse(id=result.id, version=result.version)


@router.post("/delete")
async def delete_definition(
    request: DefinitionDeleteRequest,
    auth_context: AuthContext = Depends(get_auth_context),
) -> None:
    """Soft-delete all versions of a job definition."""
    try:
        await job_definition_db.soft_delete_job_definition(request.id, auth_context=auth_context)
    except JobDefinitionNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    except JobDefinitionAccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))
