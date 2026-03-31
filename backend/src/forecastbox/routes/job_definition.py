# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Canonical job-definition entity routes — /job_definition/*"""

PREFIX = "/api/v1/job_definition"
from typing import Annotated, cast

from fastapi import APIRouter, Depends
from fastapi import status as http_status
from fastapi.exceptions import HTTPException
from fiab_core.fable import BlockFactoryCatalogue
from pydantic import BaseModel

import forecastbox.domain.job_definition.db as job_definition_db
import forecastbox.domain.job_definition.service as job_definition_service
from forecastbox.api.plugin.manager import PluginCompositeId, catalogue_view, plugins_ready
from forecastbox.api.types.fable import FableBuilder, FableSaveRequest, FableValidationExpansion
from forecastbox.domain.job_definition.exceptions import (
    JobDefinitionAccessDenied,
    JobDefinitionNotFound,
    JobDefinitionVersionConflict,
)
from forecastbox.entrypoint.auth.users import get_auth_context
from forecastbox.utility.auth import AuthContext
from forecastbox.utility.pagination import PaginationSpec

router = APIRouter(
    tags=["job_definition"],
    responses={404: {"description": "Not found"}},
)


# ---------------------------------------------------------------------------
# Route-local contracts
# ---------------------------------------------------------------------------


class JobDefinitionId(BaseModel):
    """Identifies a job definition, optionally pinning a specific version.

    Used as a Depends()-based query-param group on GET endpoints, and as a
    request body on PUT endpoints that target a specific definition.
    """

    job_definition_id: str
    version: int | None = None


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
    page: int
    page_size: int


class JobDefinitionUpdateRequest(BaseModel):
    job_definition_id: str
    version: int
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
    version: int


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
    spec: Annotated[JobDefinitionId, Depends()],
) -> JobDefinitionGetResponse:
    """Retrieve a saved job definition by id and optional version.

    Returns the latest non-deleted version when version is omitted.
    """
    try:
        retrieved = await job_definition_service.load_builder(spec.job_definition_id, spec.version)
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
    pagination: Annotated[PaginationSpec, Depends()],
    auth_context: AuthContext = Depends(get_auth_context),
) -> JobDefinitionListResponse:
    """List the latest non-deleted version of every job definition visible to the caller."""
    definitions = list(await job_definition_db.list_job_definitions(auth_context=auth_context))
    total = len(definitions)
    start = pagination.start()
    page_defs = definitions[start : start + pagination.page_size]
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
        for defn in page_defs
    ]
    return JobDefinitionListResponse(definitions=items, total=total, page=pagination.page, page_size=pagination.page_size)


@router.post("/update")
async def update_job_definition(
    request: JobDefinitionUpdateRequest,
    auth_context: AuthContext = Depends(get_auth_context),
) -> JobDefinitionUpdateResponse:
    """Add a new version to an existing job definition.

    ``version`` must match the current latest version; returns 409 if it does not.
    Returns the new version number on success.
    """
    payload = FableSaveRequest(
        builder=request.builder,
        display_name=request.display_name,
        display_description=request.display_description,
        tags=request.tags,
        parent_id=request.parent_id,
    )
    try:
        result = await job_definition_service.save_builder(
            auth_context=auth_context,
            payload=payload,
            fable_id=request.job_definition_id,
            expected_version=request.version,
        )
    except JobDefinitionVersionConflict as e:
        raise HTTPException(status_code=409, detail=str(e))
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
    """Soft-delete all versions of a job definition.

    ``version`` must match the current latest version; returns 409 if it does not.
    """
    try:
        await job_definition_db.soft_delete_job_definition(
            request.job_definition_id,
            expected_version=request.version,
            auth_context=auth_context,
        )
    except JobDefinitionVersionConflict as e:
        raise HTTPException(status_code=409, detail=str(e))
    except JobDefinitionNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    except JobDefinitionAccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))


# ---------------------------------------------------------------------------
# Building helpers
# ---------------------------------------------------------------------------


@router.get("/catalogue")
def get_catalogue() -> dict[PluginCompositeId, BlockFactoryCatalogue]:
    """All blocks this backend is capable of evaluating within a definition."""
    if not plugins_ready():
        raise HTTPException(status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE, detail="Plugins not ready")
    catalogue = catalogue_view()
    if isinstance(catalogue, bool):
        raise HTTPException(status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE, detail="Plugins not ready")
    return catalogue


@router.put("/expand")
def expand_job_definition(fable: FableBuilder) -> FableValidationExpansion:
    """Validate a partially-constructed FableBuilder and return completion options.

    Returns 200 regardless of whether validation errors are present; callers must
    inspect the returned error fields.
    """
    return job_definition_service.validate_expand(fable)
