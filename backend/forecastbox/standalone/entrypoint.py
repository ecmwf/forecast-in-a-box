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
# TODO simplify and refactor -- some of gateway spawning code is duplicated with api/routers/gateway.py now

import asyncio
import logging
import logging.config
import time
import httpx
import uvicorn
import os
from dataclasses import dataclass

from multiprocessing import Process, connection, set_start_method, freeze_support
from cascade.executor.config import logging_config, logging_config_filehandler

import pydantic
from forecastbox.config import FIABConfig


logger = logging.getLogger(__name__ if __name__ != "__main__" else "forecastbox.standalone.entrypoint")


def setup_process(log_path: str | None = None):
    """Invoke at the start of each new process. Configures logging etc"""
    if log_path is not None:
        logging.config.dictConfig(logging_config_filehandler(log_path))
    else:
        logging.config.dictConfig(logging_config)


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


def launch_api():
    config = FIABConfig()
    setup_process()
    port = int(config.api.api_url.rsplit(":", 1)[1])
    try:
        asyncio.run(uvicorn_run("forecastbox.entrypoint:app", port))
    except KeyboardInterrupt:
        pass  # no need to spew stacktrace to log


def launch_cascade():
    config = FIABConfig()
    # TODO this configuration of log_path is very unsystematic, improve!
    # TODO we may want this to propagate to controller/executors -- but stripped the gateway.txt etc
    if (log_path := config.cascade.log_path) is not None:
        setup_process(log_path)
    else:
        setup_process()
    from cascade.gateway.server import serve

    try:
        serve(config.cascade.cascade_url)
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


@dataclass
class ProcessHandles:
    # cascade: Process
    api: Process
    cascade_url: str

    def wait(self) -> None:
        connection.wait(
            (
                # self.cascade.sentinel,
                self.api.sentinel,
            )
        )

    def shutdown(self) -> None:
        # m = cascade.gateway.api.ShutdownRequest()
        # cascade.gateway.client.request_response(m, self.cascade_url, 3_000)
        self.api.terminate()
        self.api.join(1)
        self.api.kill()
        # self.cascade.kill()


def export_recursive(dikt, delimiter, prefix):
    for k, v in dikt.items():
        if isinstance(v, dict):
            export_recursive(v, delimiter, f"{prefix}{k}{delimiter}")
        else:
            if isinstance(v, pydantic.SecretStr):
                v = v.get_secret_value()
            if v is not None:
                os.environ[f"{prefix}{k}"] = str(v)


def launch_all(config: FIABConfig) -> ProcessHandles:
    freeze_support()
    set_start_method("forkserver")
    setup_process()
    logger.info("main process starting")
    export_recursive(config.model_dump(), config.model_config["env_nested_delimiter"], config.model_config["env_prefix"])

    api = Process(target=launch_api)
    api.start()

    with httpx.Client() as client:
        wait_for(client, config.api.api_url + "/api/v1/status")
        client.post(config.api.api_url + "/api/v1/gateway/start").raise_for_status()

    return ProcessHandles(api=api, cascade_url=config.cascade.cascade_url)

    # webbrowser.open(config.frontend_url)


if __name__ == "__main__":
    config = FIABConfig()
    handles = launch_all(config)
    try:
        handles.wait()
    except KeyboardInterrupt:
        logger.info("keyboard interrupt, application shutting down")
        pass  # no need to spew stacktrace to log
