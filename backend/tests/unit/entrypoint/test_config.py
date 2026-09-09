from pathlib import Path
from typing import cast

from forecastbox.entrypoint.bootstrap.config import logging_config_filehandler


def test_logging_config_filehandler_can_tee_to_stdout(tmp_path: Path) -> None:
    log_path = str(tmp_path / "backend.logs.txt")

    config = logging_config_filehandler(log_path)

    handlers = cast(dict[str, dict[str, object]], config["handlers"])
    loggers = cast(dict[str, dict[str, object]], config["loggers"])
    root_logger = loggers[""]
    assert set(handlers) == {"file", "stdout"}
    assert root_logger["handlers"] == ["file", "stdout"]
    assert handlers["file"]["filename"] == log_path


def test_logging_config_filehandler_can_disable_stdout(tmp_path: Path) -> None:
    config = logging_config_filehandler(str(tmp_path / "backend.logs.txt"), stdout=False)

    handlers = cast(dict[str, dict[str, object]], config["handlers"])
    assert set(handlers) == {"file"}
