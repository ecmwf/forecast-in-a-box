"""Config related utilities"""

import copy
import json
import logging
import logging.config
import os
from typing import cast

import pydantic
from cascade.executor.config import logging_config


def setup_process(stdout: bool = True, log_path: str | None = None) -> None:
    """Invoke at the start of each new process and configure its logging handlers."""
    config = copy.deepcopy(logging_config)
    handlers = []
    handlers_config = cast(dict[str, object], config["handlers"])
    if stdout:
        handlers.append("default")
    else:
        handlers_config.pop("default")
    if log_path is not None:
        handlers_config["file"] = {
            "formatter": "default",
            "class": "logging.FileHandler",
            "filename": log_path,
        }
        handlers.append("file")
    else:
        config["handlers"] = {} if not stdout else handlers_config
    loggers_config = cast(dict[str, object], config["loggers"])
    loggers_config[""] = {"level": "WARNING", "handlers": handlers}
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
