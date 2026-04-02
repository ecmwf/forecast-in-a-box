# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Canonical status route — /status"""

PREFIX = "/api/v1/status"
import logging
from dataclasses import dataclass

import cascade.gateway.api as cascade_gateway_api
import cascade.gateway.client as cascade_gateway_client
from fastapi import APIRouter, Request

from forecastbox.domain.experiment.scheduling.background import status_scheduler
from forecastbox.domain.plugin.manager import status_brief as status_plugins
from forecastbox.utility.config import config

logger = logging.getLogger(__name__)

router = APIRouter(tags=["status"])


@dataclass(frozen=True, eq=True, slots=True)
class StatusResponse:
    api: str
    cascade: str
    ecmwf: str
    scheduler: str
    version: str
    plugins: str


@router.get("")
def get_status(request: Request) -> StatusResponse:
    """Overall system status endpoint."""
    import requests as http_requests

    status: dict[str, str] = {"api": "up", "cascade": "up", "ecmwf": "up", "scheduler": "up", "version": request.app.version}

    try:
        cascade_gateway_client.request_response(
            cascade_gateway_api.JobProgressRequest(job_ids=[]), config.cascade.cascade_url, timeout_ms=1000
        )
        status["cascade"] = "up"
    except Exception as e:
        logger.warning(f"Error connecting to Cascade: {repr(e)}")
        status["cascade"] = "down"

    try:
        status["scheduler"] = status_scheduler()
    except Exception as e:
        logger.warning(f"Error discerning scheduler status: {repr(e)}")
        status["scheduler"] = "down"

    try:
        status["plugins"] = status_plugins()
    except Exception as e:
        logger.warning(f"Error discerning plugins status: {repr(e)}")
        status["plugins"] = f"failure getting status"

    try:
        response = http_requests.get(f"{config.api.model_repository}/MANIFEST", timeout=5)
        if response.status_code == 200:
            status["ecmwf"] = "up"
        else:
            status["ecmwf"] = "down"
    except Exception:
        status["ecmwf"] = "down"

    return StatusResponse(**status)
