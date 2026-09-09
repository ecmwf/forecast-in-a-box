"""Config related utilities"""

import copy
import json
import logging
import logging.config
import os

import pydantic

# Keep this configuration local to the backend. Cascade's file logging configuration only
# supports selecting one handler, while the backend needs to retain its stdout handler too.
logging_config = {
    "version": 1,
    "disable_existing_loggers": True,
    "formatters": {
        "default": {
            "format": "{asctime}:{levelname}:{name}:{process}:{message:1.10000}",
            "style": "{",
        },
    },
    "handlers": {
        "default": {
            "formatter": "default",
            "class": "logging.StreamHandler",
            "stream": "ext://sys.stderr",
        },
    },
    "loggers": {
        "uvicorn": {"level": "INFO"},
        "forecastbox": {"level": "DEBUG"},
        "forecastbox.worker": {"level": "DEBUG"},
        "forecastbox.executor": {"level": "DEBUG"},
        "cascade": {"level": "INFO"},
        "cascade.main": {"level": "DEBUG"},
        "cascade.low": {"level": "DEBUG"},
        "cascade.shm": {"level": "DEBUG"},
        "cascade.controller": {"level": "DEBUG"},
        "cascade.executor": {"level": "DEBUG"},
        "cascade.scheduler": {"level": "DEBUG"},
        "cascade.gateway": {"level": "DEBUG"},
        "earthkit.workflows": {"level": "DEBUG"},
        "httpcore": {"level": "ERROR"},
        "httpx": {"level": "ERROR"},
        "": {"level": "WARNING", "handlers": ["default"]},
    },
}


def logging_config_filehandler(filename: str, stdout: bool = True) -> dict[str, object]:
    handlers: dict[str, dict[str, str]] = {
        "file": {
            "formatter": "default",
            "class": "logging.FileHandler",
            "filename": filename,
        },
    }
    if stdout:
        handlers["stdout"] = {
            "formatter": "default",
            "class": "logging.StreamHandler",
            "stream": "ext://sys.stderr",
        }
    config = copy.deepcopy(logging_config)
    config["handlers"] = handlers
    config["loggers"] = {
        **logging_config["loggers"],
        "": {"level": "WARNING", "handlers": list(handlers)},
    }
    return config


def setup_process(stdout: bool = True, log_path: str | None = None) -> None:
    """Invoke at the start of each new process and configure its logging handlers."""
    if log_path is not None:
        config = logging_config_filehandler(log_path, stdout=stdout)
    elif stdout:
        config = copy.deepcopy(logging_config)
    else:
        config = copy.deepcopy(logging_config)
        config["handlers"] = {}
        config["loggers"] = {
            **logging_config["loggers"],
            "": {"level": "WARNING", "handlers": []},
        }
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
