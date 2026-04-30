# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""
Lens routes — /lens/*. Corresponds to the `domain.lens` domain.

Lenses are external inspection tools (e.g. skinnyWMS) that clients can launch
against Run outputs. Routes cover: start, status, stop, list, and supported lenses.
"""

# TODO currently no authentication here. Add auth and propagate into the manager itself
# TODO currently no log propagation -- consider routing stdout of skinnywms to files, and allow retrieval here via a new route

import logging
import pathlib
from typing import Any, Self

from fastapi import APIRouter, HTTPException

from forecastbox.domain.lens.manager import (
    LensInstanceDetail,
    LensInstanceId,
    LensStatus,
    get_status,
    list_instances,
    start_skinny_wms,
    stop_instance,
)
from forecastbox.utility.concurrent import NoFreePortsException
from forecastbox.utility.pydantic import FiabBaseModel

PREFIX = "/api/v1/lens"

logger = logging.getLogger(__name__)

router = APIRouter(
    tags=["lens"],
    responses={404: {"description": "Not found"}},
)


class LensInstanceDetailResponse(FiabBaseModel):
    """API response model for a lens instance detail. Mirrors LensInstanceDetail fields
    to decouple the public contract from internal domain refactoring."""

    lens_instance_id: LensInstanceId
    status: LensStatus
    lens_name: str
    lens_params: dict[str, Any]
    ports: list[int]

    @classmethod
    def from_detail(cls, lens_instance_id: LensInstanceId, detail: LensInstanceDetail) -> Self:
        return cls(
            lens_instance_id=lens_instance_id,
            status=detail.status,
            lens_name=detail.lens_name,
            lens_params=detail.lens_params,
            ports=list(detail.ports),
        )


class SupportedLensDetail(FiabBaseModel):
    name: str
    route: str
    params: dict[str, str]


@router.post("/start/skinnyWMS")
def start_skinny_wms_endpoint(local_path: str) -> LensInstanceId:
    """Start a skinnyWMS lens instance serving data from the given local path."""
    try:
        if not pathlib.Path(local_path).exists():
            raise HTTPException(status_code=400, detail="Provided path does not exist")
        return start_skinny_wms(local_path)
    except NoFreePortsException:
        raise HTTPException(status_code=503, detail="No free ports available for a new lens instance")
    except TimeoutError:
        raise HTTPException(status_code=503, detail="Lens manager is busy")


@router.get("/status")
def get_lens_status(lens_instance_id: LensInstanceId) -> LensInstanceDetailResponse:
    """Get the status of a lens instance."""
    try:
        return LensInstanceDetailResponse.from_detail(lens_instance_id, get_status(lens_instance_id))
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Lens instance {lens_instance_id!r} not found")


@router.delete("/stop")
def stop_lens(lens_instance_id: LensInstanceId) -> str:
    """Stop and remove a lens instance."""
    try:
        stop_instance(lens_instance_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Lens instance {lens_instance_id!r} not found")
    except TimeoutError:
        raise HTTPException(status_code=503, detail="Lens manager is busy")
    return "ok"


@router.get("/list")
def list_lenses() -> list[LensInstanceDetailResponse]:
    """List all active lens instances with their current status."""
    return [LensInstanceDetailResponse.from_detail(iid, detail) for iid, detail in list_instances()]


@router.get("/supported")
def list_supported_lenses() -> list[SupportedLensDetail]:
    """List all supported lens types with their start route and parameters."""
    return [
        SupportedLensDetail(
            name="skinnyWMS",
            route=f"{PREFIX}/start/skinnyWMS",
            params={"local_path": "Absolute path to the data directory or file to serve"},
        )
    ]
