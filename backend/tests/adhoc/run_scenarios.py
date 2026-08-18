#!/usr/bin/env python3
# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Adhoc integration coverage for ``forecastbox.domain.plugin.compatibility.install_plugin_compatibly``.

This is deliberately *not* part of ``backend/tests/unit`` or ``backend/tests/integration``: it spins up
a scratch ``uv``-managed virtual environment and builds a handful of tiny local ``fiab-adhoctest-*``
wheels to exercise the plugin-install hardening against a real ``uv`` binary, without depending on
PyPI or on the developer's own (potentially already-installed, potentially shared across worktrees)
virtual environment.

Run with (from this directory, or anywhere -- ``uv`` discovers the backend project upwards)::

    uv run python run_scenarios.py

or via the adjacent ``justfile``::

    just val

Design notes
------------
* This script itself is meant to be launched with ``uv run ...`` so it reuses the backend's own
  default project venv (giving it ``forecastbox``, ``packaging``, etc. for free) -- but the plugin
  installs under test target a *separate, disposable* scratch venv created in a temp directory, not
  the default project venv. We do this on purpose: the default venv may be shared across multiple
  worktrees/sandboxes, and repeatedly installing/removing throwaway packages into it, or relying on
  its ``uv pip check`` baseline being clean, would be unreliable and could destabilize unrelated work.
  A scratch venv gives each run a clean, reproducible baseline, which is what the conflict/preservation
  scenarios below actually need to be meaningful.
* All packages built for this script are named ``fiab-adhoctest-<name>`` so they are unambiguously
  identifiable as test fixtures if any ever leaked into a persistent environment.
* No package here depends on anything from PyPI: every wheel is built locally (offline, via
  ``uv build`` against the bundled ``setuptools`` backend) into a local wheelhouse directory that is
  then used as a ``--find-links`` source (``UV_FIND_LINKS``) with ``UV_OFFLINE=1`` set for every ``uv``
  invocation, so no network access is attempted at all.
* ``fiab-adhoctest-plugin-alpha`` is installed via a local *path* spec (editable, ``-e <dir>``) to
  cover the "editable/local plugin" scenarios; the other plugins are installed via plain
  ``name==version`` requirements resolved against the local ``--find-links`` wheelhouse, covering the
  "as if it was a registry" path.
* Scenarios call the real, unmodified ``install_plugin_compatibly`` (only ``sys.executable`` is
  temporarily pointed at the scratch venv's interpreter for the duration of each call, since that is
  the only way the function selects which environment to operate on).

