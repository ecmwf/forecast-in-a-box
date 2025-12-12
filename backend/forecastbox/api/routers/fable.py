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

from fastapi import APIRouter, HTTPException, Query

import forecastbox.api.fable as example
from forecastbox.api.types import RawCascadeJob
from forecastbox.api.types.fable import BlockFactoryCatalogue, FableBuilder, FableValidationExpansion

router = APIRouter(
    tags=["build"],
    responses={404: {"description": "Not found"}},
)


# Endpoints
@router.get("/catalogue")
def get_catalogue(language: str = Query("en", title="language")) -> BlockFactoryCatalogue:
    """All blocks this backend is capable of evaluating within a fable"""
    if language == "en":
        return example.catalogue
    else:
        from forecastbox.api.localization import translate_block_factory_catalogue

        try:
            return translate_block_factory_catalogue(example.catalogue, language)
        except Exception as e:
            # TODO explicate list of supported languages instead
            if "not a valid model" in str(e):
                raise HTTPException(404, f"Language not supported: {language}")
            else:
                raise


@router.get("/expand")
def expand_fable(fable: FableBuilder) -> FableValidationExpansion:
    """Given a partially constructed fable, return whether there are any validation errors,
    and what are further completion/expansion options. Note that presence of validation
    errors does not affect return code, ie its still 200 OK"""
    return example.validate_expand(fable)


@router.get("/compile")
def compile_fable(fable: FableBuilder) -> RawCascadeJob:
    """Converts to a raw cascade job, which can then be used in a ExecutionSpecification
    in the /execution router's methods. Assumes the fable is valid, and throws a 4xx
    otherwise"""
    return example.compile(fable)
