# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for plugin route helpers — version/specifier parsing logic and /versions route."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.exceptions import HTTPException
from fiab_core.fable import (
    BlockFactory,
    BlockFactoryCatalogue,
    BlockFactoryId,
    BlockInstance,
    BlockInstanceId,
    BlueprintTemplate,
    BlueprintTemplateBlock,
    BlueprintTemplateExampleInput,
    ConfigurationOptionId,
    PluginCompositeId,
    PluginId,
    PluginStoreId,
)
from fiab_core.plugin import Plugin
from packaging.specifiers import SpecifierSet
from packaging.version import Version
from pyrsistent import pmap

from forecastbox.domain.plugin.store import PluginRemoteInfo, PluginStoreEntry
from forecastbox.routes.plugins import get_plugin_versions, get_template_example_values, update_plugin
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


def test_update_without_version_selects_newest_compatible_version() -> None:
    with (
        _patch_store(),
        _patch_versions(["1.0.0", "1.2.0", "2.0.0"]),
        _patch_fiabcore("1.0.0"),
        patch("forecastbox.routes.plugins.submit_update_single", return_value="") as mock_submit,
    ):
        update_plugin(MagicMock(), _COMPOSITE_ID)
    mock_submit.assert_called_once_with(_COMPOSITE_ID, install=True, version=Version("1.2.0"))


def test_update_without_version_rejects_when_no_compatible_version_exists() -> None:
    with (
        _patch_store(),
        _patch_versions(["2.0.0"]),
        _patch_fiabcore("1.0.0"),
    ):
        with pytest.raises(HTTPException) as exc_info:
            update_plugin(MagicMock(), _COMPOSITE_ID)
    assert exc_info.value.status_code == 400


# ---------------------------------------------------------------------------
# /templateExampleValues route
# ---------------------------------------------------------------------------

_PLUGIN_ID = PluginCompositeId(store=PluginStoreId("test"), local=PluginId("plugin"))
_TEXT = ConfigurationOptionId("text")
_BLOCK_A = BlockInstanceId("block_a")

_TEMPLATE_WITH_EXAMPLES = BlueprintTemplate(
    display_name="myTemplate",
    display_description="desc",
    blocks={
        _BLOCK_A: BlueprintTemplateBlock(
            factory_id=BlockFactoryId("source_text"),
            instance=BlockInstance(configuration_values={_TEXT: "fixed"}, input_ids={}),
        ),
    },
    example_values={_BLOCK_A: {_TEXT: BlueprintTemplateExampleInput(example_value="${exampleGlyph}")}},
    example_glyphs={"exampleGlyph": BlueprintTemplateExampleInput(example_value="hello world")},
)

_TEMPLATE_NO_EXAMPLES = BlueprintTemplate(
    display_name="noExamples",
    display_description="desc",
    blocks={},
)


def _make_plugin(*templates: BlueprintTemplate) -> Plugin:
    return Plugin(
        catalogue=BlockFactoryCatalogue(factories={}),
        validator=lambda factory_id, inst, inputs: (_ for _ in ()).throw(NotImplementedError),  # type: ignore[return-value]
        expander=lambda output: [],
        compiler=lambda lookup, factory_id, inst: (_ for _ in ()).throw(NotImplementedError),  # type: ignore[return-value]
        blueprint_templates=templates,
    )


def _make_plugin_state(excluded: list[str] | None = None, remapping: dict[str, str] | None = None) -> MagicMock:
    state = MagicMock()
    state.excluded_templates = excluded or []
    state.glyph_remapping = remapping or {}
    return state


@pytest.mark.asyncio
async def test_template_example_values_returns_examples() -> None:
    plugin = _make_plugin(_TEMPLATE_WITH_EXAMPLES)
    state = _make_plugin_state()
    with (
        patch("forecastbox.routes.plugins.PluginManager") as mock_pm,
        patch("forecastbox.routes.plugins.get_plugin_state", new=AsyncMock(return_value=state)),
    ):
        mock_pm.plugins = pmap({_PLUGIN_ID: plugin})
        result = await get_template_example_values(_PLUGIN_ID, "myTemplate")
    assert result.example_values == {_BLOCK_A: {_TEXT: BlueprintTemplateExampleInput(example_value="${exampleGlyph}")}}
    assert result.example_glyphs == {"exampleGlyph": BlueprintTemplateExampleInput(example_value="hello world")}


@pytest.mark.asyncio
async def test_template_example_values_applies_remapping() -> None:
    plugin = _make_plugin(_TEMPLATE_WITH_EXAMPLES)
    state = _make_plugin_state(remapping={"exampleGlyph": "renamedGlyph"})
    with (
        patch("forecastbox.routes.plugins.PluginManager") as mock_pm,
        patch("forecastbox.routes.plugins.get_plugin_state", new=AsyncMock(return_value=state)),
    ):
        mock_pm.plugins = pmap({_PLUGIN_ID: plugin})
        result = await get_template_example_values(_PLUGIN_ID, "myTemplate")
    # Key renamed, value's glyph reference renamed
    assert result.example_glyphs == {"renamedGlyph": BlueprintTemplateExampleInput(example_value="hello world")}
    # The example_value string referencing ${exampleGlyph} must be rewritten
    assert result.example_values[_BLOCK_A][_TEXT] == BlueprintTemplateExampleInput(example_value="${renamedGlyph}")


@pytest.mark.asyncio
async def test_template_example_values_404_unknown_plugin() -> None:
    with patch("forecastbox.routes.plugins.PluginManager") as mock_pm:
        mock_pm.plugins = pmap()
        with pytest.raises(HTTPException) as exc_info:
            await get_template_example_values(_PLUGIN_ID, "myTemplate")
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_template_example_values_404_unknown_display_name() -> None:
    plugin = _make_plugin(_TEMPLATE_WITH_EXAMPLES)
    with patch("forecastbox.routes.plugins.PluginManager") as mock_pm:
        mock_pm.plugins = pmap({_PLUGIN_ID: plugin})
        with pytest.raises(HTTPException) as exc_info:
            await get_template_example_values(_PLUGIN_ID, "nonExistent")
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_template_example_values_403_excluded() -> None:
    plugin = _make_plugin(_TEMPLATE_WITH_EXAMPLES)
    state = _make_plugin_state(excluded=["myTemplate"])
    with (
        patch("forecastbox.routes.plugins.PluginManager") as mock_pm,
        patch("forecastbox.routes.plugins.get_plugin_state", new=AsyncMock(return_value=state)),
    ):
        mock_pm.plugins = pmap({_PLUGIN_ID: plugin})
        with pytest.raises(HTTPException) as exc_info:
            await get_template_example_values(_PLUGIN_ID, "myTemplate")
    assert exc_info.value.status_code == 403
