"""
FastAPI Entrypoint
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from dataclasses import dataclass

import logging

### Create FastAPI instance with custom docs and openapi url
app = FastAPI(docs_url="/docs", openapi_url="/openapi.json")

from .api.routers import models
from .api.routers import products
from .api.routers import graph
from .api.routers import jobs
from .api.routers import settings

app.include_router(models.router, prefix="/models")
app.include_router(products.router, prefix="/products")
app.include_router(graph.router, prefix="/graph")
app.include_router(jobs.router, prefix="/jobs")
app.include_router(settings.router, prefix="/settings")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

LOG = logging.getLogger(__name__)

@dataclass
class StatusResponse:
    """
    Status response model
    """
    api: str
    cascade: str
    ecmwf: str

@app.get("/status", tags=["status"])
def status() -> StatusResponse:
    """
    Status endpoint
    """
    from forecastbox.settings import APISettings
    settings = APISettings() # type: ignore

    status = {'api': 'up', 'cascade': 'up', 'ecmwf': 'up'}

    from cascade.gateway import client, api
    try:
        client.request_response(
            api.JobProgressRequest(job_ids=[]), settings.cascade_url, timeout_ms=1000
        )
        status['cascade'] = 'up'
    except Exception as e:
        LOG.warning(f"Error connecting to Cascade: {e}")
        status['cascade'] = 'down'
    
    # Check connection to model_repository
    import requests
    try:
        response = requests.get(f"{settings.model_repository}/MANIFEST", timeout=1)
        if response.status_code == 200:
            status['ecmwf'] = 'up'
        else:
            status['ecmwf'] = 'down'
    except Exception as e:
        status['ecmwf'] = 'down'

    return StatusResponse(**status)
