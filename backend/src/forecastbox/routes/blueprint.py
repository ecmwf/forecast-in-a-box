# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Canonical blueprint entity routes — /blueprint/*"""

PREFIX = "/api/v1/blueprint"
from typing import Annotated, cast

from fastapi import APIRouter, Depends
from fastapi import status as http_status
from fastapi.exceptions import HTTPException
from fiab_core.fable import BlockFactoryCatalogue, BlockInstanceId, PluginBlockFactoryId, PluginCompositeId
from pydantic import BaseModel

import forecastbox.domain.blueprint.db as blueprint_db
import forecastbox.domain.blueprint.service as blueprint_service
from forecastbox.api.plugin.manager import catalogue_view, plugins_ready
from forecastbox.domain.blueprint.exceptions import (
    BlueprintAccessDenied,
    BlueprintNotFound,
    BlueprintVersionConflict,
)
from forecastbox.domain.blueprint.service import BlueprintBuilder, BlueprintSaveCommand, BlueprintValidationExpansion
from forecastbox.entrypoint.auth.users import get_auth_context
from forecastbox.utility.auth import AuthContext
from forecastbox.utility.pagination import PaginationSpec

router = APIRouter(
    tags=["blueprint"],
    responses={404: {"description": "Not found"}},
)


# ---------------------------------------------------------------------------
# Route-local contracts
# ---------------------------------------------------------------------------


class BlueprintId(BaseModel):
    """Identifies a blueprint, optionally pinning a specific version.

    Used as a Depends()-based query-param group on GET endpoints, and as a
    request body on PUT endpoints that target a specific blueprint.
    """

    blueprint_id: str
    version: int | None = None


class BlueprintCreateRequest(BaseModel):
    builder: BlueprintBuilder
    display_name: str | None = None
    display_description: str | None = None
    tags: list[str] = []
    parent_id: str | None = None


class BlueprintCreateResponse(BaseModel):
    blueprint_id: str
    version: int


class BlueprintGetResponse(BaseModel):
    blueprint_id: str
    version: int
    builder: BlueprintBuilder
    display_name: str | None = None
    display_description: str | None = None
    tags: list[str] = []
    parent_id: str | None = None


class BlueprintListItem(BaseModel):
    blueprint_id: str
    version: int
    display_name: str | None = None
    display_description: str | None = None
    tags: list[str] | None = None
    source: str | None = None
    created_by: str | None = None


class BlueprintListResponse(BaseModel):
    blueprints: list[BlueprintListItem]
    total: int
    page: int
    page_size: int


class BlueprintUpdateRequest(BaseModel):
    blueprint_id: str
    version: int
    builder: BlueprintBuilder
    display_name: str | None = None
    display_description: str | None = None
    tags: list[str] = []
    parent_id: str | None = None


class BlueprintUpdateResponse(BaseModel):
    blueprint_id: str
    version: int


class BlueprintDeleteRequest(BaseModel):
    blueprint_id: str
    version: int


class BlueprintValidationExpansionResponse(BaseModel):
    """HTTP response for blueprint expand — mirrors BlueprintValidationExpansion from the service layer."""

    global_errors: list[str]
    block_errors: dict[BlockInstanceId, list[str]]
    possible_sources: list[PluginBlockFactoryId]
    possible_expansions: dict[BlockInstanceId, list[PluginBlockFactoryId]]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/create")
async def create_blueprint(
    request: BlueprintCreateRequest,
    auth_context: AuthContext = Depends(get_auth_context),
) -> BlueprintCreateResponse:
    """Create a new blueprint from a BlueprintBuilder."""
    payload = BlueprintSaveCommand(
        builder=request.builder,
        display_name=request.display_name,
        display_description=request.display_description,
        tags=request.tags,
        parent_id=request.parent_id,
    )
    try:
        result = await blueprint_service.save_builder(auth_context=auth_context, payload=payload, blueprint_id=None)
    except BlueprintNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    except BlueprintAccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))
    return BlueprintCreateResponse(blueprint_id=result.blueprint_id, version=result.blueprint_version)


