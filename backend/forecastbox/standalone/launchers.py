# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Launcher methods for backend and cascade -- utilized by
- standalone.entrypoint for launch_backend,
- standalone.service for launch_backend,
- api.routers.gateway for spawning cascade itself (regardless how backend was launched).
"""

import asyncio
import logging

import uvicorn
from forecastbox.config import FIABConfig
from forecastbox.standalone.config import setup_process

logger = logging.getLogger(__name__)

async def _uvicorn_run(app_name: str, host: str, port: int) -> None:
    # NOTE we pass None to log config to not interfere with original logging setting
    config = uvicorn.Config(
        app_name,
        port=port,
        host=host,
        log_config=None,
        log_level=None,
        workers=1,
    )
    # NOTE this doesnt work due to the way how we start this -- fix somehow
    #    reload=True,
    #    reload_dirs=["forecastbox"],
    server = uvicorn.Server(config)
    await server.serve()


def launch_backend():
    config = FIABConfig()
    # TODO something imported by this module reconfigures the logging -- find and remove!
    import forecastbox.entrypoint

    setup_process()
    logger.debug(f"logging initialized post-{forecastbox.entrypoint.__name__} import")
    port = config.api.uvicorn_port
    host = config.api.uvicorn_host
    task = _uvicorn_run("forecastbox.entrypoint:app", host, port)
    try:
        asyncio.run(task)
    except KeyboardInterrupt:
        pass  # no need to spew stacktrace to log

def launch_cascade(log_path: str|None, log_base: str|None, max_concurrent_jobs: int|None):
    config = FIABConfig()
    # TODO this configuration of log_path is very unsystematic, improve!
    # TODO we may want this to propagate to controller/executors -- but stripped the gateway.txt etc
    setup_process(log_path)
    from cascade.gateway.server import serve

    try:
        serve(url=config.cascade.cascade_url, log_base=log_base, max_jobs=max_concurrent_jobs)
    except KeyboardInterrupt:
        pass  # no need to spew stacktrace to log
