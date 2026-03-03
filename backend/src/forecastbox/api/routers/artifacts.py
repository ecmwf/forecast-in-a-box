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
def download_model_endpoint(composite_id: CompositeArtifactId) -> dict[str, str | int]:
    """Submit a download request for a specific ML model or get status of ongoing download."""
    result = submit_artifact_download(composite_id)
    if result.t is not None:
        if result.t == 100:
            return {"status": "available", "progress": 100, "composite_id": str(composite_id)}
        elif result.t == 0:
            return {"status": "download submitted", "progress": 0, "composite_id": str(composite_id)}
        else:
            return {"status": "download in progress", "progress": result.t, "composite_id": str(composite_id)}
    else:
        raise HTTPException(status_code=400, detail=result.e)


"""
TODO delete model
- add endpoint for deleting a model
- follow the structure -- use api/artifacts/manager for updating the state using a lock, use api/artifacts/io for implementing the actual io operation
- we dont expect the delete to take long, so this can be handled within the async task as blocking -- ie, no need to run in a thread
- no need to add tests for this
"""
