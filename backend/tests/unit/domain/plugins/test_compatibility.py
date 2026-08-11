# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for domain.plugin.compatibility."""

from unittest.mock import patch

import pytest
from packaging.specifiers import SpecifierSet
from packaging.version import Version

from forecastbox.domain.plugin.compatibility import (
    get_compatible_versions,
    install_plugin_compatibly,
    plugin_default_specifier,
)
from forecastbox.utility.config import PluginSettings
from forecastbox.utility.packages import CommandResult, PackagesError

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_PLUGIN = PluginSettings(pip_source="my-plugin", module_name="my_plugin")


def _ok(stdout: str = "", stderr: str = "") -> CommandResult:
    return CommandResult(returncode=0, stdout=stdout, stderr=stderr, args=())


def _fail(stdout: str = "", stderr: str = "boom") -> CommandResult:
    return CommandResult(returncode=1, stdout=stdout, stderr=stderr, args=())


# ---------------------------------------------------------------------------
# plugin_default_specifier
# ---------------------------------------------------------------------------


def test_install_specifier_none_uses_fiabcore_major() -> None:
    with patch("forecastbox.domain.plugin.compatibility.get_fiabcore_version", return_value=Version("1.5.3")):
        spec = plugin_default_specifier()
    assert Version("1.0.0") in spec
    assert Version("1.99.0") in spec
    assert Version("2.0.0") not in spec
    assert Version("0.9.9") not in spec


def test_install_specifier_none_major_zero() -> None:
    with patch("forecastbox.domain.plugin.compatibility.get_fiabcore_version", return_value=Version("0.3.1")):
        spec = plugin_default_specifier()
    assert Version("0.0.0") in spec
    assert Version("0.9.9") in spec
    assert Version("1.0.0") not in spec


def test_plugin_default_specifier_returns_specifier_set() -> None:
    with patch("forecastbox.domain.plugin.compatibility.get_fiabcore_version", return_value=Version("3.0.0")):
        spec = plugin_default_specifier()
    assert isinstance(spec, SpecifierSet)


def test_install_specifier_consistent_with_major() -> None:
    """Minor/patch of fiab-core version must not affect the range."""
    with patch("forecastbox.domain.plugin.compatibility.get_fiabcore_version", return_value=Version("2.0.0")):
        spec_a = plugin_default_specifier()
    with patch("forecastbox.domain.plugin.compatibility.get_fiabcore_version", return_value=Version("2.7.3")):
        spec_b = plugin_default_specifier()
    assert str(spec_a) == str(spec_b)


# ---------------------------------------------------------------------------
# install_plugin_compatibly orchestration
# ---------------------------------------------------------------------------


def _patch_all(
    monkeypatch: pytest.MonkeyPatch,
    *,
    baseline: CommandResult | None = None,
    freeze_lines: list[str] | None = None,
    dry_run: CommandResult | None = None,
    real_install: CommandResult | None = None,
    post_check: CommandResult | None = None,
) -> list[tuple]:
    baseline = baseline if baseline is not None else _ok()
    dry_run_result = dry_run if dry_run is not None else _ok()
    real_install = real_install if real_install is not None else _ok(stderr="  + my-plugin==2.5.0\n")
    post_check = post_check if post_check is not None else _ok()
    freeze_lines = freeze_lines if freeze_lines is not None else ["pydantic==2.12.0", "other-pkg==1.0.0"]

    checks = iter([baseline, post_check])
    monkeypatch.setattr("forecastbox.domain.plugin.compatibility.run_pip_check", lambda python: next(checks))
    monkeypatch.setattr("forecastbox.domain.plugin.compatibility.freeze_environment", lambda python: freeze_lines)

    install_calls: list[tuple] = []

    def fake_run_pip_install(
        python: str, constraints_path: str, extra_args: list[str], plugin_args: list[str], dry_run: bool
    ) -> CommandResult:
        with open(constraints_path, encoding="utf-8") as f:
            constraints_text = f.read()
        install_calls.append((python, constraints_text, list(extra_args), list(plugin_args), dry_run, constraints_path))
        return dry_run_result if dry_run else real_install

    monkeypatch.setattr("forecastbox.domain.plugin.compatibility.run_pip_install", fake_run_pip_install)
    return install_calls


def test_default_plugin_major_version_requirement_is_used(monkeypatch: pytest.MonkeyPatch) -> None:
    install_calls = _patch_all(monkeypatch)
    with patch("forecastbox.domain.plugin.compatibility.get_fiabcore_version", return_value=Version("1.2.3")):
        result = install_plugin_compatibly("my-plugin", None, "my_plugin")
    assert result.e is None
    plugin_args = install_calls[0][3]
    assert plugin_args == ["my-plugin<2.0.0,>=1.0.0"]


