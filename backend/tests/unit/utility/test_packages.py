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
from packaging.specifiers import SpecifierSet
from packaging.version import Version

from forecastbox.utility.packages import (
    get_fiabcore_version,
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
        with patch("forecastbox.utility.packages.get_fiabcore_version", return_value=Version("1.2.3")):
            try_install("some-plugin==2.0.0")
    mock_run.assert_called_once()
    args = mock_run.call_args[0][0]
    assert args[:3] == ["uv", "pip", "install"]
    assert "--upgrade" in args
    assert "some-plugin==2.0.0" in args


def test_try_install_includes_fiabcore_pin() -> None:
    fake_result = MagicMock()
    fake_result.returncode = 0
    with patch("subprocess.run", return_value=fake_result) as mock_run:
        with patch("forecastbox.utility.packages.get_fiabcore_version", return_value=Version("1.2.3")):
            try_install("my-plugin")
    args = mock_run.call_args[0][0]
    assert "fiab-core==1.2.3" in args


def test_try_install_handles_editable_source() -> None:
    fake_result = MagicMock()
    fake_result.returncode = 0
    with patch("subprocess.run", return_value=fake_result) as mock_run:
        with patch("forecastbox.utility.packages.get_fiabcore_version", return_value=Version("0.0.0")):
            try_install("-e /path/to/package")
    args = mock_run.call_args[0][0]
    assert "-e" in args
    assert "/path/to/package" in args


def test_try_install_appends_specifier_to_package() -> None:
    fake_result = MagicMock()
    fake_result.returncode = 0
    spec = SpecifierSet(">=1,<2")
    with patch("subprocess.run", return_value=fake_result) as mock_run:
        with patch("forecastbox.utility.packages.get_fiabcore_version", return_value=Version("1.0.0")):
            try_install("my-plugin", spec)
    args = mock_run.call_args[0][0]
    # package arg must include both the name and the specifier
    package_args = [a for a in args if a.startswith("my-plugin")]
    assert len(package_args) == 1
    assert "my-plugin" in package_args[0]
    assert "1" in package_args[0]  # the specifier contains version numbers


def test_try_install_exact_version_specifier() -> None:
    fake_result = MagicMock()
    fake_result.returncode = 0
    spec = SpecifierSet("==2.5.0")
    with patch("subprocess.run", return_value=fake_result) as mock_run:
        with patch("forecastbox.utility.packages.get_fiabcore_version", return_value=Version("1.0.0")):
            try_install("my-plugin", spec)
    args = mock_run.call_args[0][0]
    assert "my-plugin==2.5.0" in args


def test_try_install_ignores_specifier_for_editable_source() -> None:
    fake_result = MagicMock()
    fake_result.returncode = 0
    spec = SpecifierSet(">=1,<2")
    with patch("subprocess.run", return_value=fake_result) as mock_run:
        with patch("forecastbox.utility.packages.get_fiabcore_version", return_value=Version("1.0.0")):
            try_install("-e /path/to/package", spec)
    args = mock_run.call_args[0][0]
    # specifier should NOT appear in the command for editable installs
    assert not any(">=1" in a or "<2" in a for a in args)
    assert "-e" in args
    assert "/path/to/package" in args


def test_try_install_logs_on_failure() -> None:
    fake_result = MagicMock()
    fake_result.returncode = 1
    fake_result.stderr = b"some error"
    fake_result.stdout = b""
    fake_result.args = []
    with patch("subprocess.run", return_value=fake_result):
        with patch("forecastbox.utility.packages.get_fiabcore_version", return_value=Version("0.0.0")):
            # Should not raise, only log
            try_install("bad-package")


def test_try_install_handles_uv_not_found() -> None:
    with patch("subprocess.run", side_effect=FileNotFoundError("uv not found")):
        with patch("forecastbox.utility.packages.get_fiabcore_version", return_value=Version("0.0.0")):
            # Should not raise
            try_install("some-package")


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
