# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""
Entrypoint for the standalone fiab execution (frontend, controller and worker spawned by a single process)
"""

# TODO support frontend
# NOTE until migrated to sqlite3 / pymongo_inmemory, use `docker run --rm -it --network host mongo:8.0` in parallel

import asyncio
import logging
import logging.config
import time
import httpx
import uvicorn
import os

from multiprocessing import Process, connection, set_start_method, freeze_support
from cascade.executor.config import logging_config


logger = logging.getLogger(__name__ if __name__ != "__main__" else "forecastbox.standalone.entrypoint")


def setup_process(env_context: dict[str, str]):
    """Invoke at the start of each new process. Configures logging etc"""
    logging.config.dictConfig(logging_config)
    os.environ.update(env_context)


async def uvicorn_run(app_name: str, port: int) -> None:
    # NOTE we pass None to log config to not interfere with original logging setting
    config = uvicorn.Config(
        app_name,
        port=port,
        host="0.0.0.0",
        log_config=None,
        log_level=None,
        workers=1,
    )
    # NOTE this doesnt work due to the way how we start this -- fix somehow
    #    reload=True,
    #    reload_dirs=["forecastbox"],
    server = uvicorn.Server(config)
    await server.serve()


def launch_api(env_context: dict[str, str]):
    setup_process(env_context)
    port = int(env_context["API_URL"].rsplit(":", 1)[1])
    try:
        asyncio.run(uvicorn_run("forecastbox.entrypoint:app", port))
    except KeyboardInterrupt:
        pass  # no need to spew stacktrace to log


def launch_cascade(env_context: dict[str, str]):
    setup_process(env_context)
    from cascade.gateway.server import serve

    try:
        serve(env_context["CASCADE_URL"])
    except KeyboardInterrupt:
        pass  # no need to spew stacktrace to log


def wait_for(client: httpx.Client, status_url: str) -> None:
    """Calls /status endpoint, retry on ConnectError"""
    i = 0
    while i < 10:
        try:
            rc = client.get(status_url)
            if not rc.status_code == 200:
                raise ValueError(f"failed to start {status_url}: {rc}")
            return
        except httpx.ConnectError:
            i += 1
            time.sleep(2)
    raise ValueError(f"failed to start {status_url}: no more retries")


if __name__ == "__main__":
    freeze_support()
    set_start_method("forkserver")
    setup_process({})
    logger.info("main process starting")

    from forecastbox.config import BackendAPISettings, CascadeSettings

    api_settings = BackendAPISettings()
    cascade_settings = CascadeSettings()
    context = {
        # "WEB_URL": settings.web_url,
        "API_URL": api_settings.api_url,
        "CASCADE_URL": cascade_settings.cascade_url,
    }

    cascade = Process(target=launch_cascade, args=(context,))
    cascade.start()

    api = Process(target=launch_api, args=(context,))
    api.start()

    with httpx.Client() as client:
        wait_for(client, context["API_URL"] + "/api/v1/status")

    # webbrowser.open(context["WEB_URL"])

    try:
        connection.wait(
            (
                cascade.sentinel,
                api.sentinel,
            )
        )
    except KeyboardInterrupt:
        logger.info("keyboard interrupt, application shutting down")
        pass  # no need to spew stacktrace to log
