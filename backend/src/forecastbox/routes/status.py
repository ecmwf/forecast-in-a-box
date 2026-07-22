# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Root status route — contains /status of the backend, not related to any domain entities"""

import logging
from collections.abc import Mapping
from dataclasses import dataclass, fields, is_dataclass
from enum import Enum
from typing import cast

import requests
from cascade.gateway import api, client
from fastapi import APIRouter, Request

from forecastbox.domain.experiment.scheduling.background import status_scheduler
from forecastbox.domain.gateway.service import get_gateway_url
from forecastbox.domain.plugin.manager import status_brief
from forecastbox.utility.concurrency.manager import execution_manager
from forecastbox.utility.config import config

PREFIX = "/api/v1/status"

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
    concurrency: Mapping[str, object]


def _serialize_snapshot(value: object) -> object:
    if isinstance(value, Enum):
        return value.value
    if is_dataclass(value):
        return {field.name: _serialize_snapshot(getattr(value, field.name)) for field in fields(value)}
    if isinstance(value, Mapping):
        return {str(key.value if isinstance(key, Enum) else key): _serialize_snapshot(item) for key, item in value.items()}
    if isinstance(value, tuple):
        return [_serialize_snapshot(item) for item in value]
    return value


@router.get("")
def get_status(request: Request) -> StatusResponse:
    """Overall system status endpoint."""

    status: dict[str, str] = {"api": "up", "cascade": "up", "ecmwf": "up", "scheduler": "up", "version": request.app.version}

    try:
        client.request_response(api.JobProgressRequest(job_ids=[]), get_gateway_url(), timeout_ms=1000)
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
        status["plugins"] = status_brief()
    except Exception as e:
        logger.warning(f"Error discerning plugins status: {repr(e)}")
        status["plugins"] = f"failure getting status"

    try:
        response = requests.get(f"{config.external.model_repository}/MANIFEST", timeout=5)
        if response.status_code == 200:
            status["ecmwf"] = "up"
        else:
            status["ecmwf"] = "down"
    except Exception:
        status["ecmwf"] = "down"

    concurrency = cast(Mapping[str, object], _serialize_snapshot(execution_manager.status()))
    return StatusResponse(**status, concurrency=concurrency)
