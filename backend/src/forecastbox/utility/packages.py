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
from collections.abc import Iterator
from types import ModuleType

import httpx
import orjson
from packaging.specifiers import SpecifierSet
from packaging.version import Version

logger = logging.getLogger(__name__)


def get_package_versions(pip_source: str) -> Iterator[str]:
    """Return all versions of *pip_source* available on PyPI.

    Fetches ``https://pypi.org/pypi/{pip_source}/json`` and yields every key
    from the ``releases`` mapping.  PyPI does not paginate this endpoint, but
    if a ``next`` link is ever introduced the loop below handles it.
    """
    url: str | None = f"https://pypi.org/pypi/{pip_source}/json"
    with httpx.Client() as client:
        while url is not None:
            try:
                response = client.get(url)
            except Exception:
                logger.exception(f"Failed to reach PyPI for {pip_source!r}")
                return
            if response.status_code != 200:
                logger.warning(f"PyPI returned {response.status_code} for {pip_source!r}")
                return
            try:
                data = response.json()
            except Exception:
                logger.exception(f"Failed to parse PyPI JSON for {pip_source!r}")
                return
            yield from data.get("releases", {}).keys()
            # PyPI JSON API does not currently paginate; guard for the future.
            url = data.get("next", None)


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


def try_install(packages: list[str]) -> None:
    """Run ``uv pip install`` with the given pkg specs."""
    install_command = ["uv", "pip", "install"] + packages
    try:
        result = subprocess.run(install_command, check=False, capture_output=True)
    except FileNotFoundError as ex:
        logger.error(f"installing {packages} failure: {repr(ex)}")
        return
    if result.returncode != 0:
        msg = f"installing {packages} failure: {result.returncode}. Stderr: {result.stderr}, Stdout: {result.stdout}, Args: {result.args}"
        logger.error(msg)


def get_existing_install_pin(distname: str) -> list[str]:
    """If the distname's install is detected to be editable,
    we return `-e path`, otherwise we return `distname==currentVersion`.
    """
    # NOTE: This block is for 3.14+
    distribution = importlib.metadata.distribution(distname)
    if hasattr(distribution, "origin"):
        origin = distribution.origin
        if hasattr(origin, "url") and isinstance(origin.url, str) and origin.url.startswith("file://"):
            # NOTE this doesnt work well for non-std layout but again we can restrict to only that
            return ["-e", origin.url[len("file://") :]]

    # NOTE: pre 3.14, eventually remove
    direct_url_text = distribution.read_text("direct_url.json")
    if direct_url_text:
        info = orjson.loads(direct_url_text)
        if info.get("dir_info", {}).get("editable"):
            url = info.get("url", "")
            if url.startswith("file://"):
                return ["-e", url[len("file://") :]]

    version = importlib.metadata.version(distname)
    return [f"{distname}=={version}"]
