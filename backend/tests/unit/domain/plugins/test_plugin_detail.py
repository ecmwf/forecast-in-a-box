# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for build_plugin_listing() in domain/plugin/detail.py.

Covers the included_templates / excluded_templates / load_errors / install_data
fields derived from the in-memory plugin state and DB rows.
"""

import threading
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fiab_core.fable import (
    BlockFactoryCatalogue,
    BlueprintTemplate,
    PluginCompositeId,
    PluginId,
    PluginStoreId,
)
from fiab_core.plugin import Plugin
from pyrsistent import pmap

from forecastbox.domain.plugin.detail import build_plugin_listing
from forecastbox.domain.plugin.errors import PluginError, PluginErrors
from forecastbox.domain.plugin.exceptions import PluginManagerBusy

# ---------------------------------------------------------------------------
# Shared test fixtures
# ---------------------------------------------------------------------------

_STORE = PluginStoreId("testStore")
_PLUGIN_A = PluginCompositeId(store=_STORE, local=PluginId("pluginA"))
_PLUGIN_B = PluginCompositeId(store=_STORE, local=PluginId("pluginB"))


def _make_template(name: str) -> BlueprintTemplate:
    return BlueprintTemplate(
        display_name=name,
        display_description="",
        blocks={},
    )


def _make_plugin(*template_names: str) -> Plugin:
    return Plugin(
        catalogue=BlockFactoryCatalogue(factories={}),
        validator=lambda factory_id, inst, inputs: (_ for _ in ()).throw(NotImplementedError),  # type: ignore[return-value]
        expander=lambda output: [],
        compiler=lambda lookup, factory_id, inst: (_ for _ in ()).throw(NotImplementedError),  # type: ignore[return-value]
        blueprint_templates=tuple(_make_template(n) for n in template_names),
    )


def _make_db_state(
    plugin_id: PluginCompositeId,
    *,
    excluded: list[str] | None = None,
    enabled: bool = True,
    version: str = "1.0.0",
    plugin_errors: list[dict] | None = None,
    template_errors: dict[str, str] | None = None,
    glyph_remapping: dict[str, str] | None = None,
) -> MagicMock:
    state = MagicMock()
    state.plugin_id = PluginCompositeId.to_str(plugin_id)
    state.plugin_version = version
    state.updated_at = MagicMock()
    state.plugin_errors = plugin_errors or []
    state.excluded_templates = excluded or []
    state.glyph_remapping = glyph_remapping or {}
    state.template_errors = template_errors or {}
    state.enabled = enabled
    return state


def _patch_db(states: list[MagicMock]) -> object:
    return patch("forecastbox.domain.plugin.detail.get_all_plugin_states", new=AsyncMock(return_value=states))


def _patch_store(detail: dict | None = None) -> object:
    return patch("forecastbox.domain.plugin.detail.get_plugins_detail", return_value=detail or {})


def _patch_time() -> object:
    return patch("forecastbox.domain.plugin.detail.value_dt2str", return_value="2024-01-01T00:00:00")


def _patch_manager(plugins: dict, errors: dict) -> object:
    lock = threading.Lock()

    def _ctx_manager(pm: MagicMock) -> None:
        pm.lock = lock
        pm.plugins = pmap(plugins)
        pm.errors = pmap(errors)

    return _ctx_manager


# ---------------------------------------------------------------------------
# included_templates / excluded_templates
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_included_templates_all_when_no_exclusions() -> None:
    plugin = _make_plugin("alpha", "beta", "gamma")
    state = _make_db_state(_PLUGIN_A, excluded=[])

    with (
        patch("forecastbox.domain.plugin.detail.PluginManager") as mock_pm,
        _patch_db([state]),
        _patch_store(),
        _patch_time(),
    ):
        mock_pm.lock = threading.Lock()
        mock_pm.plugins = pmap({_PLUGIN_A: plugin})
        mock_pm.errors = pmap()

        result = await build_plugin_listing()

    detail = result.plugins[_PLUGIN_A]
    assert detail.settings_data is not None
    assert detail.settings_data.included_templates == ["alpha", "beta", "gamma"]
    assert detail.settings_data.excluded_templates == []


@pytest.mark.asyncio
async def test_excluded_template_removed_from_included() -> None:
    plugin = _make_plugin("alpha", "beta", "gamma")
    state = _make_db_state(_PLUGIN_A, excluded=["beta"])

    with (
        patch("forecastbox.domain.plugin.detail.PluginManager") as mock_pm,
        _patch_db([state]),
        _patch_store(),
        _patch_time(),
    ):
        mock_pm.lock = threading.Lock()
        mock_pm.plugins = pmap({_PLUGIN_A: plugin})
        mock_pm.errors = pmap()

        result = await build_plugin_listing()

    sd = result.plugins[_PLUGIN_A].settings_data
    assert sd is not None
    assert sd.included_templates == ["alpha", "gamma"]
    assert sd.excluded_templates == ["beta"]


@pytest.mark.asyncio
async def test_all_templates_excluded_gives_empty_included() -> None:
    plugin = _make_plugin("t1", "t2")
    state = _make_db_state(_PLUGIN_A, excluded=["t1", "t2"])

    with (
        patch("forecastbox.domain.plugin.detail.PluginManager") as mock_pm,
        _patch_db([state]),
        _patch_store(),
        _patch_time(),
    ):
        mock_pm.lock = threading.Lock()
        mock_pm.plugins = pmap({_PLUGIN_A: plugin})
        mock_pm.errors = pmap()

        result = await build_plugin_listing()

    sd = result.plugins[_PLUGIN_A].settings_data
    assert sd is not None
    assert sd.included_templates == []
    assert set(sd.excluded_templates) == {"t1", "t2"}


@pytest.mark.asyncio
async def test_nonexistent_excluded_name_does_not_affect_included() -> None:
    """A name in excluded_templates that doesn't match any template is still stored but doesn't remove any included."""
    plugin = _make_plugin("alpha", "beta")
    state = _make_db_state(_PLUGIN_A, excluded=["nonexistent", "beta"])

    with (
        patch("forecastbox.domain.plugin.detail.PluginManager") as mock_pm,
        _patch_db([state]),
        _patch_store(),
        _patch_time(),
    ):
        mock_pm.lock = threading.Lock()
        mock_pm.plugins = pmap({_PLUGIN_A: plugin})
        mock_pm.errors = pmap()

        result = await build_plugin_listing()

    sd = result.plugins[_PLUGIN_A].settings_data
    assert sd is not None
    assert sd.included_templates == ["alpha"]
    assert set(sd.excluded_templates) == {"nonexistent", "beta"}


@pytest.mark.asyncio
async def test_disabled_plugin_has_empty_included_templates() -> None:
    """A disabled plugin should have settings_data with included_templates=[]."""
    state = _make_db_state(_PLUGIN_B, excluded=["something"], enabled=False)

    with (
        patch("forecastbox.domain.plugin.detail.PluginManager") as mock_pm,
        _patch_db([state]),
        _patch_store(),
        _patch_time(),
    ):
        mock_pm.lock = threading.Lock()
        mock_pm.plugins = pmap()  # not loaded
        mock_pm.errors = pmap()

        result = await build_plugin_listing()

    detail = result.plugins[_PLUGIN_B]
    assert detail.settings_data is not None
    assert detail.settings_data.isEnabled is False
    assert detail.settings_data.included_templates == []


@pytest.mark.asyncio
async def test_multiple_plugins_computed_independently() -> None:
    plugin_a = _make_plugin("x", "y")
    plugin_b = _make_plugin("p", "q", "r")
    state_a = _make_db_state(_PLUGIN_A, excluded=["x"])
    state_b = _make_db_state(_PLUGIN_B, excluded=["q", "r"])

    with (
        patch("forecastbox.domain.plugin.detail.PluginManager") as mock_pm,
        _patch_db([state_a, state_b]),
        _patch_store(),
        _patch_time(),
    ):
        mock_pm.lock = threading.Lock()
        mock_pm.plugins = pmap({_PLUGIN_A: plugin_a, _PLUGIN_B: plugin_b})
        mock_pm.errors = pmap()

        result = await build_plugin_listing()

    sd_a = result.plugins[_PLUGIN_A].settings_data
    sd_b = result.plugins[_PLUGIN_B].settings_data
    assert sd_a is not None and sd_b is not None
    assert sd_a.included_templates == ["y"]
    assert sd_b.included_templates == ["p"]
    assert set(sd_b.excluded_templates) == {"q", "r"}


@pytest.mark.asyncio
async def test_plugin_with_no_templates_gives_empty_included() -> None:
    plugin = _make_plugin()
    state = _make_db_state(_PLUGIN_A)

    with (
        patch("forecastbox.domain.plugin.detail.PluginManager") as mock_pm,
        _patch_db([state]),
        _patch_store(),
        _patch_time(),
    ):
        mock_pm.lock = threading.Lock()
        mock_pm.plugins = pmap({_PLUGIN_A: plugin})
        mock_pm.errors = pmap()

        result = await build_plugin_listing()

    sd = result.plugins[_PLUGIN_A].settings_data
    assert sd is not None
    assert sd.included_templates == []


@pytest.mark.asyncio
async def test_plugin_in_memory_without_db_state_has_no_install_data() -> None:
    """A plugin loaded in memory but without a DB row should have install_data=None and settings_data=None."""
    plugin = _make_plugin("alpha", "beta")

    with (
        patch("forecastbox.domain.plugin.detail.PluginManager") as mock_pm,
        _patch_db([]),
        _patch_store(),
        _patch_time(),
    ):
        mock_pm.lock = threading.Lock()
        mock_pm.plugins = pmap({_PLUGIN_A: plugin})
        mock_pm.errors = pmap()

        result = await build_plugin_listing()

    detail = result.plugins[_PLUGIN_A]
    assert detail.install_data is None
    assert detail.settings_data is None
    assert detail.load_errors == []


# ---------------------------------------------------------------------------
# install_data and settings_data availability
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_install_data_populated_when_db_state_exists() -> None:
    state = _make_db_state(_PLUGIN_A, version="2.3.1")

    with (
        patch("forecastbox.domain.plugin.detail.PluginManager") as mock_pm,
        _patch_db([state]),
        _patch_store(),
        _patch_time(),
    ):
        mock_pm.lock = threading.Lock()
        mock_pm.plugins = pmap()
        mock_pm.errors = pmap()

        result = await build_plugin_listing()

    detail = result.plugins[_PLUGIN_A]
    assert detail.install_data is not None
    assert detail.install_data.local_version == "2.3.1"
    assert detail.install_data.update_datetime == "2024-01-01T00:00:00"
    assert detail.install_data.install_errors == []


@pytest.mark.asyncio
async def test_settings_data_absent_when_install_failed() -> None:
    """If install_errors contain an error-severity entry, settings_data must be None."""
    state = _make_db_state(
        _PLUGIN_A,
        version="install failed",
        plugin_errors=[{"source": "install", "severity": "error", "detail": "pip exploded"}],
    )

    with (
        patch("forecastbox.domain.plugin.detail.PluginManager") as mock_pm,
        _patch_db([state]),
        _patch_store(),
        _patch_time(),
    ):
        mock_pm.lock = threading.Lock()
        mock_pm.plugins = pmap()
        mock_pm.errors = pmap()

        result = await build_plugin_listing()

    detail = result.plugins[_PLUGIN_A]
    assert detail.install_data is not None
    assert len(detail.install_data.install_errors) == 1
    assert detail.install_data.install_errors[0].severity == "error"
    assert detail.settings_data is None


@pytest.mark.asyncio
async def test_settings_data_present_when_only_warnings() -> None:
    """Install warnings should not suppress settings_data."""
    state = _make_db_state(
        _PLUGIN_A,
        plugin_errors=[{"source": "install", "severity": "warning", "detail": "minor issue"}],
    )

    with (
        patch("forecastbox.domain.plugin.detail.PluginManager") as mock_pm,
        _patch_db([state]),
        _patch_store(),
        _patch_time(),
    ):
        mock_pm.lock = threading.Lock()
        mock_pm.plugins = pmap()
        mock_pm.errors = pmap()

        result = await build_plugin_listing()

    detail = result.plugins[_PLUGIN_A]
    assert detail.settings_data is not None


# ---------------------------------------------------------------------------
# load_errors
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_load_errors_from_in_memory_errors() -> None:
    state = _make_db_state(_PLUGIN_A)
    in_mem_err = PluginErrors([PluginError(source="load", severity="error", detail="import failed")])

    with (
        patch("forecastbox.domain.plugin.detail.PluginManager") as mock_pm,
        _patch_db([state]),
        _patch_store(),
        _patch_time(),
    ):
        mock_pm.lock = threading.Lock()
        mock_pm.plugins = pmap()
        mock_pm.errors = pmap({_PLUGIN_A: in_mem_err})

        result = await build_plugin_listing()

    detail = result.plugins[_PLUGIN_A]
    assert len(detail.load_errors) == 1
    assert detail.load_errors[0].source == "load"
    assert detail.load_errors[0].severity == "error"


@pytest.mark.asyncio
async def test_load_errors_include_template_errors_from_db() -> None:
    state = _make_db_state(_PLUGIN_A, template_errors={"myTemplate": "validation failed"})

    with (
        patch("forecastbox.domain.plugin.detail.PluginManager") as mock_pm,
        _patch_db([state]),
        _patch_store(),
        _patch_time(),
    ):
        mock_pm.lock = threading.Lock()
        mock_pm.plugins = pmap()
        mock_pm.errors = pmap()

        result = await build_plugin_listing()

    detail = result.plugins[_PLUGIN_A]
    assert len(detail.load_errors) == 1
    assert detail.load_errors[0].source == "template_ingest"
    assert detail.load_errors[0].severity == "warning"
    assert "myTemplate" in detail.load_errors[0].detail


@pytest.mark.asyncio
async def test_load_errors_combined_from_memory_and_db() -> None:
    in_mem_err = PluginErrors([PluginError(source="load", severity="warning", detail="minor")])
    state = _make_db_state(_PLUGIN_A, template_errors={"tmpl": "bad"})

    with (
        patch("forecastbox.domain.plugin.detail.PluginManager") as mock_pm,
        _patch_db([state]),
        _patch_store(),
        _patch_time(),
    ):
        mock_pm.lock = threading.Lock()
        mock_pm.plugins = pmap()
        mock_pm.errors = pmap({_PLUGIN_A: in_mem_err})

        result = await build_plugin_listing()

    detail = result.plugins[_PLUGIN_A]
    sources = {e.source for e in detail.load_errors}
    assert sources == {"load", "template_ingest"}


# ---------------------------------------------------------------------------
# PluginManagerBusy
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_raises_plugin_manager_busy_when_lock_not_acquired() -> None:
    """If the PluginManager lock cannot be acquired, PluginManagerBusy is raised."""
    busy_lock = threading.Lock()
    busy_lock.acquire()  # hold the lock so timed_acquire times out

    with patch("forecastbox.domain.plugin.detail.PluginManager") as mock_pm:
        mock_pm.lock = busy_lock
        mock_pm.plugins = pmap()
        mock_pm.errors = pmap()

        with pytest.raises(PluginManagerBusy):
            await build_plugin_listing()

    busy_lock.release()


# ---------------------------------------------------------------------------
# glyph_remapping
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_glyph_remapping_propagated_to_settings() -> None:
    state = _make_db_state(_PLUGIN_A, glyph_remapping={"old": "new"})

    with (
        patch("forecastbox.domain.plugin.detail.PluginManager") as mock_pm,
        _patch_db([state]),
        _patch_store(),
        _patch_time(),
    ):
        mock_pm.lock = threading.Lock()
        mock_pm.plugins = pmap()
        mock_pm.errors = pmap()

        result = await build_plugin_listing()

    sd = result.plugins[_PLUGIN_A].settings_data
    assert sd is not None
    assert sd.glyph_remapping == {"old": "new"}
