# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Entrypoint for the standalone fiab execution (frontend, backend and cascade spawned by a single process).
Also used in case backend+cascade were launched by the OS as a service, in which case we only check the service
for liveness and open the browser window here, with the rest logic happening in standalone.service
"""

import logging
import signal
import sys
import types
import webbrowser
from multiprocessing import Process, get_context

import httpx
from fiab_core.fable import PluginCompositeId

import forecastbox.entrypoint.bootstrap.service
from forecastbox.domain.admin import should_install_default_plugin
from forecastbox.entrypoint.bootstrap.checks import check_backend_ready, install_default_plugins
from forecastbox.entrypoint.bootstrap.config import export_recursive, setup_process
from forecastbox.entrypoint.bootstrap.launchers import launch_backend
from forecastbox.entrypoint.bootstrap.procs import ChildProcessGroup, previous_cleanup
from forecastbox.utility.config import FIABConfig, LocalGateway, UnmanagedGateway, validate_runtime

logger = logging.getLogger(__name__ if __name__ != "__main__" else __package__)


def launch_all(config: FIABConfig, attempts: int = 20) -> ChildProcessGroup:
    setup_process()
    logger.info("main process starting")
    logger.debug(f"loaded config {config.model_dump()}")

    if not config.backend.allow_service:
        previous_cleanup()
        export_recursive(
            config.model_dump(exclude_defaults=True),
            config.model_config["env_nested_delimiter"],  # ty:ignore[invalid-argument-type]
            config.model_config["env_prefix"],  # ty:ignore[invalid-argument-type]
        )
        # TODO migrate to cascade_platform -- but we *need* forkserver for linux. Mind service.py here as well
        backend = get_context("forkserver").Process(target=launch_backend)
        backend.start()
        handle = ChildProcessGroup((backend,))
        spawn_gateway = not isinstance(config.cascade.gateway, UnmanagedGateway)
    else:
        if not forecastbox.entrypoint.bootstrap.service.is_running():
            raise ValueError("configured to use service, but is not running!")
        handle = ChildProcessGroup(())
        spawn_gateway = False

    check_backend_ready(config, handle, attempts, spawn_gateway)
    if should_install_default_plugin():
        logger.debug("will install default plugins")
        install_default_plugins(config)

    if config.backend.launch_browser:
        webbrowser.open(config.backend.local_url())

    return handle


def _maybe_shutdown_local_gateway(config: FIABConfig) -> None:
    """Best-effort shutdown of a locally-managed Cascade gateway process.

    The gateway (when using LocalGateway) is spawned as a child of the `backend` process itself
    (in response to the `/gateway/start` call in `check_backend_ready`), so `ChildProcessGroup.shutdown`
    (which only knows about the `backend` process) cannot reach it. We ask the still-alive backend
    to kill its own gateway child before we tear the backend process down.

    TODO: RemoteGateway also spawns a process (over an ssh tunnel) that is not stopped here. Extend
    this once we have a reliable way to tear that down as well.
    """
    if not isinstance(config.cascade.gateway, LocalGateway):
        return
    try:
        with httpx.Client() as client:
            client.post(config.backend.local_url() + "/api/v1/gateway/kill", timeout=5)
    except Exception:
        logger.warning("failed to shut down the local cascade gateway during teardown", exc_info=True)


if __name__ == "__main__":
    # NOTE this is referenced from scripts/fiab.sh -- if you refactor this module, pay attention to it
    config = FIABConfig()
    validate_runtime(config)
    handles = launch_all(config)

    def sigterm_handler(_signo: int, _stack_frame: types.FrameType | None) -> None:
        _maybe_shutdown_local_gateway(config)
        handles.shutdown()
        sys.exit(0)

    signal.signal(signal.SIGTERM, sigterm_handler)
    try:
        handles.wait()
    except KeyboardInterrupt:
        logger.info("keyboard interrupt, application shutting down")
        handles.wait()
