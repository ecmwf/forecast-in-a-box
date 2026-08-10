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
from datetime import UTC
from types import ModuleType
from unittest.mock import MagicMock, patch

import pytest
from packaging.version import Version

from forecastbox.domain.plugin.compatibility import get_fiabcore_version
from forecastbox.utility.packages import (
    CommandResult,
    EnvironmentSnapshot,
    PackagesError,
    build_install_command,
    exclude_distribution,
    extract_editable_local_requirements,
    freeze_environment,
    get_package_versions,
    parse_frozen_environment,
    parse_install_output,
    render_constraints,
    run_pip_check,
    run_pip_install,
    temporary_constraints_file,
    try_import,
    try_updatedatetime,
    try_version,
)
from forecastbox.utility.time import value_dt2str

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
# try_updatedatetime
# ---------------------------------------------------------------------------


def test_try_updatedatetime_package_not_found() -> None:
    with patch("importlib.metadata.distribution", side_effect=importlib.metadata.PackageNotFoundError):
        result = try_updatedatetime("nonexistent-package")
    assert result == "unknown"


def test_try_updatedatetime_success(tmp_path: pytest.TempPathFactory) -> None:
    metadata_file = tmp_path / "METADATA"  # type: ignore[operator]
    metadata_file.write_text("Metadata-Version: 2.1")

    fake_file = MagicMock()
    fake_file.name = "METADATA"
    fake_file.locate.return_value = metadata_file

    fake_dist = MagicMock()
    fake_dist.files = [fake_file]

    with patch("importlib.metadata.distribution", return_value=fake_dist):
        result = try_updatedatetime("some-package")

    assert result != "unknown"
    # Should be in YYYY-MM-DDTHH:MM:SS format
    import re

    assert re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$", result), f"Unexpected format: {result!r}"


def test_try_updatedatetime_success_uses_ctime(tmp_path: pytest.TempPathFactory) -> None:
    import datetime
    from unittest.mock import patch

    metadata_file = tmp_path / "METADATA"  # type: ignore[operator]
    metadata_file.write_text("Metadata-Version: 2.1")

    fake_file = MagicMock()
    fake_file.name = "METADATA"
    fake_file.locate.return_value = metadata_file

    fake_dist = MagicMock()
    fake_dist.files = [fake_file]

    fixed_dt = datetime.datetime(2024, 3, 15, 10, 30, 45).astimezone(UTC)
    fixed_ts = fixed_dt.timestamp()
    fake_stat = MagicMock()
    fake_stat.st_ctime = fixed_ts

    with patch("importlib.metadata.distribution", return_value=fake_dist):
        with patch("pathlib.Path.stat", return_value=fake_stat):
            result = try_updatedatetime("some-package")

    assert result == value_dt2str(fixed_dt)


def test_try_updatedatetime_no_metadata_file() -> None:
    fake_dist = MagicMock()
    fake_dist.files = []  # no METADATA file

    with patch("importlib.metadata.distribution", return_value=fake_dist):
        result = try_updatedatetime("some-package")

    assert result == "unknown"


def test_try_updatedatetime_dist_has_no_files() -> None:
    fake_dist = MagicMock()
    fake_dist.files = None

    with patch("importlib.metadata.distribution", return_value=fake_dist):
        result = try_updatedatetime("some-package")

    assert result == "unknown"


def test_try_updatedatetime_stat_raises_returns_unknown(tmp_path: pytest.TempPathFactory) -> None:
    metadata_file = tmp_path / "METADATA"  # type: ignore[operator]
    metadata_file.write_text("Metadata-Version: 2.1")

    fake_file = MagicMock()
    fake_file.name = "METADATA"
    fake_file.locate.return_value = metadata_file

    fake_dist = MagicMock()
    fake_dist.files = [fake_file]

    with patch("importlib.metadata.distribution", return_value=fake_dist):
        with patch("pathlib.Path.stat", side_effect=OSError("permission denied")):
            result = try_updatedatetime("some-package")

    assert result == "unknown"


# ---------------------------------------------------------------------------
# parse_install_output
# ---------------------------------------------------------------------------


def test_parse_install_output_extracts_plus_lines() -> None:
    output = "  + fiab-plugin-test==0.1.0 (from file:///path/to/package)\n  + other-pkg==1.2.3\n"
    result = parse_install_output(output)
    assert result == {"fiab-plugin-test": "0.1.0", "other-pkg": "1.2.3"}


def test_parse_install_output_extracts_tilde_lines() -> None:
    output = "  ~ cached-pkg==2.0.0\n"
    result = parse_install_output(output)
    assert result == {"cached-pkg": "2.0.0"}


