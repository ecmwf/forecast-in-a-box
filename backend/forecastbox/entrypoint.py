"""
FastAPI Entrypoint
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from dataclasses import dataclass

import logging

### Create FastAPI instance with custom docs and openapi url
app = FastAPI(docs_url="/docs", openapi_url="/openapi.json")

from .api.routers import model
from .api.routers import product
from .api.routers import graph
from .api.routers import job
from .api.routers import setting

app.include_router(model.router, prefix="/v1/model")
app.include_router(product.router, prefix="/v1/product")
app.include_router(graph.router, prefix="/v1/graph")
app.include_router(job.router, prefix="/v1/job")
app.include_router(setting.router, prefix="/v1/setting")

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
    from forecastbox.settings import CASCADE_SETTINGS, API_SETTINGS

    status = {'api': 'up', 'cascade': 'up', 'ecmwf': 'up'}

    from cascade.gateway import client, api
    try:
        client.request_response(
            api.JobProgressRequest(job_ids=[]), CASCADE_SETTINGS.cascade_url, timeout_ms=1000
        )
        status['cascade'] = 'up'
    except Exception as e:
        LOG.warning(f"Error connecting to Cascade: {e}")
        status['cascade'] = 'down'
    
    # Check connection to model_repository
    import requests
    try:
        response = requests.get(f"{API_SETTINGS.model_repository}/MANIFEST", timeout=1)
        if response.status_code == 200:
            status['ecmwf'] = 'up'
        else:
            status['ecmwf'] = 'down'
    except Exception as e:
        status['ecmwf'] = 'down'

    return StatusResponse(**status)
