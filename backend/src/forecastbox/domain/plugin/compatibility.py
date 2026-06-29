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

Public API
----------
plugin_default_specifier()
    Build the default ``SpecifierSet`` for a plugin install based on the installed fiab-core major.
install_plugin_compatibly(pip_source, version)
    Install a plugin, pinning fiab-core to the currently installed version.
get_compatible_versions(plugin_settings, available_versions)
    Filter an iterable of version strings to only compatible ones.
"""

import importlib
import logging
from collections.abc import Iterator

from packaging.specifiers import SpecifierSet
from packaging.version import InvalidVersion, Version

from forecastbox.utility.config import PluginSettings
from forecastbox.utility.packages import get_existing_install_pin, try_install

logger = logging.getLogger(__name__)


def get_fiabcore_version() -> Version:
    """Return the currently installed version of ``fiab-core`` as a ``Version`` object."""
    raw = importlib.metadata.version("fiab-core")
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


def install_plugin_compatibly(pip_source: str, version: Version | None) -> str | None:
    """Install a plugin with compatibility constraints.

    Returns ``None`` on success or an error string on failure.  Never raises.
    """
    if pip_source.startswith("-e"):
        pkgs = pip_source.split(" ", 1)
    else:
        if version is not None:
            pkgs = [f"{pip_source}=={version}"]
        else:
            pkgs = [f"{pip_source}{plugin_default_specifier()}"]
    # TODO -- include the whole pylock.toml
    pkgs += get_existing_install_pin("fiab-core")
    return try_install(pkgs)
