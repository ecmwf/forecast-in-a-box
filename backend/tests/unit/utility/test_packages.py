# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import importlib.metadata
import subprocess
from types import ModuleType
from unittest.mock import MagicMock, patch

import pytest
from packaging.version import Version

from forecastbox.domain.plugin.compatibility import get_fiabcore_version
from forecastbox.utility.packages import (
    get_package_versions,
    try_import,
    try_install,
    try_updatedate,
    try_version,
)

# ---------------------------------------------------------------------------
# try_import
# ---------------------------------------------------------------------------


def test_try_import_success() -> None:
    result = try_import("os")
    assert result is not None
    import os

    assert result is os


def test_try_import_not_found() -> None:
    result = try_import("definitely_nonexistent_module_xyz")
    assert result is None


# ---------------------------------------------------------------------------
# try_version
# ---------------------------------------------------------------------------


def test_try_version_from_metadata() -> None:
    with patch("importlib.metadata.version", return_value="1.2.3"):
        result = try_version("some-package", "some_module")
    assert result == "1.2.3"


def test_try_version_falls_back_to_module_attribute() -> None:
    with patch("importlib.metadata.version", side_effect=importlib.metadata.PackageNotFoundError):
        fake_module = MagicMock(spec=ModuleType)
        fake_module._version = "0.9.1"
        with patch("forecastbox.utility.packages.try_import", return_value=fake_module):
            result = try_version("missing-package", "some_module")
    assert result == "0.9.1"


def test_try_version_returns_unknown_when_all_fail() -> None:
    with patch("importlib.metadata.version", side_effect=importlib.metadata.PackageNotFoundError):
        with patch("forecastbox.utility.packages.try_import", return_value=None):
            result = try_version("missing-package", "missing_module")
    assert result == "unknown"


def test_try_version_returns_unknown_when_module_has_no_version_attribute() -> None:
    with patch("importlib.metadata.version", side_effect=importlib.metadata.PackageNotFoundError):
        fake_module = MagicMock(spec=ModuleType)
        del fake_module._version  # ensure attribute is absent
        with patch("forecastbox.utility.packages.try_import", return_value=fake_module):
            result = try_version("missing-package", "some_module")
    assert result == "unknown"


# ---------------------------------------------------------------------------
# try_updatedate
# ---------------------------------------------------------------------------


def test_try_updatedate_package_not_found() -> None:
    with patch("importlib.metadata.distribution", side_effect=importlib.metadata.PackageNotFoundError):
        result = try_updatedate("nonexistent-package")
    assert result == "unknown"


def test_try_updatedate_success(tmp_path: pytest.TempPathFactory) -> None:
    metadata_file = tmp_path / "METADATA"  # type: ignore[operator]
    metadata_file.write_text("Metadata-Version: 2.1")

    fake_file = MagicMock()
    fake_file.name = "METADATA"
    fake_file.locate.return_value = metadata_file

    fake_dist = MagicMock()
    fake_dist.files = [fake_file]

    with patch("importlib.metadata.distribution", return_value=fake_dist):
        result = try_updatedate("some-package")

    assert result != "unknown"
    # Should be in YYYY/MM/DD format
    parts = result.split("/")
    assert len(parts) == 3
    assert len(parts[0]) == 4  # year


def test_try_updatedate_no_metadata_file() -> None:
    fake_dist = MagicMock()
    fake_dist.files = []  # no METADATA file

    with patch("importlib.metadata.distribution", return_value=fake_dist):
        result = try_updatedate("some-package")

    assert result == "unknown"


def test_try_updatedate_dist_has_no_files() -> None:
    fake_dist = MagicMock()
    fake_dist.files = None

    with patch("importlib.metadata.distribution", return_value=fake_dist):
        result = try_updatedate("some-package")

    assert result == "unknown"


# ---------------------------------------------------------------------------
# try_install
# ---------------------------------------------------------------------------


def test_try_install_calls_uv_pip_install() -> None:
    fake_result = MagicMock()
    fake_result.returncode = 0
    with patch("subprocess.run", return_value=fake_result) as mock_run:
        try_install(["some-plugin==2.0.0"])
    mock_run.assert_called_once()
    args = mock_run.call_args[0][0]
    assert args[:3] == ["uv", "pip", "install"]
    assert "some-plugin==2.0.0" in args


def test_try_install_logs_on_failure() -> None:
    fake_result = MagicMock()
    fake_result.returncode = 1
    fake_result.stderr = b"some error"
    fake_result.stdout = b""
    fake_result.args = []
    with patch("subprocess.run", return_value=fake_result):
        # Should not raise, only log
        try_install(["bad-package"])


def test_try_install_handles_uv_not_found() -> None:
    with patch("subprocess.run", side_effect=FileNotFoundError("uv not found")):
        # Should not raise
        try_install(["some-package"])


# ---------------------------------------------------------------------------
# get_fiabcore_version
# ---------------------------------------------------------------------------


def test_get_fiabcore_version_returns_version_object() -> None:
    with patch("importlib.metadata.version", return_value="2.5.3"):
        result = get_fiabcore_version()
    assert isinstance(result, Version)
    assert result.major == 2
    assert result.minor == 5
    assert result.micro == 3


def test_get_fiabcore_version_current_install() -> None:
    # Smoke test: fiab-core is installed in this environment
    result = get_fiabcore_version()
    assert isinstance(result, Version)


# ---------------------------------------------------------------------------
# get_package_versions
# ---------------------------------------------------------------------------


def _make_pypi_response(releases: dict) -> MagicMock:
    """Build a fake httpx.Response-like mock for the PyPI JSON API."""
    mock = MagicMock()
    mock.status_code = 200
    mock.json.return_value = {"releases": releases}
    return mock


def test_get_package_versions_returns_all_releases() -> None:
    releases = {"1.0.0": [], "1.1.0": [], "2.0.0": []}
    with patch("httpx.Client.get", return_value=_make_pypi_response(releases)):
        result = list(get_package_versions("some-plugin"))
    assert set(result) == {"1.0.0", "1.1.0", "2.0.0"}


def test_get_package_versions_empty_releases() -> None:
    with patch("httpx.Client.get", return_value=_make_pypi_response({})):
        result = list(get_package_versions("some-plugin"))
    assert result == []


def test_get_package_versions_non_200_returns_empty() -> None:
    mock_resp = MagicMock()
    mock_resp.status_code = 404
    with patch("httpx.Client.get", return_value=mock_resp):
        result = list(get_package_versions("nonexistent-plugin"))
    assert result == []


def test_get_package_versions_network_error_returns_empty() -> None:
    with patch("httpx.Client.get", side_effect=Exception("network failure")):
        result = list(get_package_versions("some-plugin"))
    assert result == []


def test_get_package_versions_bad_json_returns_empty() -> None:
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.side_effect = ValueError("not JSON")
    with patch("httpx.Client.get", return_value=mock_resp):
        result = list(get_package_versions("some-plugin"))
    assert result == []


def test_get_package_versions_is_iterator() -> None:
    releases = {"1.0.0": [], "2.0.0": []}
    with patch("httpx.Client.get", return_value=_make_pypi_response(releases)):
        result = get_package_versions("some-plugin")
    import inspect

    assert inspect.isgenerator(result)