def test_parse_install_output_ignores_unrelated_lines() -> None:
    output = "Resolved 3 packages\n  + real-pkg==1.0.0\nSome other line\n"
    result = parse_install_output(output)
    assert result == {"real-pkg": "1.0.0"}


def test_parse_install_output_ignores_malformed_version_line() -> None:
    output = "  + no-version-here\n  + real-pkg==1.0.0\n"
    result = parse_install_output(output)
    assert result == {"real-pkg": "1.0.0"}


# ---------------------------------------------------------------------------
# CommandResult / _run_command (via freeze/check/install wrappers)
# ---------------------------------------------------------------------------


def test_freeze_environment_returns_lines() -> None:
    fake = MagicMock()
    fake.returncode = 0
    fake.stdout = "pkg-a==1.0.0\npkg-b==2.0.0\n"
    fake.stderr = ""
    fake.args = ["uv", "pip", "freeze", "--python", "/usr/bin/python3"]
    with patch("subprocess.run", return_value=fake) as mock_run:
        lines = freeze_environment("/usr/bin/python3")
    assert lines == ["pkg-a==1.0.0", "pkg-b==2.0.0"]
    args = mock_run.call_args[0][0]
    assert args == ["uv", "pip", "freeze", "--python", "/usr/bin/python3"]


def test_freeze_environment_raises_on_failure() -> None:
    fake = MagicMock()
    fake.returncode = 1
    fake.stdout = ""
    fake.stderr = "boom"
    fake.args = []
    with patch("subprocess.run", return_value=fake):
        with pytest.raises(PackagesError):
            freeze_environment("/usr/bin/python3")


def test_freeze_environment_uv_missing_raises() -> None:
    with patch("subprocess.run", side_effect=FileNotFoundError("uv not found")):
        with pytest.raises(PackagesError):
            freeze_environment("/usr/bin/python3")


def test_run_pip_check_returns_command_result() -> None:
    fake = MagicMock()
    fake.returncode = 0
    fake.stdout = "No broken requirements found."
    fake.stderr = ""
    fake.args = ["uv", "pip", "check", "--python", "/usr/bin/python3"]
    with patch("subprocess.run", return_value=fake) as mock_run:
        result = run_pip_check("/usr/bin/python3")
    assert isinstance(result, CommandResult)
    assert result.ok
    args = mock_run.call_args[0][0]
    assert args == ["uv", "pip", "check", "--python", "/usr/bin/python3"]


# ---------------------------------------------------------------------------
# parse_frozen_environment / classification
# ---------------------------------------------------------------------------


def test_parse_frozen_environment_ordinary_pin() -> None:
    snapshot = parse_frozen_environment(["pydantic==2.12.0"])
    assert len(snapshot.distributions) == 1
    entry = snapshot.distributions[0]
    assert entry.kind == "pin"
    assert entry.name == "pydantic"
    assert entry.constraint == "pydantic==2.12.0"
    assert entry.requirement_args == ()


def test_parse_frozen_environment_preserves_markers() -> None:
    line = 'pydantic==2.12.0; python_version >= "3.8"'
    snapshot = parse_frozen_environment([line])
    assert snapshot.distributions[0].constraint == line


def test_parse_frozen_environment_canonicalizes_names() -> None:
    snapshot = parse_frozen_environment(["Fiab_Plugin.Test==0.1.0"])
    assert snapshot.distributions[0].name == "fiab-plugin-test"


def test_parse_frozen_environment_skips_blank_and_comment_lines() -> None:
    snapshot = parse_frozen_environment(["", "   ", "# a comment", "pkg==1.0.0"])
    assert len(snapshot.distributions) == 1
    assert snapshot.distributions[0].name == "pkg"


def test_parse_frozen_environment_pep508_file_reference() -> None:
    line = "some-package @ file:///wheelhouse/some_package.whl"
    snapshot = parse_frozen_environment([line])
    entry = snapshot.distributions[0]
    assert entry.kind == "local"
    assert entry.name == "some-package"
    assert entry.requirement_args == (line,)
    assert entry.constraint is None


def test_parse_frozen_environment_editable_resolves_via_metadata() -> None:
    fake_dist = MagicMock()
    fake_dist.metadata = {"Name": "fiab-core"}
    fake_dist.origin = None

    def fake_read_text(name: str) -> str | None:
        if name == "direct_url.json":
            return '{"url": "file:///workspace/fiab-core", "dir_info": {"editable": true}}'
        return None

    fake_dist.read_text.side_effect = fake_read_text

    with patch("importlib.metadata.distributions", return_value=[fake_dist]):
        snapshot = parse_frozen_environment(["-e file:///workspace/fiab-core"])
    entry = snapshot.distributions[0]
    assert entry.kind == "editable"
    assert entry.name == "fiab-core"
    assert entry.requirement_args == ("-e", "/workspace/fiab-core")