@router.get("/get")
async def get_blueprint(
    spec: Annotated[BlueprintId, Depends()],
) -> BlueprintGetResponse:
    """Retrieve a saved blueprint by id and optional version.

    Returns the latest non-deleted version when version is omitted.
    """
    try:
        retrieved = await blueprint_service.load_builder(spec.blueprint_id, spec.version)
    except BlueprintNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    return BlueprintGetResponse(
        blueprint_id=retrieved.blueprint_id,
        version=retrieved.blueprint_version,
        builder=retrieved.builder,
        display_name=retrieved.display_name,
        display_description=retrieved.display_description,
        tags=retrieved.tags,
        parent_id=retrieved.parent_id,
    )


@router.get("/list")
async def list_blueprints(
    pagination: Annotated[PaginationSpec, Depends()],
    auth_context: AuthContext = Depends(get_auth_context),
) -> BlueprintListResponse:
    """List the latest non-deleted version of every blueprint visible to the caller."""
    total = await blueprint_db.count_blueprints(auth_context=auth_context)
    start = pagination.start()
    page_defs = list(await blueprint_db.list_blueprints(auth_context=auth_context, offset=start, limit=pagination.page_size))
    items = [
        BlueprintListItem(
            blueprint_id=cast(str, defn.blueprint_id),
            version=cast(int, defn.version),
            display_name=cast(str | None, defn.display_name),
            display_description=cast(str | None, defn.display_description),
            tags=cast(list[str] | None, defn.tags),
            source=cast(str | None, defn.source),
            created_by=cast(str | None, defn.created_by),
        )
        for defn in page_defs
    ]
    return BlueprintListResponse(blueprints=items, total=total, page=pagination.page, page_size=pagination.page_size)


@router.post("/update")
async def update_blueprint(
    request: BlueprintUpdateRequest,
    auth_context: AuthContext = Depends(get_auth_context),
) -> BlueprintUpdateResponse:
    """Add a new version to an existing blueprint.

    ``version`` must match the current latest version; returns 409 if it does not.
    Returns the new version number on success.
    """
    payload = BlueprintSaveCommand(
        builder=request.builder,
        display_name=request.display_name,
        display_description=request.display_description,
        tags=request.tags,
        parent_id=request.parent_id,
    )
    try:
        result = await blueprint_service.save_builder(
            auth_context=auth_context,
            payload=payload,
            blueprint_id=request.blueprint_id,
            expected_version=request.version,
        )
    except BlueprintVersionConflict as e:
        raise HTTPException(status_code=409, detail=str(e))
    except BlueprintNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    except BlueprintAccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))
    return BlueprintUpdateResponse(blueprint_id=result.blueprint_id, version=result.blueprint_version)


@router.post("/delete")
async def delete_blueprint(
    request: BlueprintDeleteRequest,
    auth_context: AuthContext = Depends(get_auth_context),
) -> None:
    """Soft-delete all versions of a blueprint.

    ``version`` must match the current latest version; returns 409 if it does not.
    """
    try:
        await blueprint_db.soft_delete_blueprint(
            request.blueprint_id,
            expected_version=request.version,
            auth_context=auth_context,
        )
    except BlueprintVersionConflict as e:
        raise HTTPException(status_code=409, detail=str(e))
    except BlueprintNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    except BlueprintAccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))


# ---------------------------------------------------------------------------
# Building helpers
# ---------------------------------------------------------------------------


@router.get("/catalogue")
def get_catalogue() -> dict[PluginCompositeId, BlockFactoryCatalogue]:
    """All blocks this backend is capable of evaluating within a blueprint."""
    if not plugins_ready():
        raise HTTPException(status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE, detail="Plugins not ready")
    catalogue = catalogue_view()
    if isinstance(catalogue, bool):
        raise HTTPException(status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE, detail="Plugins not ready")
    return catalogue


@router.put("/expand")
def expand_blueprint(blueprint: BlueprintBuilder) -> BlueprintValidationExpansionResponse:
    """Validate a partially-constructed BlueprintBuilder and return completion options.

    Returns 200 regardless of whether validation errors are present; callers must
    inspect the returned error fields.
    """
    result = blueprint_service.validate_expand(blueprint)
    return BlueprintValidationExpansionResponse(
        global_errors=result.global_errors,
        block_errors=result.block_errors,
        possible_sources=result.possible_sources,
        possible_expansions=result.possible_expansions,
    )
