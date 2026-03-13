# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Building fables (Forecast As BLock Expressions) -- provide components for high
level fable building and configuring, validate/extend partial fables, compile fables
into jobs."""

from typing import Optional

from fastapi import APIRouter, Depends, status
from fastapi.exceptions import HTTPException
from fiab_core.fable import BlockFactoryCatalogue

import forecastbox.api.fable as api_fable
import forecastbox.db.fable as db_fable
from forecastbox.api.plugin.manager import PluginCompositeId, catalogue_view, plugins_ready
import forecastbox.db.jobs2 as db_jobs2
from forecastbox.api.types.fable import (
    FableBuilderV1,
    FableRetrieveV2Response,
    FableSaveV2Request,
    FableSaveV2Response,
    FableValidationExpansion,
)
from forecastbox.api.types.jobs import EnvironmentSpecification, ExecutionSpecification
from forecastbox.auth.users import current_active_user
from forecastbox.schemas.user import UserRead

router = APIRouter(
    tags=["fable"],
    responses={404: {"description": "Not found"}},
)


# Endpoints
@router.get("/catalogue")
def get_catalogue() -> dict[PluginCompositeId, BlockFactoryCatalogue]:
    """All blocks this backend is capable of evaluating within a fable"""
    if not plugins_ready():
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Plugins not ready")
    else:
        catalogue = catalogue_view()
        if isinstance(catalogue, bool):
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Plugins not ready")
        else:
            return catalogue


# NOTE its a put but get would be better -- but browsers dont support get+json body
@router.put("/expand")
def expand_fable(fable: FableBuilderV1) -> FableValidationExpansion:
    """Given a partially constructed fable, return whether there are any validation errors,
    and what are further completion/expansion options. Note that presence of validation
    errors does not affect return code, ie its still 200 OK"""
    return api_fable.validate_expand(fable)


# NOTE its a put but get would be better -- but browsers dont support get+json body
@router.put("/compile")
def compile_fable(fable: FableBuilderV1) -> ExecutionSpecification:
    """Converts to an ExecutionSpecification which can then be used in the /job router's methods.
    Assumes the fable is valid, and throws a 4xx otherwise"""
    return api_fable.compile(fable)


@router.get("/retrieve")
async def get_fable_builder(fable_builder_id: str) -> FableBuilderV1:
    """Retrieve a FableBuilderV1 by its ID."""
    fable_builder = await db_fable.get_fable_builder(fable_builder_id)
    if not fable_builder:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="FableBuilderV1 not found")
    return fable_builder


@router.post("/upsert")
async def upsert_fable_builder(
    builder: FableBuilderV1,
    fable_builder_id: Optional[str] = None,
    tags: list[str] = [],
    user: UserRead | None = Depends(current_active_user),
) -> str:
    """Create or update a FableBuilderV1."""
    try:
        return await db_fable.upsert_fable_builder(builder, fable_builder_id, tags, str(user.id) if user is not None else None)
    except KeyError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))


@router.post("/upsert_v2")
async def upsert_fable_builder_v2(
    payload: FableSaveV2Request,
    fable_id: Optional[str] = None,
    user: UserRead | None = Depends(current_active_user),
) -> FableSaveV2Response:
    """Save a FableBuilderV1 as a JobDefinition (v2 persistence path).

    If `fable_id` is omitted a new definition is created (version 1). If
    `fable_id` is supplied the existing definition gains a new version; a 404
    is returned if that id does not exist.
    """
    created_by = str(user.id) if user is not None else None
    try:
        definition_id, version = await db_jobs2.upsert_job_definition(
            id=fable_id,
            source="user_defined",
            created_by=created_by,
            builder_spec=payload.builder.model_dump(mode="json"),
            environment_spec=payload.environment.model_dump(mode="json") if payload.environment is not None else None,
            display_name=payload.display_name,
            display_description=payload.display_description,
            tags=payload.tags if payload.tags else None,
            parent_id=payload.parent_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    return FableSaveV2Response(id=definition_id, version=version)


@router.get("/retrieve_v2")
async def retrieve_fable_builder_v2(
    fable_id: str,
    version: Optional[int] = None,
) -> FableRetrieveV2Response:
    """Retrieve a saved FableBuilderV1 by id (and optionally version) from the v2 store.

    If `version` is omitted the latest non-deleted version is returned.
    """
    definition = await db_jobs2.get_job_definition(fable_id, version)
    if definition is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fable definition not found")
    if definition.builder_spec is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fable definition has no builder spec")
    return FableRetrieveV2Response(
        id=definition.id,  # ty:ignore[invalid-argument-type]
        version=definition.version,  # ty:ignore[invalid-argument-type]
        builder=FableBuilderV1.model_validate(definition.builder_spec),
        environment=EnvironmentSpecification.model_validate(definition.environment_spec) if definition.environment_spec is not None else None,
        display_name=definition.display_name,  # ty:ignore[invalid-argument-type]
        display_description=definition.display_description,  # ty:ignore[invalid-argument-type]
        tags=definition.tags or [],  # ty:ignore[invalid-argument-type]
        parent_id=definition.parent_id,  # ty:ignore[invalid-argument-type]
    )
