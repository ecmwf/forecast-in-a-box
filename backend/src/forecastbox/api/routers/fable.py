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

import forecastbox.domain.job_definition.db as _job_definition_db
import forecastbox.domain.job_definition.service as job_definition_service
from forecastbox.api.plugin.manager import PluginCompositeId, catalogue_view, plugins_ready
from forecastbox.api.types.fable import (
    FableBuilder,
    FableCompileRequest,
    FableRetrieveResponse,
    FableSaveRequest,
    FableSaveResponse,
    FableValidationExpansion,
)
from forecastbox.api.types.jobs import ExecutionSpecification
from forecastbox.domain.job_definition.exceptions import JobDefinitionAccessDenied, JobDefinitionNotFound
from forecastbox.domain.job_definition.service import compile_builder
from forecastbox.entrypoint.auth.users import get_auth_context
from forecastbox.utility.auth import AuthContext

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
    return job_definition_service.validate_expand(fable)


@router.post("/upsert")
async def upsert_fable_builder(
    payload: FableSaveRequest,
    fable_id: Optional[str] = None,
    auth_context: AuthContext = Depends(get_auth_context),
) -> FableSaveResponse:
    """Save a FableBuilder as a JobDefinition.

    If `fable_id` is omitted a new job definition is created (version 1). If
    `fable_id` is supplied the existing job definition gains a new version; a 404
    is returned if that id does not exist.

    `source` is derived from `display_name`: `user_defined` when a name is
    provided, `oneoff_execution` otherwise.
    """
    try:
        return await job_definition_service.save_builder(auth_context=auth_context, payload=payload, fable_id=fable_id)
    except JobDefinitionNotFound as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except JobDefinitionAccessDenied as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))


@router.get("/retrieve")
async def retrieve_fable_builder(
    fable_id: str,
    version: Optional[int] = None,
) -> FableRetrieveResponse:
    """Retrieve a saved FableBuilder by id (and optionally version) from the store.

    If `version` is omitted the latest non-deleted version is returned.
    """
    try:
        return await job_definition_service.load_builder(fable_id, version)
    except JobDefinitionNotFound as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.put("/compile")
async def compile_fable(request: FableCompileRequest) -> ExecutionSpecification:
    """Load a saved builder from the store by reference and compile it to an ExecutionSpecification.

    If `version` is omitted the latest non-deleted version is used. The returned
    ExecutionSpecification has the same shape as the one from /compile.
    """
    try:
        job_def = await _job_definition_db.get_job_definition(request.id, request.version)
        if job_def is None:
            raise JobDefinitionNotFound(f"Fable job definition {request.id!r} not found.")
        if job_def.blocks is None:
            raise JobDefinitionNotFound(f"Fable job definition {request.id!r} has no builder spec.")
        builder = FableBuilder(blocks=job_def.blocks)  # ty:ignore[invalid-argument-type]
        if job_def.environment_spec is not None:
            from forecastbox.api.types.fable import EnvironmentSpecification

            builder.environment = EnvironmentSpecification.model_validate(job_def.environment_spec)
        return compile_builder(builder)
    except JobDefinitionNotFound as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e))
