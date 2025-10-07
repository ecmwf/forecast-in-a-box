"""Config related utilities"""

import json
import logging
import os

import pydantic
from cascade.executor.config import logging_config, logging_config_filehandler


def setup_process(log_path: str | None = None):
    """Invoke at the start of each new process. Configures logging etc"""
    if log_path is not None:
        logging.config.dictConfig(logging_config_filehandler(log_path))
    else:
        logging.config.dictConfig(logging_config)


def export_recursive(dikt, delimiter, prefix):
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
