# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Plugin compatibility helpers.

Centralises the version-compatibility rules between plugins and ``fiab-core``:

* A plugin version ``a.b.c`` is compatible with a ``fiab-core`` version ``x.y.z``
  if and only if ``a == x`` (same major version).

It also owns the runtime plugin installation policy: ``install_plugin_compatibly``
protects the *entire* installed environment while ``uv`` resolves a requested plugin.
This is an immediate risk-reduction measure on top of the current
shared-virtual-environment architecture (the backend still mutates its own
active venv and reloads Python modules in-process); see
``docs/developer/changeSpecs/plugins-candidate_venvs.md`` for a possible
architectural successor that replaces in-place mutation with validated candidate
environments and a handover.

Algorithm for ``install_plugin_compatibly``
--------------------------------------------
1. Build the requested plugin requirement from ``pip_source``/``version``/the installed
   ``fiab-core`` major (``plugin_default_specifier``).
2. Run ``uv pip check`` as a baseline -- refuse to install if the environment is already broken,
   so we don't attribute pre-existing breakage to this plugin.
3. Freeze the environment of the *running backend interpreter* (``sys.executable``, not whatever
   venv a shell happens to be in) with ``uv pip freeze`` and classify every entry into ordinary
   ``name==version`` pins and editable/local/URL sources.
4. Identify which frozen distribution (if any) is the plugin being installed/updated, by
   canonical distribution name, and exclude it from the snapshot so it is allowed to change.
5. Write the remaining ordinary pins to a temporary constraints file, and keep the remaining
   editable/local entries as explicit requirement arguments.
6. Run ``uv pip install --dry-run`` with the constraints file, the preserved editable/local
   requirements, and the requested plugin requirement.
7. Only if the dry run succeeds, run the identical command for real (differing only by the
   absence of ``--dry-run``).
