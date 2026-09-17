import json
import logging.config
import os
from typing import cast
from unittest.mock import patch

import pytest
from pydantic import SecretStr

from forecastbox.entrypoint.bootstrap.config import export_recursive, setup_process


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


@pytest.fixture
def clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in list(os.environ):
        if key.startswith("prefix__"):
            monkeypatch.delenv(key, raising=False)


def test_export_recursive_encodes_tuples_as_json_arrays(clean_env: None, monkeypatch: pytest.MonkeyPatch) -> None:
    """Tuple values (e.g. CascadeConstraints.custom_pip_indices) must be JSON-encoded like lists/sets,
    so pydantic-settings' EnvSettingsSource can parse them back as a complex value. A plain str() of a
    tuple (e.g. "('a',)") is not valid JSON and breaks re-parsing in forkserver-spawned child processes.
    """
    export_recursive({"custom_pip_indices": ("https://download.pytorch.org/whl/cu129",)}, "__", "prefix__")
    assert os.environ["prefix__custom_pip_indices"] == json.dumps(["https://download.pytorch.org/whl/cu129"])


def test_export_recursive_handles_nested_dicts_lists_sets_and_secrets(clean_env: None, monkeypatch: pytest.MonkeyPatch) -> None:
    export_recursive(
        {
            "nested": {"a_list": ["x", "y"], "a_set": {"z"}},
            "secret": SecretStr("shh"),
            "none_value": None,
        },
        "__",
        "prefix__",
    )
    assert json.loads(os.environ["prefix__nested__a_list"]) == ["x", "y"]
    assert json.loads(os.environ["prefix__nested__a_set"]) == ["z"]
    assert os.environ["prefix__secret"] == "shh"
    assert "prefix__none_value" not in os.environ
