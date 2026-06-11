# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Utility helpers for querying and managing installed Python packages.

These are low-level helpers used by the plugin manager and other components
that need to interact with the Python package environment at runtime.
"""

import datetime as dt
import importlib
import importlib.metadata
import logging
import pathlib
import subprocess
from types import ModuleType

from packaging.specifiers import SpecifierSet
from packaging.version import Version

logger = logging.getLogger(__name__)


def get_fiabcore_version() -> Version:
    """Return the currently installed version of ``fiab-core`` as a ``Version`` object."""
    raw = importlib.metadata.version("fiab-core")
    return Version(raw)


def try_import(module_name: str) -> ModuleType | None:
    """Attempt to import a module by name; return ``None`` on ``ModuleNotFoundError``."""
    try:
        return importlib.import_module(module_name)
    except ModuleNotFoundError:
        return None


def try_version(pip_source: str, module_name: str) -> str:
    """Return the installed version of a package, falling back to a module attribute or "unknown"."""
    try:
        return importlib.metadata.version(pip_source)
    except importlib.metadata.PackageNotFoundError:
        module = try_import(module_name)
        if module is not None:
            if hasattr(module, "_version"):
                version = module._version
                if isinstance(version, str):
                    return version
        return "unknown"


def try_updatedate(pip_source: str) -> str:
    """Return the install date of a package as ``YYYY/MM/DD``, or "unknown"."""
    try:
        dist = importlib.metadata.distribution(pip_source)
    except importlib.metadata.PackageNotFoundError:
        return "unknown"
    if dist.files is None:
        return "unknown"
    try:
        mtdf = next(f for f in dist.files if f.name == "METADATA")
    except StopIteration:
        return "unknown"
    try:
        path = pathlib.Path(mtdf.locate())
        install_time = dt.datetime.fromtimestamp(path.stat().st_ctime)
        return install_time.strftime("%Y/%m/%d")
    except Exception:  # too much could happen -- file not exist, no rights, malformed ts, etc
        return "unknown"


def try_install(pip_source: str, specifier_set: SpecifierSet | None = None) -> None:
    """Run ``uv pip install --upgrade`` for the given ``pip_source``.

    The currently installed ``fiab-core`` version is pinned in the install
    command to prevent accidental core upgrades or downgrades.
    # TODO -- include the whole pylock.toml

    If ``specifier_set`` is provided and ``pip_source`` is not an editable
    install, the specifier is appended to the package argument to constrain
    which version is installed (e.g. ``"my-plugin>=1,<2"``).
    Editable installs (``-e ...``) are version-agnostic; the specifier is
    silently ignored for them.
    """
    fiabcore_pin = f"fiab-core=={get_fiabcore_version()}"
    is_editable = pip_source.startswith("-e")
    if is_editable:
        base_args = pip_source.split(" ", 1)
        package_arg = base_args  # specifier_set not applicable for editable installs
    else:
        package_spec = pip_source if specifier_set is None else f"{pip_source}{specifier_set}"
        package_arg = [package_spec]
    install_command = ["uv", "pip", "install", "--upgrade"] + package_arg + [fiabcore_pin]
    try:
        result = subprocess.run(install_command, check=False, capture_output=True)
    except FileNotFoundError as ex:
        logger.error(f"installing {pip_source} failure: {repr(ex)}")
        return
    if result.returncode != 0:
        msg = f"installing {pip_source} failure: {result.returncode}. Stderr: {result.stderr}, Stdout: {result.stdout}, Args: {result.args}"
        logger.error(msg)
