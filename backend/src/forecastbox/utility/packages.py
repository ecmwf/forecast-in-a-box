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
from cascade.low.func import Either
from packaging.specifiers import SpecifierSet
from packaging.version import Version

from forecastbox.utility.time import from_timestamp, value_dt2str

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


def try_updatedatetime(pip_source: str) -> str:
    """Return the install datetime of a package as ``YYYY-MM-DDTHH:MM:SS``, or "unknown".

    Uses the ctime of the package's METADATA file as a proxy for the install time.
    """

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
        install_time = from_timestamp(path.stat().st_ctime)
        return value_dt2str(install_time)
    except Exception:  # too much could happen -- file not exist, no rights, malformed ts, etc
        return "unknown"


def _parse_pip_install(pip_output: str) -> dict[str, str]:
    """Parse ``uv pip install`` stdout to extract newly-installed packages and their versions.

    Lines starting with `` + `` are newly-installed entries, e.g.:
    ``  + fiab-plugin-test==0.1.0 (from file:///path/to/package)``

    Returns a dict mapping package name to version string.
    """
    rv: dict[str, str] = {}
    for line in pip_output.splitlines():
        clean = line.strip()
        if not clean.startswith("+"):
            continue
        parts = clean.lstrip("+ ").split("==")
        if len(parts) != 2:
            logger.warning(f"Suspicious pip output line: {clean!r} -- ignoring")
            continue
        name = parts[0].strip()
        version_raw = parts[1].split(" ", 1)[0].strip()
        try:
            Version(version_raw)
            rv[name] = version_raw
        except Exception as e:
            logger.warning(f"failed to parse version for {name!r}: {version_raw!r} -- {repr(e)}")
    return rv


def try_install(packages: list[str]) -> Either[dict[str, str], str]:  # type: ignore[type-arg]
    """Run ``uv pip install`` with the given pkg specs.

    Returns ``Either.ok(versions)`` on success, where ``versions`` maps newly-installed
    package names to their version strings, or ``Either.error(msg)`` on failure.
    Never raises.
    """
    install_command = ["uv", "pip", "install"] + packages
    logger.debug(f"will run {install_command}")
    try:
        result = subprocess.run(install_command, check=False, capture_output=True, text=True)
    except FileNotFoundError as ex:
        msg = f"installing {packages} failure: {repr(ex)}"
        logger.error(msg)
        return Either.error(msg)
    if result.returncode != 0:
        msg = f"installing {packages} failure: {result.returncode}. Stderr: {result.stderr}, Stdout: {result.stdout}, Args: {result.args}"
        logger.error(msg)
        return Either.error(msg)
    logger.debug(f"install finished with {result.stdout=}, {result.stderr=}")
    return Either.ok(_parse_pip_install(result.stderr))


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
