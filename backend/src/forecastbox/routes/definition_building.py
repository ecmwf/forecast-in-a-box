# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Canonical definition-building routes — /definition/building/*"""

from fastapi import APIRouter, status
from fastapi.exceptions import HTTPException
from fiab_core.fable import BlockFactoryCatalogue
from pydantic import BaseModel

import forecastbox.domain.job_definition.service as job_definition_service
from forecastbox.api.plugin.manager import PluginCompositeId, catalogue_view, plugins_ready
from forecastbox.api.types.fable import FableBuilder, FableValidationExpansion
from forecastbox.api.types.jobs import ExecutionSpecification
from forecastbox.domain.job_definition.exceptions import JobDefinitionNotFound

router = APIRouter(
    tags=["definition-building"],
    responses={404: {"description": "Not found"}},
)


# ---------------------------------------------------------------------------
# Route-local contracts
# ---------------------------------------------------------------------------


class BuildingCompileRequest(BaseModel):
    id: str
    version: int | None = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/catalogue")
def get_catalogue() -> dict[PluginCompositeId, BlockFactoryCatalogue]:
    """All blocks this backend is capable of evaluating within a definition."""
    if not plugins_ready():
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Plugins not ready")
    catalogue = catalogue_view()
    if isinstance(catalogue, bool):
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Plugins not ready")
    return catalogue


@router.put("/expand")
def expand_definition(fable: FableBuilder) -> FableValidationExpansion:
    """Validate a partially-constructed FableBuilder and return completion options.

    Returns 200 regardless of whether validation errors are present; callers must
    inspect the returned error fields.
    """
    return job_definition_service.validate_expand(fable)


@router.put("/compile")
async def compile_definition(request: BuildingCompileRequest) -> ExecutionSpecification:
    """Load a saved definition by id and compile it to an ExecutionSpecification.

    Uses the latest non-deleted version when version is omitted.
    """
    try:
        return await job_definition_service.compile_definition(request.id, request.version)
    except JobDefinitionNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
