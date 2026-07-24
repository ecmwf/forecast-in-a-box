# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""FastAPI Entrypoint"""

import asyncio
import importlib
import logging
import os
import pkgutil
import time
from collections.abc import AsyncGenerator, Awaitable, Callable
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fiab_core.artifacts import ArtifactsProvider
from starlette.exceptions import HTTPException

import forecastbox.domain
import forecastbox.routes
import forecastbox.schemata
from forecastbox.domain.admin import get_local_release
from forecastbox.domain.artifact.base import get_artifact_local_path
from forecastbox.domain.artifact.manager import ArtifactManager, join_artifact_manager, submit_refresh_catalog
from forecastbox.domain.experiment.scheduling.background import start_scheduler, stop_scheduler
from forecastbox.domain.gateway.service import shutdown_processes
from forecastbox.domain.lens.manager import shutdown_all_lens_instances
from forecastbox.domain.plugin.manager import PluginManager, join_updater_thread, submit_load_plugins
from forecastbox.domain.plugin.store import join_stores_thread, submit_initialize_stores
from forecastbox.utility.concurrency.manager import execution_manager
from forecastbox.utility.config import ConcurrentThreads, config, validate_runtime
from forecastbox.utility.dispatcher import (
    DispatcherRegistration,
    event_dispatcher_entrypoint,
    freeze_registration,
    register_dispatcher,
)
from forecastbox.utility.dispatcher import (
    status as dispatcher_status,
)
from forecastbox.utility.dispatcher import (
    stop_request as dispatcher_stop_request,
)
from forecastbox.utility.tunnel import shutdown as shutdown_tunnels

logger = logging.getLogger(__name__)


def _discover_dispatchers() -> None:
    for package_info in pkgutil.iter_modules(forecastbox.domain.__path__):
        if not package_info.ispkg:
            continue
        module_name = f"forecastbox.domain.{package_info.name}.dispatchers"
        try:
            module = importlib.import_module(module_name)
        except ModuleNotFoundError as error:
            if error.name == module_name:
                continue
            raise
        registrations = getattr(module, "dispatchers", None)
        if not isinstance(registrations, tuple):
            raise TypeError(f"{module_name} must export a dispatchers tuple")
        for registration in registrations:
            if not isinstance(registration, DispatcherRegistration):
                raise TypeError(f"{module_name} contains a malformed dispatcher registration")
            register_dispatcher(registration)
    freeze_registration()


def _start_execution_runtime() -> None:
    _discover_dispatchers()
    for pool_name, settings in config.backend.concurrency.pools.items():
        execution_manager.register_pool(
            pool_name,
            max_workers=settings.max_workers,
            max_pending=settings.max_pending,
            stage=0,
        )
    execution_manager.register_thread(
        ConcurrentThreads.EventDispatcher,
        event_dispatcher_entrypoint,
        status_provider=dispatcher_status,
        stop_request=dispatcher_stop_request,
        stage=0,
    )
    execution_manager.start(timeout=config.backend.concurrency.startup_timeout_seconds)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    logger.debug(f"Starting FIAB with config: {config}")
    validate_runtime(config)
    try:
        for module_info in pkgutil.iter_modules(forecastbox.schemata.__path__):
            module = importlib.import_module(f"forecastbox.schemata.{module_info.name}")
            if hasattr(module, "create_db_and_tables"):
                await module.create_db_and_tables()  # type: ignore[call-non-callable] # NOTE no module protocol
        _start_execution_runtime()
    except BaseException:
        execution_manager.shutdown(timeout=config.backend.concurrency.shutdown_timeout_seconds)
        raise

    try:
        if config.backend.allow_scheduler:
            start_scheduler()
        release_time, release_version = get_local_release()
        app.version = f"{release_version}@{release_time}"
        submit_initialize_stores()
        ArtifactsProvider.register_get_artifacts_lookup(lambda: ArtifactManager.catalog)
        ArtifactsProvider.register_get_artifact_local_path(
            lambda composite_id: get_artifact_local_path(composite_id, config.backend.data_path)
        )
        catalog_ready = submit_refresh_catalog()
        PluginManager.loop = asyncio.get_running_loop()
        submit_load_plugins(start_after=catalog_ready)
        yield
    finally:
        try:
            if config.backend.allow_scheduler:
                stop_scheduler()
            shutdown_all_lens_instances()
            await shutdown_processes()
            shutdown_tunnels()
            join_updater_thread(timeout_sec=10)
            join_stores_thread(timeout_sec=10)
            join_artifact_manager(timeout_sec=10)
        finally:
            execution_manager.shutdown(timeout=config.backend.concurrency.shutdown_timeout_seconds)