def test_parse_frozen_environment_editable_with_origin_attribute() -> None:
    fake_dist = MagicMock()
    fake_dist.metadata = {"Name": "fiab-core"}
    fake_dist.origin = MagicMock(url="file:///workspace/fiab-core")

    with patch("importlib.metadata.distributions", return_value=[fake_dist]):
        snapshot = parse_frozen_environment(["--editable file:///workspace/fiab-core"])
    entry = snapshot.distributions[0]
    assert entry.kind == "editable"
    assert entry.name == "fiab-core"
    assert entry.requirement_args == ("--editable", "/workspace/fiab-core")


def test_parse_frozen_environment_editable_egg_fragment_does_not_need_metadata() -> None:
    snapshot = parse_frozen_environment(["-e file:///workspace/some-project#egg=some-project"])
    entry = snapshot.distributions[0]
    assert entry.kind == "editable"
    assert entry.name == "some-project"


def test_parse_frozen_environment_unidentifiable_editable_fails_closed() -> None:
    with patch("importlib.metadata.distributions", return_value=[]):
        with pytest.raises(PackagesError):
            parse_frozen_environment(["-e file:///unknown/path"])


def test_parse_frozen_environment_malformed_requirement_fails_closed() -> None:
    with pytest.raises(PackagesError):
        parse_frozen_environment(["not a valid requirement!!!"])


def test_parse_frozen_environment_path_with_spaces() -> None:
    fake_dist = MagicMock()
    fake_dist.metadata = {"Name": "spacey-project"}
    fake_dist.origin = MagicMock(url="file:///workspace/spacey project")

    with patch("importlib.metadata.distributions", return_value=[fake_dist]):
        snapshot = parse_frozen_environment(["-e file:///workspace/spacey project"])
    entry = snapshot.distributions[0]
    assert entry.requirement_args == ("-e", "/workspace/spacey project")


# ---------------------------------------------------------------------------
# exclude_distribution
# ---------------------------------------------------------------------------


def test_exclude_distribution_removes_ordinary_pin() -> None:
    snapshot = parse_frozen_environment(["pkg-a==1.0.0", "pkg-b==2.0.0"])
    result = exclude_distribution(snapshot, "pkg-a")
    assert [d.name for d in result.distributions] == ["pkg-b"]


def test_exclude_distribution_removes_editable() -> None:
    fake_dist = MagicMock()
    fake_dist.metadata = {"Name": "fiab-core"}
    fake_dist.origin = MagicMock(url="file:///workspace/fiab-core")
    with patch("importlib.metadata.distributions", return_value=[fake_dist]):
        snapshot = parse_frozen_environment(["-e file:///workspace/fiab-core", "pkg-b==2.0.0"])
    result = exclude_distribution(snapshot, "fiab-core")
    assert [d.name for d in result.distributions] == ["pkg-b"]


def test_exclude_distribution_canonical_name_matching() -> None:
    snapshot = parse_frozen_environment(["Fiab_Plugin.Test==0.1.0"])
    result = exclude_distribution(snapshot, "FIAB-PLUGIN-TEST")
    assert result.distributions == ()


def test_exclude_distribution_does_not_remove_similarly_named() -> None:
    snapshot = parse_frozen_environment(["my-plugin==1.0.0", "my-plugin-extra==1.0.0"])
    result = exclude_distribution(snapshot, "my-plugin")
    assert [d.name for d in result.distributions] == ["my-plugin-extra"]


# ---------------------------------------------------------------------------
# render_constraints / extract_editable_local_requirements
# ---------------------------------------------------------------------------


def test_render_constraints_joins_pins_with_trailing_newline() -> None:
    snapshot = parse_frozen_environment(["pkg-a==1.0.0", "pkg-b==2.0.0"])
    text = render_constraints(snapshot)
    assert text == "pkg-a==1.0.0\npkg-b==2.0.0\n"


def test_render_constraints_empty_snapshot_is_valid_empty_string() -> None:
    snapshot = EnvironmentSnapshot(distributions=())
    assert render_constraints(snapshot) == ""


def test_render_constraints_excludes_editable_local() -> None:
    fake_dist = MagicMock()
    fake_dist.metadata = {"Name": "fiab-core"}
    fake_dist.origin = MagicMock(url="file:///workspace/fiab-core")
    with patch("importlib.metadata.distributions", return_value=[fake_dist]):
        snapshot = parse_frozen_environment(["-e file:///workspace/fiab-core", "pkg-b==2.0.0"])
    assert render_constraints(snapshot) == "pkg-b==2.0.0\n"


