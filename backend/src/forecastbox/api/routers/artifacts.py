# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""User-facing API for artifacts management."""

from fastapi import APIRouter, HTTPException

from forecastbox.api.artifacts.base import CompositeArtifactId, MlModelDetail, MlModelOverview
from forecastbox.api.artifacts.manager import get_model_details, list_models, submit_artifact_download

router = APIRouter(
    tags=["artifacts"],
    responses={404: {"description": "Not found"}},
)


@router.get("/list_models")
def list_models_endpoint() -> list[MlModelOverview]:
    """List all available ML models with overview information."""
    try:
        return list_models()
    except TimeoutError:
        raise HTTPException(status_code=503, detail=f"Corresponding internal component is busy")


@router.post("/model_details")
def get_model_details_endpoint(composite_id: CompositeArtifactId) -> MlModelDetail:
    """Get detailed information for a specific ML model."""
    try:
        detail = get_model_details(composite_id)
    except TimeoutError:
        raise HTTPException(status_code=503, detail=f"Corresponding internal component is busy")
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Model {composite_id} not found")
    return detail


@router.post("/download_model")
def download_model_endpoint(composite_id: CompositeArtifactId) -> dict[str, str]:
    """Submit a download request for a specific ML model."""
    # TODO when there is a download in progress, this should return status instead of submit again
    maybe_error = submit_artifact_download(composite_id)
    if maybe_error.e is not None:
        raise HTTPException(status_code=400, detail=maybe_error.e)
    return {"status": "download submitted", "composite_id": str(composite_id)}
