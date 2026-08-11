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

This module supports safe venv mutation algorithms, by handling the generic
aspects: freeze an environment, parse the freeze output into structured
entries, exclude one distribution by name, render the remainder as pip
constraints/requirements, and run ``uv pip install``/``uv pip check``
with an explicit interpreter.
"""

import contextlib
import datetime as dt
import importlib
import importlib.metadata
import logging
import os
import pathlib
import subprocess
import tempfile
from collections.abc import Iterable, Iterator, Sequence
from dataclasses import dataclass
from types import ModuleType
from typing import Literal

import httpx
import orjson
from packaging.requirements import InvalidRequirement, Requirement
from packaging.utils import canonicalize_name
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
        version_module = try_import(module_name + "._version")
        if version_module is not None:
            if hasattr(version_module, "version"):
                version = version_module.version
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


def parse_install_output(pip_output: str) -> dict[str, str]:
    """Parse ``uv pip install`` output to extract newly-installed packages and their versions.
    Does not verify whether the install *actually* happened -- hence don't use for pip
    invocations that were dry-runned.

    Lines starting with `` + `` are newly-installed entries, e.g.:
    ``  + fiab-plugin-test==0.1.0 (from file:///path/to/package)``
    We also include lines starting with `` ~ ``, which may have been cached from `uv`'s PoV
    but for us are at this stage nevertheless new (presumably).

    Returns a dict mapping package name to version string.
    """
    rv: dict[str, str] = {}
    for line in pip_output.splitlines():
        clean = line.strip()
        if not (clean.startswith("+") or clean.startswith("~")):
            continue
        parts = clean.lstrip("+ ").lstrip("~ ").split("==")
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


class PackagesError(Exception):
    """Raised when the installed environment cannot be safely frozen/parsed."""


@dataclass(frozen=True, eq=True, slots=True)
class CommandResult:
    """Result of running a subprocess-backed ``uv`` command. Never raises; a missing
    ``uv`` binary or other launch failure is represented as ``returncode == -1`` with
    the exception text in ``stderr``."""

    returncode: int
    stdout: str
    stderr: str
    args: tuple[str, ...]

    @property
    def ok(self) -> bool:
        return self.returncode == 0


def _run_command(cmd: Sequence[str]) -> CommandResult:
    logger.debug(f"running {list(cmd)}")
    try:
        result = subprocess.run(list(cmd), check=False, capture_output=True, text=True)
    except FileNotFoundError as ex:
        msg = repr(ex)
        logger.error(f"failed to launch {list(cmd)}: {msg}")
        return CommandResult(returncode=-1, stdout="", stderr=msg, args=tuple(cmd))
    logger.debug(f"finished {list(cmd)} with returncode={result.returncode}")
    return CommandResult(returncode=result.returncode, stdout=result.stdout, stderr=result.stderr, args=tuple(result.args))


@dataclass(frozen=True, eq=True, slots=True)
class FrozenDistribution:
    """One entry from ``uv pip freeze`` output, classified and associated with a
    canonicalized distribution name.

    * ``kind == "pin"``: an ordinary ``name==version`` entry (markers preserved). ``constraint``
      holds the exact line to write to a constraints file; ``requirement_args`` is empty.
    * ``kind in ("editable", "local")``: an editable (``-e``/``--editable``) or direct/local source
      (``file://...``, PEP 508 ``name @ file://...``). ``constraint`` is ``None`` (these cannot be
      expressed as constraints); ``requirement_args`` holds the CLI tokens needed to reproduce the
      requirement (e.g. ``("-e", "/path")`` or ``("name @ file:///path",)``).
    """

    name: str
    raw_line: str
    kind: Literal["pin", "editable", "local"]
    constraint: str | None
    requirement_args: tuple[str, ...]


@dataclass(frozen=True, eq=True, slots=True)
class EnvironmentSnapshot:
    """A parsed, classified ``uv pip freeze`` snapshot of an environment."""

    distributions: tuple[FrozenDistribution, ...]


def freeze_environment(python: str) -> list[str]:
    """Run ``uv pip freeze --python <python>`` and return its stdout as a list of lines.

    Raises ``PackagesError`` if the command fails.
    """
    result = _run_command(["uv", "pip", "freeze", "--python", python])
    if not result.ok:
        raise PackagesError(f"failed to freeze environment for {python!r}: {result.stderr or result.stdout}")
    return result.stdout.splitlines()


def _build_source_distribution_map() -> dict[str, str]:
    """Map a normalized local filesystem path (as found in ``file://`` origins/direct_url.json)
    to the canonicalized distribution name installed from that path. Used to identify the
    distribution behind an editable/local ``uv pip freeze`` entry that does not carry an explicit
    name (plain ``-e <path>`` lines).
    """
    mapping: dict[str, str] = {}
    for distribution in importlib.metadata.distributions():
        name = distribution.metadata["Name"] if distribution.metadata else None
        if not name:
            continue
        url: str | None = None
        origin = getattr(distribution, "origin", None)
        if origin is not None and isinstance(getattr(origin, "url", None), str):
            url = origin.url
        else:
            try:
                direct_url_text = distribution.read_text("direct_url.json")
            except Exception:
                direct_url_text = None
            if direct_url_text:
                try:
                    info = orjson.loads(direct_url_text)
                    url = info.get("url")
                except Exception:
                    url = None
        if url and url.startswith("file://"):
            path = url[len("file://") :].rstrip("/")
            mapping[path] = canonicalize_name(name)
    return mapping


def _classify_editable_or_local(line: str, source_map: dict[str, str]) -> FrozenDistribution:
    for prefix in ("-e ", "--editable "):
        if line.startswith(prefix):
            token = prefix.strip()
            raw = line[len(prefix) :].strip()
            fragment_free, _, egg = raw.partition("#egg=")
            reproduction_path = fragment_free[len("file://") :] if fragment_free.startswith("file://") else fragment_free
            if egg:
                name: str | None = canonicalize_name(egg)
            else:
                name = source_map.get(reproduction_path.rstrip("/"))
            if name is None:
                raise PackagesError(f"cannot determine distribution name for editable requirement: {line!r}")
            return FrozenDistribution(
                name=name, raw_line=line, kind="editable", constraint=None, requirement_args=(token, reproduction_path)
            )
    if " @ " in line:
        name_part, _, _rest = line.partition(" @ ")
        name = canonicalize_name(name_part.strip())
        return FrozenDistribution(name=name, raw_line=line, kind="local", constraint=None, requirement_args=(line,))
    raise PackagesError(f"cannot classify frozen local/editable requirement: {line!r}")


def parse_frozen_environment(lines: Iterable[str]) -> EnvironmentSnapshot:
    """Classify raw ``uv pip freeze`` lines into ordinary pins and editable/local sources.

    Raises ``PackagesError`` if an editable/local entry cannot be associated with a distribution
    name -- we fail closed rather than silently drop or silently keep an unidentified source (see
    ``forecastbox.domain.plugin.compatibility`` for the rationale).
    """
    source_map: dict[str, str] | None = None
    distributions: list[FrozenDistribution] = []
    for raw_line in lines:
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("-e ") or line.startswith("--editable ") or line.startswith("file://") or " @ " in line:
            if source_map is None:
                source_map = _build_source_distribution_map()
            distributions.append(_classify_editable_or_local(line, source_map))
            continue
        try:
            req = Requirement(line)
        except InvalidRequirement as ex:
            raise PackagesError(f"cannot parse frozen requirement: {line!r}: {ex}") from ex
        if req.url:
            distributions.append(
                FrozenDistribution(name=canonicalize_name(req.name), raw_line=line, kind="local", constraint=None, requirement_args=(line,))
            )
            continue
        distributions.append(
            FrozenDistribution(name=canonicalize_name(req.name), raw_line=line, kind="pin", constraint=line, requirement_args=())
        )
    return EnvironmentSnapshot(distributions=tuple(distributions))


def exclude_distribution(snapshot: EnvironmentSnapshot, name: str) -> EnvironmentSnapshot:
    """Return a copy of *snapshot* with the distribution named *name* (compared canonically) removed,
    so it is free to change during the requested plugin install."""
    target = canonicalize_name(name)
    return EnvironmentSnapshot(distributions=tuple(d for d in snapshot.distributions if d.name != target))


def render_constraints(snapshot: EnvironmentSnapshot) -> str:
    """Render the ordinary (``kind == "pin"``) entries of *snapshot* as ``uv``/``pip`` constraints
    file content: one exact requirement per line (markers preserved), with a trailing newline. An
    environment with no ordinary pins renders to an empty string, which is a valid constraints file.
    """
    lines = [d.constraint for d in snapshot.distributions if d.kind == "pin" and d.constraint is not None]
    if not lines:
        return ""
    return "\n".join(lines) + "\n"


def extract_editable_local_requirements(snapshot: EnvironmentSnapshot) -> list[str]:
    """Flatten the editable/local entries of *snapshot* into CLI requirement tokens, in the order
    encountered, suitable for appending to a ``uv pip install``/``--dry-run`` command."""
    args: list[str] = []
    for d in snapshot.distributions:
        if d.kind in ("editable", "local"):
            args.extend(d.requirement_args)
    return args


@contextlib.contextmanager
def temporary_constraints_file(text: str) -> Iterator[str]:
    """Write *text* to a securely-created temporary file and yield its path, removing it on exit
    (success or failure) regardless of how the ``with`` block terminates."""
    fd, path = tempfile.mkstemp(prefix="fiab-plugin-constraints-", suffix=".txt")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
        logger.debug(f"wrote constraints file {path} ({len(text.splitlines())} entries)")
        yield path
    finally:
        try:
            os.remove(path)
        except FileNotFoundError:
            pass


def build_install_command(
    python: str,
    constraints_path: str,
    extra_requirement_args: Sequence[str],
    plugin_requirement_args: Sequence[str],
    dry_run: bool,
) -> list[str]:
    """Build the ``uv pip install`` argument array shared by preflight and real installation. This
    is the single command-builder both call, so they cannot accidentally drift in options/sources."""
    cmd = ["uv", "pip", "install", "--python", python, "--constraints", constraints_path]
    if dry_run:
        cmd.append("--dry-run")
    cmd.extend(extra_requirement_args)
    cmd.extend(plugin_requirement_args)
    return cmd


def run_pip_install(
    python: str,
    constraints_path: str,
    extra_requirement_args: Sequence[str],
    plugin_requirement_args: Sequence[str],
    dry_run: bool,
) -> CommandResult:
    """Run ``uv pip install`` (dry-run or real) with an explicit interpreter and constraints file.
    Never raises."""
    cmd = build_install_command(python, constraints_path, extra_requirement_args, plugin_requirement_args, dry_run)
    return _run_command(cmd)


def run_pip_check(python: str) -> CommandResult:
    """Run ``uv pip check --python <python>``. Never raises. Callers decide what a failure means
    (baseline vs. post-install); this utility does not embed plugin policy."""
    return _run_command(["uv", "pip", "check", "--python", python])
