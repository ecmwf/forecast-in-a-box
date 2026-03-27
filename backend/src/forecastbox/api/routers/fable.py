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
import forecastbox.db.jobs as db_jobs
from forecastbox.api.plugin.manager import PluginCompositeId, catalogue_view, plugins_ready
from forecastbox.api.types.fable import (
    FableBuilder,
    FableCompileRequest,
    FableRetrieveResponse,
    FableSaveRequest,
    FableSaveResponse,
    FableValidationExpansion,
)
from forecastbox.api.types.jobs import EnvironmentSpecification, ExecutionSpecification
from forecastbox.entrypoint.auth.users import current_active_user
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
def expand_fable(fable: FableBuilder) -> FableValidationExpansion:
    """Given a partially constructed fable, return whether there are any validation errors,
    and what are further completion/expansion options. Note that presence of validation
    errors does not affect return code, ie its still 200 OK"""
    return api_fable.validate_expand(fable)


@router.post("/upsert")
async def upsert_fable_builder(
    payload: FableSaveRequest,
    fable_id: Optional[str] = None,
    user: UserRead | None = Depends(current_active_user),
) -> FableSaveResponse:
    """Save a FableBuilder as a JobDefinition.

    If `fable_id` is omitted a new definition is created (version 1). If
    `fable_id` is supplied the existing definition gains a new version; a 404
    is returned if that id does not exist.

    `source` is derived from `display_name`: `user_defined` when a name is
    provided, `oneoff_execution` otherwise.
    """
    created_by = str(user.id) if user is not None else None
    source: str = "user_defined" if payload.display_name is not None else "oneoff_execution"
    env = payload.builder.environment
    try:
        definition_id, version = await db_jobs.upsert_job_definition(
            definition_id=fable_id,
            source=source,
            created_by=created_by,
            blocks=payload.builder.model_dump(mode="json")["blocks"],
            environment_spec=env.model_dump(mode="json") if env is not None else None,
            display_name=payload.display_name,
            display_description=payload.display_description,
            tags=payload.tags if payload.tags else None,
            parent_id=payload.parent_id,
        )
    except KeyError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    return FableSaveResponse(id=definition_id, version=version)


@router.get("/retrieve")
async def retrieve_fable_builder(
    fable_id: str,
    version: Optional[int] = None,
) -> FableRetrieveResponse:
    """Retrieve a saved FableBuilder by id (and optionally version) from the store.

    If `version` is omitted the latest non-deleted version is returned.
    """
    definition = await db_jobs.get_job_definition(fable_id, version)
    if definition is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fable definition not found")
    if definition.blocks is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fable definition has no builder spec")
    builder = FableBuilder(blocks=definition.blocks)  # ty:ignore[invalid-argument-type]
    if definition.environment_spec is not None:
        builder.environment = EnvironmentSpecification.model_validate(definition.environment_spec)
    return FableRetrieveResponse(
        id=definition.job_definition_id,  # ty:ignore[invalid-argument-type]
        version=definition.version,  # ty:ignore[invalid-argument-type]
        builder=builder,
        display_name=definition.display_name,  # ty:ignore[invalid-argument-type]
        display_description=definition.display_description,  # ty:ignore[invalid-argument-type]
        tags=definition.tags or [],  # ty:ignore[invalid-argument-type]
        parent_id=definition.parent_id,  # ty:ignore[invalid-argument-type]
    )


@router.put("/compile")
async def compile_fable(request: FableCompileRequest) -> ExecutionSpecification:
    """Load a saved builder from the store by reference and compile it to an ExecutionSpecification.

    If `version` is omitted the latest non-deleted version is used. The returned
    ExecutionSpecification has the same shape as the one from /compile.
    """
    definition = await db_jobs.get_job_definition(request.id, request.version)
    if definition is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fable definition not found")
    if definition.blocks is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fable definition has no builder spec")
    builder = FableBuilder(blocks=definition.blocks)  # ty:ignore[invalid-argument-type]
    if definition.environment_spec is not None:
        builder.environment = EnvironmentSpecification.model_validate(definition.environment_spec)
    try:
        return api_fable.compile(builder)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e))