def test_extract_editable_local_requirements_tokenizes_correctly() -> None:
    fake_dist = MagicMock()
    fake_dist.metadata = {"Name": "fiab-core"}
    fake_dist.origin = MagicMock(url="file:///workspace/fiab-core")
    with patch("importlib.metadata.distributions", return_value=[fake_dist]):
        snapshot = parse_frozen_environment(
            [
                "-e file:///workspace/fiab-core",
                "some-package @ file:///wheelhouse/some_package.whl",
                "pkg-b==2.0.0",
            ]
        )
    args = extract_editable_local_requirements(snapshot)
    assert args == ["-e", "/workspace/fiab-core", "some-package @ file:///wheelhouse/some_package.whl"]


# ---------------------------------------------------------------------------
# temporary_constraints_file
# ---------------------------------------------------------------------------


def test_temporary_constraints_file_content_and_cleanup() -> None:
    import pathlib

    text = "pkg-a==1.0.0\npkg-b==2.0.0\n"
    with temporary_constraints_file(text) as path:
        p = pathlib.Path(path)
        assert p.exists()
        assert p.read_text(encoding="utf-8") == text
    assert not pathlib.Path(path).exists()


def test_temporary_constraints_file_cleanup_on_exception() -> None:
    import pathlib

    path_holder: list[str] = []
    with pytest.raises(RuntimeError):
        with temporary_constraints_file("pkg==1.0.0\n") as path:
            path_holder.append(path)
            raise RuntimeError("boom")
    assert not pathlib.Path(path_holder[0]).exists()


# ---------------------------------------------------------------------------
# build_install_command / run_pip_install
# ---------------------------------------------------------------------------


def test_build_install_command_explicit_python_and_constraints() -> None:
    cmd = build_install_command("/usr/bin/python3", "/tmp/constraints.txt", [], ["my-plugin==1.0.0"], dry_run=False)
    assert cmd == ["uv", "pip", "install", "--python", "/usr/bin/python3", "--constraints", "/tmp/constraints.txt", "my-plugin==1.0.0"]


def test_build_install_command_dry_run_and_real_only_differ_by_flag() -> None:
    extra = ["-e", "/workspace/fiab-core"]
    plugin = ["my-plugin==1.0.0"]
    dry = build_install_command("/usr/bin/python3", "/tmp/c.txt", extra, plugin, dry_run=True)
    real = build_install_command("/usr/bin/python3", "/tmp/c.txt", extra, plugin, dry_run=False)
    assert dry == real + ["--dry-run"] or set(dry) - set(real) == {"--dry-run"}
    assert [a for a in dry if a != "--dry-run"] == real


def test_run_pip_install_dry_run_true_includes_flag() -> None:
    fake = MagicMock()
    fake.returncode = 0
    fake.stdout = ""
    fake.stderr = ""
    fake.args = []
    with patch("subprocess.run", return_value=fake) as mock_run:
        run_pip_install("/usr/bin/python3", "/tmp/c.txt", [], ["my-plugin==1.0.0"], dry_run=True)
    args = mock_run.call_args[0][0]
    assert "--dry-run" in args


def test_run_pip_install_real_omits_dry_run_flag() -> None:
    fake = MagicMock()
    fake.returncode = 0
    fake.stdout = ""
    fake.stderr = ""
    fake.args = []
    with patch("subprocess.run", return_value=fake) as mock_run:
        run_pip_install("/usr/bin/python3", "/tmp/c.txt", [], ["my-plugin==1.0.0"], dry_run=False)
    args = mock_run.call_args[0][0]
    assert "--dry-run" not in args


def test_run_pip_install_uv_missing_returns_failed_command_result() -> None:
    with patch("subprocess.run", side_effect=FileNotFoundError("uv not found")):
        result = run_pip_install("/usr/bin/python3", "/tmp/c.txt", [], ["pkg==1.0.0"], dry_run=False)
    assert not result.ok
    assert "uv not found" in result.stderr


def test_run_pip_install_failure_returns_command_result_with_context() -> None:
    fake = MagicMock()
    fake.returncode = 1
    fake.stdout = "resolution info"
    fake.stderr = "conflicting dependency"
    fake.args = []
    with patch("subprocess.run", return_value=fake):
        result = run_pip_install("/usr/bin/python3", "/tmp/c.txt", [], ["pkg==1.0.0"], dry_run=True)
    assert not result.ok
    assert result.stderr == "conflicting dependency"


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
