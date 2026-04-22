# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Launcher methods for backend and cascade -- utilized by
- entrypoint.main for launch_backend,
- entrypoint.bootstrap.service for launch_backend,
"""

import asyncio
import logging

import uvicorn

from forecastbox.entrypoint.bootstrap.config import setup_process
from forecastbox.utility.config import FIABConfig

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


def launch_backend() -> None:
    config = FIABConfig()
    # TODO something imported by this module reconfigures the logging -- find and remove!
    import forecastbox.entrypoint.app  # import inside function justified due to side effects

    setup_process()
    logger.debug(f"logging initialized post-{forecastbox.entrypoint.app.__name__} import")
    port = config.api.uvicorn_port
    host = config.api.uvicorn_host
    task = _uvicorn_run("forecastbox.entrypoint.app:app", host, port)
    try:
        asyncio.run(task)
    except KeyboardInterrupt:
        pass  # no need to spew stacktrace to log