See docs/developer/changeSpecs/plugins-integration_tests.md for the scenario list this implements.
"""

from __future__ import annotations

import contextlib
import glob
import os
import shutil
import subprocess
import sys
import tempfile
import traceback
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path

from packaging.version import Version

from forecastbox.domain.plugin.compatibility import install_plugin_compatibly
from forecastbox.utility.packages import freeze_environment, run_pip_check

HERE = Path(__file__).resolve().parent
PACKAGES_DIR = HERE / "packages"
FIAB_CORE_DIR = HERE.parents[1] / "packages" / "fiab-core"

SOURCES = {
    "pseudonumpy_v1": PACKAGES_DIR / "pseudonumpy_v1",
    "pseudonumpy_v2": PACKAGES_DIR / "pseudonumpy_v2",
    "widget": PACKAGES_DIR / "widget",
    "plugin_alpha_v1": PACKAGES_DIR / "plugin_alpha_v1",
    "plugin_alpha_v2": PACKAGES_DIR / "plugin_alpha_v2",
    "plugin_beta": PACKAGES_DIR / "plugin_beta",
    "plugin_gamma": PACKAGES_DIR / "plugin_gamma",
    "plugin_delta_v1": PACKAGES_DIR / "plugin_delta_v1",
    "plugin_delta_v2": PACKAGES_DIR / "plugin_delta_v2",
}

# built into the wheelhouse (used via --find-links, "as if it was a registry"); plugin_alpha is
# deliberately excluded here -- v1 is installed via editable path spec, v2 via a direct wheel file
# reference, neither goes through the find-links/registry-like path.
BUILT_INTO_WHEELHOUSE = [
    "pseudonumpy_v1",
    "pseudonumpy_v2",
    "widget",
    "plugin_beta",
    "plugin_gamma",
    "plugin_delta_v1",
    "plugin_delta_v2",
    "plugin_alpha_v2",  # still built, just installed via a direct file:// wheel reference, not by name
]


class ScenarioError(AssertionError):
    pass


@dataclass
class Scratch:
    workdir: Path
    venv_python: Path
    wheelhouse: Path
    env: dict[str, str]


def sh(cmd: list[str], env: dict[str, str], cwd: Path | None = None) -> subprocess.CompletedProcess:
    print(f"$ {' '.join(cmd)}" + (f"  (cwd={cwd})" if cwd else ""))
    result = subprocess.run(cmd, env=env, cwd=cwd, capture_output=True, text=True)
    if result.stdout:
        print(result.stdout)
    if result.stderr:
        print(result.stderr, file=sys.stderr)
    return result


def build_scratch_environment() -> Scratch:
    workdir = Path(tempfile.mkdtemp(prefix="fiab-adhoc-"))
    venv_dir = workdir / "venv"
    wheelhouse = workdir / "wheelhouse"
    wheelhouse.mkdir(parents=True, exist_ok=True)

    env = dict(os.environ)
    env["UV_OFFLINE"] = "1"
    env["UV_FIND_LINKS"] = str(wheelhouse)
    env["UV_LINK_MODE"] = "copy"

    pyver = f"{sys.version_info.major}.{sys.version_info.minor}"
    result = sh(["uv", "venv", str(venv_dir), "--python", pyver], env=env)
    if result.returncode != 0:
        raise ScenarioError(f"failed to create scratch venv: {result.stderr}")
    venv_python = venv_dir / "bin" / "python3"
    if not venv_python.exists():
        raise ScenarioError(f"scratch venv python not found at {venv_python}")

    result = sh(["uv", "build", "--out-dir", str(wheelhouse), str(FIAB_CORE_DIR)], env=env)
    if result.returncode != 0:
        raise ScenarioError(f"failed to build fiab-core wheel: {result.stderr}")

    for key in BUILT_INTO_WHEELHOUSE:
        result = sh(["uv", "build", "--out-dir", str(wheelhouse), str(SOURCES[key])], env=env)
        if result.returncode != 0:
            raise ScenarioError(f"failed to build {key}: {result.stderr}")

    return Scratch(workdir=workdir, venv_python=venv_python, wheelhouse=wheelhouse, env=env)


def seed_baseline(scratch: Scratch) -> None:
    """Install the "already there before this test run" state directly via ``uv pip install``
    (bypassing ``install_plugin_compatibly`` on purpose -- this is Arrange, not Act)."""
    result = sh(
        [
            "uv",
            "pip",
            "install",
            "--python",
            str(scratch.venv_python),
            "fiab-core",
            "fiab-adhoctest-pseudonumpy==1.0.0",
            "fiab-adhoctest-plugin-delta==1.0.0",
            "-e",
            str(SOURCES["plugin_alpha_v1"]),
        ],
        env=scratch.env,
    )
    if result.returncode != 0:
        raise ScenarioError(f"failed to seed baseline environment: {result.stderr}")

    baseline_check = run_pip_check(str(scratch.venv_python))
    if not baseline_check.ok:
        raise ScenarioError(f"scratch environment is inconsistent right after seeding, this is a test-setup bug: {baseline_check.stderr}")


@contextlib.contextmanager
def targeting(scratch: Scratch) -> Iterator[None]:
    """Temporarily point ``sys.executable`` at the scratch venv's interpreter, since
    ``install_plugin_compatibly`` always operates on ``sys.executable`` (by design -- see its
    module docstring); and temporarily apply the scratch environment's ``uv`` env vars
    (``UV_OFFLINE``, ``UV_FIND_LINKS``, ``UV_LINK_MODE``) to this process's environment, since
    ``install_plugin_compatibly``'s subprocesses inherit ``os.environ`` and have no way to accept
    an explicit environment override. Safe here because this script runs scenarios strictly
    sequentially, single-threaded."""
    original_executable = sys.executable
    original_environ = {k: os.environ.get(k) for k in scratch.env if os.environ.get(k) != scratch.env[k]}
    sys.executable = str(scratch.venv_python)
    for k, v in scratch.env.items():
        if os.environ.get(k) != v:
            os.environ[k] = v
    try:
        yield
    finally:
        sys.executable = original_executable
        for k, v in original_environ.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


def freeze(scratch: Scratch) -> list[str]:
    return freeze_environment(str(scratch.venv_python))


def line_for(scratch: Scratch, freeze_lines: list[str], distribution_name: str) -> str | None:
    """Return the frozen line whose canonical distribution matches *distribution_name*, or ``None``."""
    from packaging.utils import canonicalize_name

    from forecastbox.utility.packages import parse_frozen_environment

    snapshot = parse_frozen_environment(freeze_lines, str(scratch.venv_python))
    for d in snapshot.distributions:
        if d.name == canonicalize_name(distribution_name):
            return d.raw_line
    return None


# ---------------------------------------------------------------------------
# Scenarios (see docs/developer/changeSpecs/plugins-integration_tests.md)
# ---------------------------------------------------------------------------


def scenario_new_dependency_installs_without_touching_others(scratch: Scratch) -> None:
    """1. A plugin with a new dependency installs successfully without changing existing packages."""
    with targeting(scratch):
        result = install_plugin_compatibly("fiab-adhoctest-plugin-beta", Version("1.0.0"), "fiab_adhoctest_plugin_beta")
    if result.e is not None:
        raise ScenarioError(f"expected success, got error: {result.e}")

    lines = freeze(scratch)
    if line_for(scratch, lines, "fiab-adhoctest-widget") != "fiab-adhoctest-widget==1.0.0":
        raise ScenarioError(f"expected the new dependency to be installed at 1.0.0, freeze was: {lines}")
    if line_for(scratch, lines, "fiab-adhoctest-pseudonumpy") != "fiab-adhoctest-pseudonumpy==1.0.0":
        raise ScenarioError(f"protected pseudonumpy changed unexpectedly: {lines}")
    alpha_line = line_for(scratch, lines, "fiab-adhoctest-plugin-alpha")
    if alpha_line is None or not alpha_line.startswith("-e"):
        raise ScenarioError(f"protected editable plugin-alpha was not preserved as editable: {alpha_line!r}")
    if line_for(scratch, lines, "fiab-adhoctest-plugin-delta") != "fiab-adhoctest-plugin-delta==1.0.0":
        raise ScenarioError(f"unrelated plugin-delta changed unexpectedly: {lines}")


def scenario_conflicting_version_fails_dry_run(scratch: Scratch) -> None:
    """2. A plugin requiring a different version of an existing package fails during dry-run and
    leaves that package unchanged."""
    with targeting(scratch):
        result = install_plugin_compatibly("fiab-adhoctest-plugin-gamma", Version("1.0.0"), "fiab_adhoctest_plugin_gamma")
    if result.e is None:
        raise ScenarioError("expected the conflicting install to fail, but it succeeded")
    if "dry-run" not in result.e:
        raise ScenarioError(f"expected a dry-run stage failure, got: {result.e}")

    lines = freeze(scratch)
    if line_for(scratch, lines, "fiab-adhoctest-pseudonumpy") != "fiab-adhoctest-pseudonumpy==1.0.0":
        raise ScenarioError(f"protected pseudonumpy was changed by a failed dry-run: {lines}")
    if line_for(scratch, lines, "fiab-adhoctest-plugin-gamma") is not None:
        raise ScenarioError(f"plugin-gamma should not have been installed at all: {lines}")


def scenario_update_selected_plugin_while_others_stay_pinned(scratch: Scratch) -> None:
    """3. Updating the selected plugin is allowed while another installed plugin remains pinned."""
    with targeting(scratch):
        result = install_plugin_compatibly("fiab-adhoctest-plugin-delta", Version("1.1.0"), "fiab_adhoctest_plugin_delta")
    if result.e is not None:
        raise ScenarioError(f"expected the update to succeed, got error: {result.e}")

    lines = freeze(scratch)
    if line_for(scratch, lines, "fiab-adhoctest-plugin-delta") != "fiab-adhoctest-plugin-delta==1.1.0":
        raise ScenarioError(f"selected plugin-delta was not updated: {lines}")
    if line_for(scratch, lines, "fiab-adhoctest-widget") != "fiab-adhoctest-widget==1.0.0":
        raise ScenarioError(f"unrelated widget (from an earlier scenario) changed unexpectedly: {lines}")
    alpha_line = line_for(scratch, lines, "fiab-adhoctest-plugin-alpha")
    if alpha_line is None or not alpha_line.startswith("-e"):
        raise ScenarioError(f"protected editable plugin-alpha was not preserved as editable: {alpha_line!r}")


def scenario_editable_local_protected_package_preserved(scratch: Scratch) -> None:
    """4. An editable/local protected package is preserved and is not replaced from an index."""
    lines = freeze(scratch)
    alpha_line = line_for(scratch, lines, "fiab-adhoctest-plugin-alpha")
    if alpha_line is None:
        raise ScenarioError("plugin-alpha disappeared from the environment")
    if not alpha_line.startswith("-e "):
        raise ScenarioError(f"plugin-alpha should still be an editable install, got: {alpha_line!r}")
    if str(SOURCES["plugin_alpha_v1"]) not in alpha_line:
        raise ScenarioError(f"plugin-alpha's editable source path changed unexpectedly: {alpha_line!r}")


def scenario_editable_local_selected_plugin_can_be_updated(scratch: Scratch) -> None:
    """5. An editable/local selected plugin can be updated."""
    candidates = glob.glob(str(scratch.wheelhouse / "fiab_adhoctest_plugin_alpha-2.0.0*.whl"))
    if not candidates:
        raise ScenarioError("plugin-alpha v2 wheel was not built into the wheelhouse")
    wheel_path = candidates[0]

    with targeting(scratch):
        result = install_plugin_compatibly(f"file://{wheel_path}", None, "fiab_adhoctest_plugin_alpha")
    if result.e is not None:
        raise ScenarioError(f"expected the local/editable plugin update to succeed, got error: {result.e}")

    lines = freeze(scratch)
    alpha_line = line_for(scratch, lines, "fiab-adhoctest-plugin-alpha")
    expected = f"fiab-adhoctest-plugin-alpha @ file://{wheel_path}"
    if alpha_line != expected:
        raise ScenarioError(f"plugin-alpha was not updated to the new direct wheel source: got {alpha_line!r}, expected {expected!r}")
    if alpha_line.startswith("-e"):
        raise ScenarioError(f"plugin-alpha should no longer be an editable install: {alpha_line!r}")


def scenario_successful_install_passes_check_and_is_importable(scratch: Scratch) -> None:
    """6. A successful real installation passes ``uv pip check`` and can be imported after cache
    invalidation."""
    post_check = run_pip_check(str(scratch.venv_python))
    if not post_check.ok:
        raise ScenarioError(f"uv pip check failed after a successful install: {post_check.stderr}")

    proc = subprocess.run(
        [
            str(scratch.venv_python),
            "-c",
            "import importlib; importlib.invalidate_caches(); import fiab_adhoctest_plugin_alpha as m; print(m.__version__)",
        ],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise ScenarioError(f"newly-installed plugin could not be imported after cache invalidation: {proc.stderr}")
    if proc.stdout.strip() != "2.0.0":
        raise ScenarioError(f"imported plugin reported unexpected version: {proc.stdout!r}")


SCENARIOS: list[Callable[[Scratch], None]] = [
    scenario_new_dependency_installs_without_touching_others,
    scenario_conflicting_version_fails_dry_run,
    scenario_update_selected_plugin_while_others_stay_pinned,
    scenario_editable_local_protected_package_preserved,
    scenario_editable_local_selected_plugin_can_be_updated,
    scenario_successful_install_passes_check_and_is_importable,
]


def main() -> int:
    scratch = build_scratch_environment()
    print(f"scratch environment ready at {scratch.workdir}")
    outcomes: list[tuple[str, bool, str]] = []
    try:
        seed_baseline(scratch)
        for scenario in SCENARIOS:
            name = scenario.__name__
            try:
                scenario(scratch)
                outcomes.append((name, True, ""))
            except Exception as e:  # noqa: BLE001 -- adhoc harness, we want to keep going and report all
                detail = f"{e}\n{traceback.format_exc()}"
                outcomes.append((name, False, detail))
    finally:
        shutil.rmtree(scratch.workdir, ignore_errors=True)

    print("\n=== adhoc plugin-install scenario results ===")
    failed = 0
    for name, ok, detail in outcomes:
        print(f"{'PASS' if ok else 'FAIL'}  {name}")
        if not ok:
            failed += 1
            print(detail)
    print(f"\n{len(outcomes) - failed}/{len(outcomes)} scenarios passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
