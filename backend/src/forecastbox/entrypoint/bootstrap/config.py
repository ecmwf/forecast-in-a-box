"""Config related utilities"""

import copy
import datetime as dt
import json
import logging
import logging.config
import os
from tempfile import mkdtemp
from typing import cast

import pydantic
from cascade.executor.config import logging_config

from forecastbox.utility.config import FIABConfig

BACKEND_LOG_DIRECTORY_ENV = "FIAB_BACKEND_LOG_DIRECTORY"


def init_logging_base(config: FIABConfig) -> str:
    """To be called once at the backend process starting. Creates the temporary directory for
    logging and exports the envvar."""
    # NOTE it is tempting to set the log_directory to config, but we cant do that because
    # config may get later persisted eg due to plugin update, and we dont want a temp dir
    # persisted
    startup_params = getattr(config.cascade.gateway, "startup_params", None)
    cascade_logging_base = None if startup_params is None else startup_params.cascade_logging_base
    timestamp = dt.datetime.now().strftime("%Y-%m-%dT%H")
    # NOTE we dont use TemporaryDirectory because we dont want automated cleanup (and
    # older pythons dont support delete=False param)
    if cascade_logging_base is None:
        log_directory = mkdtemp(prefix=f"fiabLogs-{timestamp}")
    else:
        log_directory = mkdtemp(prefix=timestamp, dir=cascade_logging_base)
    os.environ[BACKEND_LOG_DIRECTORY_ENV] = log_directory
    return log_directory


def setup_process(stdout: bool = True, log_path: str | None = None) -> None:
    """Invoke at the start of each new process and configure its logging handlers."""

    # the logging config by default assumes stdout handler -- we need to pop it if stdout=False,
    # and we need to include the filehandler if log_path is not None
    config = copy.deepcopy(logging_config)
    handlers = config["loggers"][""]["handlers"]  # ty:ignore # we implicitly rely on this key
    handlers_config = config["handlers"]
    if not stdout:
        handlers_config.pop("default")
        handlers.remove("default")
    if log_path is not None:
        handlers_config["file"] = {  # ty:ignore # we implicitly rely on this key
            "formatter": "default",
            "class": "logging.FileHandler",
            "filename": log_path,
        }
        handlers.append("file")
    logging.config.dictConfig(config)


def export_recursive(dikt: dict, delimiter: str, prefix: str) -> None:
    for k, v in dikt.items():
        if isinstance(v, dict):
            export_recursive(v, delimiter, f"{prefix}{k}{delimiter}")
        else:
            if isinstance(v, pydantic.SecretStr):
                v = v.get_secret_value()
            if isinstance(v, (list, set)):
                v = json.dumps(list(v))
            if v is not None:
                os.environ[f"{prefix}{k}"] = str(v)