app = FastAPI(
    docs_url="/api/v1/docs",
    openapi_url="/api/v1/openapi.json",
    title="Forecast in a Box API",
    version="1.0.0",
    lifespan=lifespan,
)

templates = Jinja2Templates(directory=Path(__file__).parent / "templates")


# Auto-discover and register all route modules under forecastbox.routes.
# Each module must expose a module-level `router` (APIRouter) and a `PREFIX` string.
for _module_info in pkgutil.iter_modules(forecastbox.routes.__path__):
    _module = importlib.import_module(f"forecastbox.routes.{_module_info.name}")
    if hasattr(_module, "router") and hasattr(_module, "PREFIX"):
        app.include_router(_module.router, prefix=_module.PREFIX)

app.add_middleware(
    CORSMiddleware,  # type: ignore[invalid-argument-type]
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
async def add_process_time_header(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    start_time = time.time()
    response = await call_next(request)
    logger.debug(f"Request took {time.time() - start_time:0.2f} sec")
    return response


@app.middleware("http")
async def circumvent_auth(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    # TODO this is a hotfix, we'd instead like to fix properly in api/routers/auth.py
    if request.url.path == "/api/v1/users/me" and config.auth.passthrough:
        return JSONResponse({"is_superuser": True})
    else:
        return await call_next(request)


@app.get("/api/v1/share/{job_id}/{dataset_id}", response_class=HTMLResponse, tags=["share"], summary="Share Image")
async def share_image(request: Request, job_id: str, dataset_id: str) -> HTMLResponse:
    """Endpoint to share an image from a job and dataset ID."""
    base_url = str(request.base_url).rstrip("/")
    image_url = f"{base_url}/api/v1/job/{job_id}/{dataset_id}"
    return templates.TemplateResponse(request, "share.html", {"image_url": image_url, "image_name": f"{job_id}_{dataset_id}"})


frontend = os.environ.get("FIAB_TEST_FRONTEND") or os.path.join(os.path.dirname(os.path.dirname(__file__)), "static")


class SPAStaticFiles(StaticFiles):
    """Custom StaticFiles class to handle SPA routing.

    - Asset-shaped paths (anything with a file extension or under /assets/)
      that 404 stay 404, so the browser surfaces a useful "chunk failed
    - SPA routes (no extension) fall through to index.html.
    - Cache-Control headers: hashed assets cached forever; index.html uses
      stale-while-revalidate so deploys propagate without blocking nav.
    """

    async def get_response(self, path: str, scope: Any) -> Response:
        try:
            response = await super().get_response(path, scope)
        except HTTPException as ex:
            if ex.status_code == 404:
                last_segment = path.rsplit("/", 1)[-1]
                if path.startswith("assets/") or "." in last_segment:
                    raise  # genuine asset miss -- let the 404 propagate
                response = FileResponse(os.path.join(frontend, "index.html"))
            else:
                raise

        if path.startswith("assets/"):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        elif path == "" or path.endswith(".html"):
            response.headers["Cache-Control"] = "public, max-age=0, stale-while-revalidate=60"
        return response


app.mount("/", SPAStaticFiles(directory=frontend, html=True, follow_symlink=True), name="static")
