import logging.config
from typing import cast
from unittest.mock import patch

from forecastbox.entrypoint.bootstrap.config import setup_process


def _configured_logging() -> dict[str, object]:
    with patch.object(logging.config, "dictConfig") as dict_config:
        setup_process(log_path="/tmp/backend.logs.txt")
        return cast(dict[str, object], dict_config.call_args.args[0])


def test_setup_process_can_tee_to_stdout() -> None:
    config = _configured_logging()

    handlers = cast(dict[str, dict[str, object]], config["handlers"])
    loggers = cast(dict[str, dict[str, object]], config["loggers"])
    assert set(handlers) == {"default", "file"}
    assert loggers[""]["handlers"] == ["default", "file"]
    assert handlers["file"]["filename"] == "/tmp/backend.logs.txt"


def test_setup_process_can_disable_stdout() -> None:
    with patch.object(logging.config, "dictConfig") as dict_config:
        setup_process(stdout=False, log_path="/tmp/backend.logs.txt")
        config = cast(dict[str, object], dict_config.call_args.args[0])

    handlers = cast(dict[str, dict[str, object]], config["handlers"])
    loggers = cast(dict[str, dict[str, object]], config["loggers"])
    assert set(handlers) == {"file"}
    assert loggers[""]["handlers"] == ["file"]
