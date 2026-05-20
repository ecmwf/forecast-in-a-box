# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""
Gateway operations routes — /gateway/*. Corresponds to operational functions in
`domain.gateway`, not a persisted user-managed entity.

All routes are purely operational, no ids -- gateway start, status, kill.
"""

from fastapi import APIRouter, HTTPException

from forecastbox.domain.gateway.exceptions import (
    GatewayAlreadyRunning,
    GatewayExited,
    GatewayNotRunning,
    GatewayNotStarted,
)
from forecastbox.domain.gateway.service import launch_gateway, status_gateway, stop_gateway
from forecastbox.utility.config import config

PREFIX = "/api/v1/gateway"

router = APIRouter(
    tags=["gateway"],
    responses={404: {"description": "Not found"}},
)


@router.post("/start")
async def start_gateway() -> str:
    if not config.cascade.spawn_gateway:
        raise HTTPException(400, "This instance does not manage the gateway")
    try:
        launch_gateway()
    except GatewayAlreadyRunning:
        raise HTTPException(400, "Process already running.")
    return "started"


@router.get("/status")
async def get_status() -> str:
    """Get the status of the Cascade Gateway process."""
    if not config.cascade.spawn_gateway:
        return "not managed"
    try:
        return status_gateway()
    except GatewayNotStarted:
        return "not started"
    except GatewayExited as e:
        return f"exited with {e.exitcode}"


@router.post("/kill")
async def kill_gateway() -> str:
    if not config.cascade.spawn_gateway:
        raise HTTPException(400, "This instance does not manage the gateway")
    try:
        stop_gateway()
    except GatewayNotRunning:
        raise HTTPException(400, "Gateway is not running")
    return "killed"
