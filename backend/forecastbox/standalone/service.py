"""Utility functions related to the backend running as a service, as well as entrypoint to start it"""

import logging
from multiprocessing import Process, freeze_support, set_start_method

import psutil
from forecastbox.config import FIABConfig, fiab_home, validate_runtime
from forecastbox.standalone.checks import check_backend_ready
from forecastbox.standalone.config import export_recursive, setup_process
from forecastbox.standalone.launchers import launch_backend
from forecastbox.standalone.procs import ChildProcessGroup, previous_cleanup

logger = logging.getLogger(__name__ if __name__ != "__main__" else __package__)

pidfile = fiab_home / "pid"

def mark_started(pid: int):
    pidfile.write_text(f"{pid}")

def is_running() -> bool:
    if not pidfile.is_file():
        return False
    pid = pidfile.read_text()
    if not pid.isdigit():
        return False
    pid = int(pid)
    if not psutil.pid_exists(pid):
        return False
    return True


if __name__ == "__main__":
    config = FIABConfig()
    validate_runtime(config)

    freeze_support()
    set_start_method("forkserver")
    setup_process()

    if not config.api.allow_service:
        raise TypeError("launched as a service but config incompatible")

    previous_cleanup()
    export_recursive(
        config.model_dump(exclude_defaults=True), config.model_config["env_nested_delimiter"], config.model_config["env_prefix"],
    )
    backend = Process(target=launch_backend)
    backend.start()
    handle = ChildProcessGroup([backend])
    if backend.pid:
        mark_started(backend.pid)
    else:
        raise ValueError(f"start failure: {backend.exitcode}")

    check_backend_ready(config, handle)
