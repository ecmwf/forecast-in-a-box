# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for plugin route helpers — version/specifier parsing logic."""

from packaging.specifiers import SpecifierSet
from packaging.version import Version

# ---------------------------------------------------------------------------
# Helpers that mirror the route logic without depending on FastAPI/HTTP stack
# ---------------------------------------------------------------------------


def _build_specifier_for_version(version_str: str) -> SpecifierSet:
    """Mirrors the route logic: parse a version string into an exact SpecifierSet."""
    return SpecifierSet(f"=={Version(version_str)}")


def _build_default_specifier(fiabcore_version: Version) -> SpecifierSet:
    """Mirrors the route logic: derive a compatible range from the fiabcore major."""
    major = fiabcore_version.major
    return SpecifierSet(f">={major},<{major + 1}")


# ---------------------------------------------------------------------------
# Version-string → SpecifierSet (explicit version)
# ---------------------------------------------------------------------------


def test_exact_specifier_from_simple_version() -> None:
    spec = _build_specifier_for_version("1.2.3")
    assert Version("1.2.3") in spec
    assert Version("1.2.4") not in spec
    assert Version("1.2.2") not in spec


def test_exact_specifier_from_zero_version() -> None:
    spec = _build_specifier_for_version("0.0.0")
    assert Version("0.0.0") in spec
    assert Version("0.0.1") not in spec


def test_exact_specifier_rejects_invalid_string() -> None:
    import pytest
    from packaging.version import InvalidVersion

    with pytest.raises(InvalidVersion):
        _build_specifier_for_version("not-a-version")


# ---------------------------------------------------------------------------
# Default specifier derived from fiabcore major
# ---------------------------------------------------------------------------


def test_default_specifier_major_zero() -> None:
    spec = _build_default_specifier(Version("0.5.0"))
    assert Version("0.0.0") in spec
    assert Version("0.9.9") in spec
    assert Version("1.0.0") not in spec


def test_default_specifier_major_one() -> None:
    spec = _build_default_specifier(Version("1.0.0"))
    assert Version("1.0.0") in spec
    assert Version("1.99.0") in spec
    assert Version("2.0.0") not in spec
    assert Version("0.9.9") not in spec


def test_default_specifier_major_two() -> None:
    spec = _build_default_specifier(Version("2.3.1"))
    assert Version("2.0.0") in spec
    assert Version("2.99.99") in spec
    assert Version("3.0.0") not in spec
    assert Version("1.99.99") not in spec


def test_default_specifier_patch_irrelevant() -> None:
    # Only the major component matters for the range
    spec_a = _build_default_specifier(Version("1.0.0"))
    spec_b = _build_default_specifier(Version("1.5.3"))
    assert str(spec_a) == str(spec_b)
