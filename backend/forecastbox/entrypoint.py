"""
FastAPI Entrypoint
"""

import time
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from dataclasses import dataclass

import logging

LOG = logging.getLogger(__name__)

### Create FastAPI instance with custom docs and openapi url
app = FastAPI(docs_url="/api/v1/docs", openapi_url="/api/v1/openapi.json", title="Forecast in a Box API", version="1.0.0")

from .api.routers import model
from .api.routers import product
from .api.routers import graph
from .api.routers import job
from .api.routers import setting

app.include_router(model.router, prefix="/api/v1/model")
app.include_router(product.router, prefix="/api/v1/product")
app.include_router(graph.router, prefix="/api/v1/graph")
app.include_router(job.router, prefix="/api/v1/job")
app.include_router(setting.router, prefix="/api/v1/setting")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["127.0.0.1"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# @app.middleware("http")
# async def restrict_to_localhost(request: Request, call_next):
#     client_ip = request.client.host
#     if client_ip != "127.0.0.1":
#         raise HTTPException(status_code=403, detail="Forbidden")
#     return await call_next(request)


@app.middleware("http")
async def add_process_time_header(request: Request, call_next):
    start_time = time.time()
    response = await call_next(request)
    LOG.info(f"Request took {time.time() - start_time:0.2f} sec")
    return response


@dataclass
class StatusResponse:
    """
    Status response model
    """

    api: str
    cascade: str
    ecmwf: str


@app.get("/api/v1/status", tags=["status"])
def status() -> StatusResponse:
    """
    Status endpoint
    """
    from forecastbox.settings import CASCADE_SETTINGS, API_SETTINGS

    status = {"api": "up", "cascade": "up", "ecmwf": "up"}

    from cascade.gateway import client, api

    try:
        client.request_response(api.JobProgressRequest(job_ids=[]), CASCADE_SETTINGS.cascade_url, timeout_ms=1000)
        status["cascade"] = "up"
    except Exception as e:
        LOG.warning(f"Error connecting to Cascade: {e}")
        status["cascade"] = "down"

    # Check connection to model_repository
    import requests

    try:
        response = requests.get(f"{API_SETTINGS.model_repository}/MANIFEST", timeout=1)
        if response.status_code == 200:
            status["ecmwf"] = "up"
        else:
            status["ecmwf"] = "down"
    except Exception:
        status["ecmwf"] = "down"

    return StatusResponse(**status)
