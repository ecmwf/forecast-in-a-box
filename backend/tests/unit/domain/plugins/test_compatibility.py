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

from forecastbox.domain.plugin.compatibility import get_compatible_versions, install_specifier
from forecastbox.utility.config import PluginSettings

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_PLUGIN = PluginSettings(pip_source="my-plugin", module_name="my_plugin")


# ---------------------------------------------------------------------------
# install_specifier
# ---------------------------------------------------------------------------


def test_install_specifier_none_uses_fiabcore_major() -> None:
    with patch("forecastbox.domain.plugin.compatibility.get_fiabcore_version", return_value=Version("1.5.3")):
        spec = install_specifier(None)
    assert Version("1.0.0") in spec
    assert Version("1.99.0") in spec
    assert Version("2.0.0") not in spec
    assert Version("0.9.9") not in spec


def test_install_specifier_none_major_zero() -> None:
    with patch("forecastbox.domain.plugin.compatibility.get_fiabcore_version", return_value=Version("0.3.1")):
        spec = install_specifier(None)
    assert Version("0.0.0") in spec
    assert Version("0.9.9") in spec
    assert Version("1.0.0") not in spec


def test_install_specifier_exact_version() -> None:
    spec = install_specifier(Version("2.5.0"))
    assert Version("2.5.0") in spec
    assert Version("2.5.1") not in spec
    assert Version("2.4.9") not in spec


def test_install_specifier_returns_specifier_set() -> None:
    spec = install_specifier(Version("3.0.0"))
    assert isinstance(spec, SpecifierSet)


def test_install_specifier_none_returns_specifier_set() -> None:
    with patch("forecastbox.domain.plugin.compatibility.get_fiabcore_version", return_value=Version("1.0.0")):
        spec = install_specifier(None)
    assert isinstance(spec, SpecifierSet)


def test_install_specifier_consistent_with_major() -> None:
    """Minor/patch of fiab-core version must not affect the range."""
    with patch("forecastbox.domain.plugin.compatibility.get_fiabcore_version", return_value=Version("2.0.0")):
        spec_a = install_specifier(None)
    with patch("forecastbox.domain.plugin.compatibility.get_fiabcore_version", return_value=Version("2.7.3")):
        spec_b = install_specifier(None)
    assert str(spec_a) == str(spec_b)


# ---------------------------------------------------------------------------
# get_compatible_versions
# ---------------------------------------------------------------------------


def test_compatible_versions_filters_by_major() -> None:
    versions = ["1.0.0", "1.1.0", "2.0.0", "0.9.0"]
    with patch("forecastbox.domain.plugin.compatibility.get_fiabcore_version", return_value=Version("1.0.0")):
        result = list(get_compatible_versions(_PLUGIN, iter(versions)))
    assert result == ["1.0.0", "1.1.0"]


def test_compatible_versions_empty_input() -> None:
    with patch("forecastbox.domain.plugin.compatibility.get_fiabcore_version", return_value=Version("1.0.0")):
        result = list(get_compatible_versions(_PLUGIN, iter([])))
    assert result == []


def test_compatible_versions_none_match() -> None:
    versions = ["2.0.0", "3.0.0"]
    with patch("forecastbox.domain.plugin.compatibility.get_fiabcore_version", return_value=Version("1.0.0")):
        result = list(get_compatible_versions(_PLUGIN, iter(versions)))
    assert result == []


def test_compatible_versions_skips_invalid_strings() -> None:
    versions = ["1.0.0", "not-a-version", "1.2.3", "bad"]
    with patch("forecastbox.domain.plugin.compatibility.get_fiabcore_version", return_value=Version("1.0.0")):
        result = list(get_compatible_versions(_PLUGIN, iter(versions)))
    assert result == ["1.0.0", "1.2.3"]


def test_compatible_versions_major_zero() -> None:
    versions = ["0.1.0", "0.2.0", "1.0.0"]
    with patch("forecastbox.domain.plugin.compatibility.get_fiabcore_version", return_value=Version("0.5.0")):
        result = list(get_compatible_versions(_PLUGIN, iter(versions)))
    assert result == ["0.1.0", "0.2.0"]


def test_compatible_versions_is_streaming() -> None:
    """Verify the function is a generator (lazy evaluation)."""
    versions = ["1.0.0", "1.1.0"]
    with patch("forecastbox.domain.plugin.compatibility.get_fiabcore_version", return_value=Version("1.0.0")):
        gen = get_compatible_versions(_PLUGIN, iter(versions))
    import inspect

    assert inspect.isgenerator(gen)