def test_exact_requested_version_is_used(monkeypatch: pytest.MonkeyPatch) -> None:
    install_calls = _patch_all(monkeypatch)
    result = install_plugin_compatibly("my-plugin", Version("2.5.0"), "my_plugin")
    assert result.e is None
    plugin_args = install_calls[0][3]
    assert plugin_args == ["my-plugin==2.5.0"]


def test_target_excluded_from_frozen_snapshot(monkeypatch: pytest.MonkeyPatch) -> None:
    install_calls = _patch_all(monkeypatch, freeze_lines=["my-plugin==2.0.0", "other-pkg==1.0.0"])
    install_plugin_compatibly("my-plugin", Version("2.5.0"), "my_plugin")
    _python, constraints_text, extra_args, _plugin_args, dry, _path = install_calls[0]
    assert "my-plugin==2.0.0" not in constraints_text
    assert "other-pkg==1.0.0" in constraints_text


def test_every_other_ordinary_distribution_is_constrained(monkeypatch: pytest.MonkeyPatch) -> None:
    install_calls = _patch_all(monkeypatch, freeze_lines=["pkg-a==1.0.0", "pkg-b==2.0.0", "pkg-c==3.0.0"])
    install_plugin_compatibly("my-plugin", Version("2.5.0"), "my_plugin")
    _python, constraints_text, _extra_args, _plugin_args, _dry, _path = install_calls[0]
    assert "pkg-a==1.0.0" in constraints_text
    assert "pkg-b==2.0.0" in constraints_text
    assert "pkg-c==3.0.0" in constraints_text


def test_local_editable_protected_requirements_included(monkeypatch: pytest.MonkeyPatch) -> None:
    install_calls = _patch_all(
        monkeypatch,
        freeze_lines=["some-package @ file:///wheelhouse/some_package.whl", "pkg-b==2.0.0"],
    )
    install_plugin_compatibly("my-plugin", Version("2.5.0"), "my_plugin")
    _python, _constraints_text, extra_args, _plugin_args, _dry, _path = install_calls[0]
    assert "some-package @ file:///wheelhouse/some_package.whl" in extra_args


def test_local_editable_target_update_does_not_preserve_old_source(monkeypatch: pytest.MonkeyPatch) -> None:
    install_calls = _patch_all(
        monkeypatch,
        freeze_lines=["my-plugin @ file:///wheelhouse/my_plugin.whl", "pkg-b==2.0.0"],
    )
    install_plugin_compatibly("my-plugin", Version("2.5.0"), "my_plugin")
    _python, _constraints_text, extra_args, plugin_args, _dry, _path = install_calls[0]
    assert not any("my-plugin" in a for a in extra_args)
    assert plugin_args == ["my-plugin==2.5.0"]


def test_baseline_check_failure_stops_before_freeze(monkeypatch: pytest.MonkeyPatch) -> None:
    freeze_called = []
    monkeypatch.setattr("forecastbox.domain.plugin.compatibility.run_pip_check", lambda python: _fail(stderr="broken baseline"))
    monkeypatch.setattr("forecastbox.domain.plugin.compatibility.freeze_environment", lambda python: freeze_called.append(True) or [])
    result = install_plugin_compatibly("my-plugin", Version("2.5.0"), "my_plugin")
    assert result.e is not None
    assert "baseline-check" in result.e
    assert not freeze_called


def test_freeze_failure_stops_before_dry_run(monkeypatch: pytest.MonkeyPatch) -> None:
    dry_run_called = []
    monkeypatch.setattr("forecastbox.domain.plugin.compatibility.run_pip_check", lambda python: _ok())

    def fake_freeze(python: str) -> list[str]:
        raise PackagesError("cannot freeze")

    monkeypatch.setattr("forecastbox.domain.plugin.compatibility.freeze_environment", fake_freeze)
    monkeypatch.setattr(
        "forecastbox.domain.plugin.compatibility.run_pip_install",
        lambda *a, **k: dry_run_called.append(True) or _ok(),
    )
    result = install_plugin_compatibly("my-plugin", Version("2.5.0"), "my_plugin")
    assert result.e is not None
    assert "freeze" in result.e
    assert not dry_run_called


def test_dry_run_failure_stops_real_install(monkeypatch: pytest.MonkeyPatch) -> None:
    install_calls = _patch_all(monkeypatch, dry_run=_fail(stderr="conflicting dependency"))
    result = install_plugin_compatibly("my-plugin", Version("2.5.0"), "my_plugin")
    assert result.e is not None
    assert "dry-run" in result.e
    assert "conflicting dependency" in result.e
    assert len(install_calls) == 1  # only the dry run happened


