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

import forecastbox.api.fable as example
import forecastbox.db.fable as db_fable
from forecastbox.api.types import RawCascadeJob
from forecastbox.api.types.fable import BlockFactoryCatalogue, FableBuilderV1, FableValidationExpansion
from forecastbox.auth.users import current_active_user
from forecastbox.schemas.user import UserRead

router = APIRouter(
    tags=["build"],
    responses={404: {"description": "Not found"}},
)


# Endpoints
@router.get("/catalogue")
def get_catalogue() -> BlockFactoryCatalogue:
    """All blocks this backend is capable of evaluating within a fable"""
    return example.catalogue


@router.get("/expand")
def expand_fable(fable: FableBuilderV1) -> FableValidationExpansion:
    """Given a partially constructed fable, return whether there are any validation errors,
    and what are further completion/expansion options. Note that presence of validation
    errors does not affect return code, ie its still 200 OK"""
    return example.validate_expand(fable)


@router.get("/compile")
def compile_fable(fable: FableBuilderV1) -> RawCascadeJob:
    """Converts to a raw cascade job, which can then be used in a ExecutionSpecification
    in the /execution router's methods. Assumes the fable is valid, and throws a 4xx
    otherwise"""
    return example.compile(fable)


@router.get("/retrieve")
async def get_fable_builder(fable_builder_id: str) -> FableBuilderV1:
    """Retrieve a FableBuilderV1 by its ID."""
    fable_builder = await db_fable.get_fable_builder(fable_builder_id)
    if not fable_builder:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="FableBuilderV1 not found")
    return fable_builder


@router.post("/upsert")
async def upsert_fable_builder(
    builder: FableBuilderV1, fable_builder_id: Optional[str] = None, tags: list[str] = [], user: UserRead = Depends(current_active_user)
) -> str:
    """Create or update a FableBuilderV1."""
    try:
        return await db_fable.upsert_fable_builder(builder, fable_builder_id, tags, str(user.id))
    except KeyError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
