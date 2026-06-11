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
install_specifier(version)
    Build the ``SpecifierSet`` used when pip-installing a plugin.
get_compatible_versions(plugin_settings, available_versions)
    Filter an iterable of version strings to only compatible ones.
"""

import logging
from collections.abc import Iterator

from packaging.specifiers import SpecifierSet
from packaging.version import InvalidVersion, Version

from forecastbox.utility.config import PluginSettings
from forecastbox.utility.packages import get_fiabcore_version

logger = logging.getLogger(__name__)


def install_specifier(version: Version | None) -> SpecifierSet:
    """Return the ``SpecifierSet`` to use when installing a plugin. If `version` not given,
    derive a major-version compatibility range from the currently installed ``fiab-core``
    (e.g. ``>=1,<2``). Otherwise, pin to that exact release (e.g. ``==1.2.3``). Does not
    check whether that release is within the fiab core bounds!
    """
    if version is None:
        major = get_fiabcore_version().major
        return SpecifierSet(f">={major},<{major + 1}")
    return SpecifierSet(f"=={version}")


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