8. Run ``uv pip check`` again as a post-install check.
9. Return the parsed installed-version mapping (from the real install's output only) for the
   plugin manager to persist and reload.

Known limitations (read before touching this module)
------------------------------------------------------
1. This policy is deliberately *stricter* than theoretical dependency compatibility: it freezes
   and preserves every other currently-installed distribution. A different install order, or
   resolving several plugins together in a fresh environment, could produce a valid combined
   state that an incremental, one-plugin-at-a-time install like this one rejects.
2. Plugin uninstall (see ``domain.plugin.manager.uninstall_plugin``) only removes the configured/
   loaded plugin entry; it does not uninstall the plugin's distribution or its dependencies.
   Packages a plugin introduced become part of later environment snapshots and are consequently
   protected by this same mechanism. We cannot reliably infer which packages are now unused,
   because dependencies may be shared with the backend or with other plugins.
3. In-process reload (performed by the plugin manager after a successful install) is incomplete.
   Reloading the plugin's top-level module does not reload already-imported plugin submodules or
   dependencies, does not replace previously-imported symbols, does not update existing class
   instances, and does not safely reinitialize extension modules or global registries. A restart
   remains the only reliable way for one interpreter to observe a coherent set of installed
   modules.
4. The dry run plus complete constraints prevent the resolver from *choosing* to replace a
   protected distribution's version, but they do not provide a filesystem transaction or
   rollback. Installation interruption, colliding files, ``.pth`` behavior, installer bugs, and
   malicious packages remain possible even when the resolver's plan looks correct.
5. A newly added distribution can expose a top-level importable module that collides with an
   existing distribution's module, even though no existing distribution's *version* changed.
6. Plugins are arbitrary trusted Python code once built or imported. This compatibility check is
   a dependency-resolution safeguard, not a security sandbox.
7. The dry run and the real run are two separate resolver executions. Using identical constraints
   and requirements bounds the allowed changes, but a mutable index or a direct/VCS source could
   still resolve differently between the two invocations.
8. Repeated single-plugin installs are order-dependent and can leave unnecessary transitive
   packages installed over time (see point 2). This is an accepted limitation of this immediate
   hardening, to be addressed by the candidate-environment design referenced above.

Public API
----------
plugin_default_specifier()
    Build the default ``SpecifierSet`` for a plugin install based on the installed fiab-core major.
install_plugin_compatibly(pip_source, version, module_name)
    Install or update a plugin, freezing and preserving the rest of the environment.
get_compatible_versions(plugin_settings, available_versions)
    Filter an iterable of version strings to only compatible ones.
"""

import importlib
import logging
import sys
from collections.abc import Iterator

import git
from cascade.low.func import Either
from packaging.requirements import InvalidRequirement, Requirement
from packaging.specifiers import SpecifierSet
from packaging.utils import canonicalize_name
from packaging.version import InvalidVersion, Version

from forecastbox.utility.config import PluginSettings
from forecastbox.utility.packages import (
    PackagesError,
    exclude_distribution,
    extract_editable_local_requirements,
    freeze_environment,
    parse_frozen_environment,
    parse_install_output,
    query_module_distribution_map,
    render_constraints,
    run_pip_check,
    run_pip_install,
    temporary_constraints_file,
)

logger = logging.getLogger(__name__)


def get_fiabcore_version() -> Version:
    """Return the currently installed version of ``fiab-core`` as a ``Version`` object."""
    raw = importlib.metadata.version("fiab-core")
    if raw == "0.0.0":
        # basically $(git describe --tags --abbrev=0 --match="c*")
        r = git.Repo("..")
        tags = (t.name for t in r.tags if t.name.startswith("c"))
        mostRecent = max(tags, key=lambda x: int(r.git.rev_list(f"tags/{x}", "--count")), default="c0.0.0.0")
        noPrefix = mostRecent[1:]
        dropLast = noPrefix.rsplit(".", 1)[0]
        return Version(dropLast)
    else:
        return Version(raw)


def plugin_default_specifier() -> SpecifierSet:
    """Return the ``SpecifierSet`` to use when installing a plugin when there is no
    user version to start from. Derives a major-version compatibility range from
    the currently installed ``fiab-core`` (e.g. ``>=1,<2``).
    """
    major = get_fiabcore_version().major
    return SpecifierSet(f">={major}.0.0,<{major + 1}.0.0")


def get_compatible_versions(plugin_settings: PluginSettings, available_versions: Iterator[str]) -> Iterator[str]:
    """Yield versions from *available_versions* that are compatible with the installed ``fiab-core``, that is,
    the plugin major version equals the ``fiab-core`` major version."""
    fiabcore_major = get_fiabcore_version().major
    for version_str in available_versions:
        try:
            v = Version(version_str)
        except InvalidVersion:
            # NOTE should not happen, these should come from pypi
            logger.error(f"Skipping invalid version string {version_str!r} for {plugin_settings.pip_source!r}")
            continue
        if v.major == fiabcore_major:
            yield version_str


def _plugin_requirement_args(pip_source: str, version: Version | None) -> list[str]:
    """Build the CLI requirement tokens for the requested plugin install/update."""
    if pip_source.startswith("-e") or pip_source.startswith("file://"):
        if version is not None:
            raise ValueError(f"unexpected {version=} for locally installable {pip_source=}")
        return pip_source.split(" ", 1)
    if version is not None:
        return [f"{pip_source}=={version}"]
    return [f"{pip_source}{plugin_default_specifier()}"]


def _registry_distribution_name(pip_source: str) -> str | None:
    """If *pip_source* is a plain registry requirement (not editable/local/URL), return its
    canonicalized distribution name; otherwise ``None``."""
    if pip_source.startswith("-e") or pip_source.startswith("file://"):
        return None
    try:
        req = Requirement(pip_source)
    except InvalidRequirement:
        return None
    if req.url:
        return None
    return canonicalize_name(req.name)


def _resolve_target_distribution_name(pip_source: str, module_name: str, python: str) -> str | None:
    """Determine the canonical distribution name of the plugin currently being installed/updated,
    so it can be excluded from the frozen environment snapshot.

    For a plain registry ``pip_source`` (``name`` or ``name==version``), the name is parsed
    directly -- this works even for a first install, where nothing is installed yet.

    For local/editable/URL/VCS sources we cannot reliably derive the distribution name from
    ``pip_source`` itself (a directory basename is not a distribution name), so we instead look
    at installed metadata in the *target* environment (``python``, queried via
    ``query_module_distribution_map`` -- not necessarily the interpreter currently running this
    code), which maps the plugin's configured top-level import module to the distribution(s)
    currently providing it there. If nothing is installed yet (first install) this correctly
    returns ``None`` -- there is nothing to exclude. If more than one distribution provides that
    top-level module we refuse to guess and raise, rather than possibly excluding (and so failing
    to protect) the wrong one.
    """
    registry_name = _registry_distribution_name(pip_source)
    if registry_name is not None:
        return registry_name
    top_level = module_name.split(".", 1)[0]
    mapping = query_module_distribution_map(python)
    candidates = {canonicalize_name(name) for name in mapping.get(top_level, [])}
    if not candidates:
        return None
    if len(candidates) > 1:
        raise PackagesError(
            f"cannot uniquely identify the installed distribution for module {module_name!r}: candidates are {sorted(candidates)}"
        )
    return next(iter(candidates))


def install_plugin_compatibly(pip_source: str, version: Version | None, module_name: str) -> Either[dict[str, str], str]:  # type: ignore[type-arg]
    """Install or update a plugin, freezing and preserving every other currently-installed
    distribution (as an exact pin or as its existing editable/local source) so that ``uv`` cannot
    upgrade or downgrade anything else while resolving the requested plugin requirement.

    Returns ``Either.ok(versions)`` on success, where ``versions`` maps newly-installed package
    names to their version strings (from the real install only, never from the dry run), or
    ``Either.error(msg)`` on failure. Never raises -- see the module docstring for the full
    algorithm and its limitations.
    """
    python = sys.executable
    plugin_requirement_args = _plugin_requirement_args(pip_source, version)

    try:
        target_name = _resolve_target_distribution_name(pip_source, module_name, python)
    except PackagesError as e:
        msg = f"stage=identify: {e!r}"
        logger.error(msg)
        return Either.error(msg)

    baseline = run_pip_check(python)
    if not baseline.ok:
        msg = f"stage=baseline-check: existing environment already fails `uv pip check`, refusing to install: {baseline.stderr or baseline.stdout}"
        logger.error(msg)
        return Either.error(msg)

    try:
        raw_lines = freeze_environment(python)
        snapshot = parse_frozen_environment(raw_lines, python)
    except PackagesError as e:
        msg = f"stage=freeze: {e!r}"
        logger.error(msg)
        return Either.error(msg)

    if target_name is not None:
        snapshot = exclude_distribution(snapshot, target_name)

    constraints_text = render_constraints(snapshot)
    extra_requirement_args = extract_editable_local_requirements(snapshot)
    logger.debug(
        f"installing {plugin_requirement_args} with {python=}, "
        f"{len(constraints_text.splitlines())} pinned distributions, "
        f"{len(extra_requirement_args)} preserved editable/local requirement tokens"
    )

    with temporary_constraints_file(constraints_text) as constraints_path:
        dry_run = run_pip_install(python, constraints_path, extra_requirement_args, plugin_requirement_args, dry_run=True)
        if not dry_run.ok:
            msg = f"stage=dry-run: dry-run resolution failed for {plugin_requirement_args}: {dry_run.stderr or dry_run.stdout}"
            logger.error(msg)
            return Either.error(msg)

        real_install = run_pip_install(python, constraints_path, extra_requirement_args, plugin_requirement_args, dry_run=False)
        if not real_install.ok:
            msg = f"stage=install: installing {plugin_requirement_args} failed: {real_install.stderr or real_install.stdout}"
            logger.error(msg)
            return Either.error(msg)

    installed_versions = parse_install_output(real_install.stderr)

    post_check = run_pip_check(python)
    if not post_check.ok:
        msg = (
            f"stage=post-check: environment failed `uv pip check` after installing {plugin_requirement_args}; "
            f"this is detection, not rollback -- the environment may be broken: {post_check.stderr or post_check.stdout}"
        )
        logger.error(msg)
        return Either.error(msg)

    return Either.ok(installed_versions)
