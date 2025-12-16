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
import webbrowser
from multiprocessing import Process, get_context

import forecastbox.standalone.service
from forecastbox.config import FIABConfig, validate_runtime
from forecastbox.standalone.checks import check_backend_ready
from forecastbox.standalone.config import export_recursive, setup_process
from forecastbox.standalone.launchers import launch_backend
from forecastbox.standalone.procs import ChildProcessGroup, previous_cleanup

logger = logging.getLogger(__name__ if __name__ != "__main__" else __package__)


def launch_all(config: FIABConfig, attempts: int = 20) -> ChildProcessGroup:
    setup_process()
    logger.info("main process starting")
    logger.debug(f"loaded config {config.model_dump()}")

    if not config.api.allow_service:
        previous_cleanup()
        export_recursive(
            config.model_dump(exclude_defaults=True),
            config.model_config["env_nested_delimiter"],
            config.model_config["env_prefix"],
        )
        # TODO migrate to cascade_platform -- but we *need* forkserver for linux. Mind service.py here as well
        backend = get_context("forkserver").Process(target=launch_backend)
        backend.start()
        handle = ChildProcessGroup([backend])
        spawn_gateway = True
    else:
        if not forecastbox.standalone.service.is_running():
            raise ValueError("configured to use service, but is not running!")
        handle = ChildProcessGroup([])
        spawn_gateway = False

    check_backend_ready(config, handle, attempts, spawn_gateway)

    if config.general.launch_browser:
        webbrowser.open(config.api.local_url())

    return handle


if __name__ == "__main__":
    config = FIABConfig()
    validate_runtime(config)
    handles = launch_all(config)

    def sigterm_handler(_signo, _stack_frame):
        handles.shutdown()
        sys.exit(0)

    signal.signal(signal.SIGTERM, sigterm_handler)
    try:
        handles.wait()
    except KeyboardInterrupt:
        logger.info("keyboard interrupt, application shutting down")
        handles.wait()