def test_real_install_failure_is_reported(monkeypatch: pytest.MonkeyPatch) -> None:
    install_calls = _patch_all(monkeypatch, real_install=_fail(stderr="disk full"))
    result = install_plugin_compatibly("my-plugin", Version("2.5.0"), "my_plugin")
    assert result.e is not None
    assert "install" in result.e
    assert "disk full" in result.e
    assert len(install_calls) == 2


def test_post_check_failure_is_reported(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_all(monkeypatch, post_check=_fail(stderr="broken after install"))
    result = install_plugin_compatibly("my-plugin", Version("2.5.0"), "my_plugin")
    assert result.e is not None
    assert "post-check" in result.e
    assert "broken after install" in result.e


def test_successful_install_returns_installed_versions(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_all(monkeypatch, real_install=_ok(stderr="  + my-plugin==2.5.0\n"))
    result = install_plugin_compatibly("my-plugin", Version("2.5.0"), "my_plugin")
    assert result.e is None
    assert result.t == {"my-plugin": "2.5.0"}


def test_dry_run_output_never_reported_as_installed(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_all(
        monkeypatch,
        dry_run=_ok(stderr="  + my-plugin==9.9.9\n"),
        real_install=_ok(stderr="  + my-plugin==2.5.0\n"),
    )
    result = install_plugin_compatibly("my-plugin", Version("2.5.0"), "my_plugin")
    assert result.t == {"my-plugin": "2.5.0"}


def test_constraints_file_cleaned_up_on_success(monkeypatch: pytest.MonkeyPatch) -> None:
    install_calls = _patch_all(monkeypatch)
    install_plugin_compatibly("my-plugin", Version("2.5.0"), "my_plugin")
    constraints_path = install_calls[0][5]
    import pathlib

    assert not pathlib.Path(constraints_path).exists()


def test_constraints_file_cleaned_up_on_dry_run_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    install_calls = _patch_all(monkeypatch, dry_run=_fail())
    install_plugin_compatibly("my-plugin", Version("2.5.0"), "my_plugin")
    constraints_path = install_calls[0][5]
    import pathlib

    assert not pathlib.Path(constraints_path).exists()


def test_ambiguous_local_target_identity_raises_identify_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("forecastbox.domain.plugin.compatibility.run_pip_check", lambda python: _ok())
    monkeypatch.setattr(
        "forecastbox.domain.plugin.compatibility.query_module_distribution_map",
        lambda python: {"my_plugin": ["my-plugin-a", "my-plugin-b"]},
    )
    result = install_plugin_compatibly("-e /some/path", None, "my_plugin")
    assert result.e is not None
    assert "identify" in result.e


def test_get_compatible_versions_filters_by_major() -> None:
    versions = ["1.0.0", "1.1.0", "2.0.0", "0.9.0"]
    with patch("forecastbox.domain.plugin.compatibility.get_fiabcore_version", return_value=Version("1.0.0")):
        result = list(get_compatible_versions(_PLUGIN, iter(versions)))
    assert result == ["1.0.0", "1.1.0"]


def test_get_compatible_versions_empty_input() -> None:
    with patch("forecastbox.domain.plugin.compatibility.get_fiabcore_version", return_value=Version("1.0.0")):
        result = list(get_compatible_versions(_PLUGIN, iter([])))
    assert result == []


def test_get_compatible_versions_none_match() -> None:
    versions = ["2.0.0", "3.0.0"]
    with patch("forecastbox.domain.plugin.compatibility.get_fiabcore_version", return_value=Version("1.0.0")):
        result = list(get_compatible_versions(_PLUGIN, iter(versions)))
    assert result == []


def test_get_compatible_versions_skips_invalid_strings() -> None:
    versions = ["1.0.0", "not-a-version", "1.2.3", "bad"]
    with patch("forecastbox.domain.plugin.compatibility.get_fiabcore_version", return_value=Version("1.0.0")):
        result = list(get_compatible_versions(_PLUGIN, iter(versions)))
    assert result == ["1.0.0", "1.2.3"]


def test_get_compatible_versions_major_zero() -> None:
    versions = ["0.1.0", "0.2.0", "1.0.0"]
    with patch("forecastbox.domain.plugin.compatibility.get_fiabcore_version", return_value=Version("0.5.0")):
        result = list(get_compatible_versions(_PLUGIN, iter(versions)))
    assert result == ["0.1.0", "0.2.0"]


def test_get_compatible_versions_is_streaming() -> None:
    """Verify the function is a generator (lazy evaluation)."""
    versions = ["1.0.0", "1.1.0"]
    with patch("forecastbox.domain.plugin.compatibility.get_fiabcore_version", return_value=Version("1.0.0")):
        gen = get_compatible_versions(_PLUGIN, iter(versions))
    import inspect

    assert inspect.isgenerator(gen)
