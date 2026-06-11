# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for plugin route helpers — version/specifier parsing logic and /versions route."""

from unittest.mock import patch

import pytest
from fastapi.exceptions import HTTPException
from fiab_core.fable import PluginCompositeId, PluginId, PluginStoreId
from packaging.specifiers import SpecifierSet
from packaging.version import Version

from forecastbox.domain.plugin.store import PluginRemoteInfo, PluginStoreEntry
from forecastbox.routes.plugins import get_plugin_versions
from forecastbox.utility.config import PluginSettings

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


# ---------------------------------------------------------------------------
# /versions route — get_plugin_versions
# ---------------------------------------------------------------------------

_COMPOSITE_ID = PluginCompositeId(store=PluginStoreId("ecmwf"), local=PluginId("ecmwf-base"))
_STORE_ENTRY = PluginStoreEntry(
    pip_source="fiab-plugin-ecmwf",
    module_name="fiab_plugin_ecmwf",
    display_title="ECMWF Plugin",
    display_description="desc",
    display_author="ECMWF",
)
_REMOTE_INFO = PluginRemoteInfo(version="1.2.0")


from unittest.mock import _patch as PatchType


def _patch_versions(versions: list[str]) -> PatchType:
    return patch("forecastbox.routes.plugins.get_package_versions", return_value=iter(versions))


def _patch_store(entry: PluginStoreEntry = _STORE_ENTRY) -> PatchType:
    return patch("forecastbox.routes.plugins.get_plugins_detail", return_value={_COMPOSITE_ID: (entry, _REMOTE_INFO)})


def _patch_fiabcore(version_str: str = "1.0.0") -> PatchType:
    return patch("forecastbox.domain.plugin.compatibility.get_fiabcore_version", return_value=Version(version_str))


def test_versions_returns_compatible_sorted_descending() -> None:
    available = ["1.0.0", "1.2.0", "2.0.0", "1.1.0"]
    with _patch_store(), _patch_versions(available), _patch_fiabcore("1.0.0"):
        result = get_plugin_versions(_COMPOSITE_ID)
    assert result.versions == ["1.2.0", "1.1.0", "1.0.0"]


def test_versions_returns_empty_when_nothing_compatible() -> None:
    available = ["2.0.0", "3.0.0"]
    with _patch_store(), _patch_versions(available), _patch_fiabcore("1.0.0"):
        result = get_plugin_versions(_COMPOSITE_ID)
    assert result.versions == []


def test_versions_404_when_plugin_not_in_store_or_config() -> None:
    unknown_id = PluginCompositeId(store=PluginStoreId("unknown"), local=PluginId("unknown"))
    with patch("forecastbox.routes.plugins.get_plugins_detail", return_value={}):
        with patch("forecastbox.routes.plugins.config") as mock_config:
            mock_config.external.plugins = {}
            with pytest.raises(HTTPException) as exc_info:
                get_plugin_versions(unknown_id)
    assert exc_info.value.status_code == 404


def test_versions_falls_back_to_config_when_not_in_store() -> None:
    plugin_settings = PluginSettings(pip_source="fiab-plugin-ecmwf", module_name="fiab_plugin_ecmwf")
    available = ["1.0.0", "1.3.0"]
    with patch("forecastbox.routes.plugins.get_plugins_detail", return_value={}):
        with patch("forecastbox.routes.plugins.config") as mock_config:
            mock_config.external.plugins = {_COMPOSITE_ID: plugin_settings}
            with _patch_versions(available), _patch_fiabcore("1.5.0"):
                result = get_plugin_versions(_COMPOSITE_ID)
    assert result.versions == ["1.3.0", "1.0.0"]


def test_versions_pip_source_passed_to_get_package_versions() -> None:
    with _patch_store() as mock_detail, _patch_fiabcore("1.0.0"):
        with patch("forecastbox.routes.plugins.get_package_versions", return_value=iter([])) as mock_gpv:
            get_plugin_versions(_COMPOSITE_ID)
    mock_gpv.assert_called_once_with("fiab-plugin-ecmwf")
