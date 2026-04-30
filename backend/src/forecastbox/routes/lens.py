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

import logging

from fastapi import APIRouter, HTTPException

from forecastbox.domain.lens.manager import (
    LensInstanceId,
    LensStatus,
    get_status,
    list_instances,
    start_skinny_wms,
    stop_instance,
)
from forecastbox.utility.pydantic import FiabBaseModel

PREFIX = "/api/v1/lens"

logger = logging.getLogger(__name__)

router = APIRouter(
    tags=["lens"],
    responses={404: {"description": "Not found"}},
)


class LensDetail(FiabBaseModel):
    name: str
    route: str
    params: dict[str, str]


@router.post("/start/skinnyWMS")
def start_skinny_wms_endpoint(local_path: str) -> LensInstanceId:
    """Start a skinnyWMS lens instance serving data from the given local path."""
    try:
        return start_skinny_wms(local_path)
    except KeyError:
        raise HTTPException(status_code=503, detail="No free ports available for a new lens instance")
    except TimeoutError:
        raise HTTPException(status_code=503, detail="Lens manager is busy")


@router.get("/status")
def get_lens_status(lens_instance_id: LensInstanceId) -> LensStatus:
    """Get the status of a lens instance."""
    try:
        return get_status(lens_instance_id)
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
def list_lenses() -> list[tuple[LensInstanceId, LensStatus]]:
    """List all active lens instances with their current status."""
    return list_instances()


@router.get("/supported")
def list_supported_lenses() -> list[LensDetail]:
    """List all supported lens types with their start route and parameters."""
    return [
        LensDetail(
            name="skinnyWMS",
            route=f"{PREFIX}/start/skinnyWMS",
            params={"local_path": "Absolute path to the data directory or file to serve"},
        )
    ]
