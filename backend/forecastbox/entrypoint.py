"""
FastAPI Entrypoint
"""

from fastapi import FastAPI
from dataclasses import dataclass

import logging

### Create FastAPI instance with custom docs and openapi url
app = FastAPI(docs_url="/api/py/docs", openapi_url="/api/py/openapi.json")

from .api.routers import models
from .api.routers import products
from .api.routers import graph
from .api.routers import jobs

app.include_router(models.router, prefix="/api/py/models")
app.include_router(products.router, prefix="/api/py/products")
app.include_router(graph.router, prefix="/api/py/graph")
app.include_router(jobs.router, prefix="/api/py/jobs")

LOG = logging.getLogger(__name__)

@dataclass
class StatusResponse:
    """
    Status response model
    """
    api: str
    cascade: str
    ecmwf: str

@app.get("/api/py/status", tags=["status"])
def status() -> StatusResponse:
    """
    Status endpoint
    """
    from forecastbox.settings import APISettings

    status = {'api': 'up', 'cascade': 'up', 'ecmwf': 'up'}

    from cascade.gateway import client, api
    try:
        client.request_response(
            api.JobProgressRequest(job_ids=[]), APISettings().cascade_url, timeout_ms=1000
        )
        status['cascade'] = 'up'
    except Exception as e:
        LOG.warning(f"Error connecting to Cascade: {e}")
        status['cascade'] = 'down'
    
    # Check connection to model_repository
    import requests
    try:
        response = requests.get(f"{APISettings().model_repository}/MANIFEST", timeout=1)
        if response.status_code == 200:
            status['ecmwf'] = 'up'
        else:
            status['ecmwf'] = 'down'
    except Exception as e:
        status['ecmwf'] = 'down'

    return status
