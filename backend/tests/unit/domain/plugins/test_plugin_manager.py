# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for status_full() -- specifically the plugin_active_templates and
plugin_excluded_template_names fields derived from the in-memory plugin state."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

from fiab_core.fable import (
    BlockFactoryCatalogue,
    BlueprintTemplate,
    PluginCompositeId,
    PluginId,
    PluginStoreId,
)
from fiab_core.plugin import Plugin
from pyrsistent import pmap

from forecastbox.domain.plugin.manager import status_full

# ---------------------------------------------------------------------------
# Helpers
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


def _make_plugin_state(plugin_id: PluginCompositeId, excluded: list[str] | None = None) -> MagicMock:
    state = MagicMock()
    state.plugin_id = PluginCompositeId.to_str(plugin_id)
    state.plugin_version = "1.0.0"
    state.updated_at = None
    state.plugin_errors = []
    state.excluded_templates = excluded or []
    state.glyph_remapping = {}
    state.template_errors = {}
    state.enabled = True
    return state


def _run(coro: object) -> object:  # type: ignore[type-arg]
    return asyncio.run(coro)  # type: ignore[arg-type]


def _patch_db(states: list[MagicMock]) -> object:
    return patch("forecastbox.domain.plugin.manager.get_all_plugin_states", new=AsyncMock(return_value=states))


def _patch_time() -> object:
    return patch("forecastbox.domain.plugin.manager.value_dt2str", return_value="2024-01-01T00:00:00")


# ---------------------------------------------------------------------------
# Tests for plugin_active_templates and plugin_excluded_template_names
# ---------------------------------------------------------------------------


def test_active_templates_all_present_when_no_exclusions() -> None:
    plugin = _make_plugin("alpha", "beta", "gamma")
    state = _make_plugin_state(_PLUGIN_A, excluded=[])

    with (
        patch("forecastbox.domain.plugin.manager.PluginManager") as mock_pm,
        _patch_db([state]),
        _patch_time(),
    ):
        mock_pm.lock = __import__("threading").Lock()
        mock_pm.plugins = pmap({_PLUGIN_A: plugin})
        mock_pm.errors = pmap()
        mock_pm.updater = MagicMock(is_alive=lambda: False)
        mock_pm.updater_error = None

        result = _run(status_full())

    assert result.plugin_active_templates[_PLUGIN_A] == ["alpha", "beta", "gamma"]
    assert result.plugin_excluded_template_names[_PLUGIN_A] == []


def test_excluded_templates_split_correctly() -> None:
    plugin = _make_plugin("alpha", "beta", "gamma")
    state = _make_plugin_state(_PLUGIN_A, excluded=["beta"])

    with (
        patch("forecastbox.domain.plugin.manager.PluginManager") as mock_pm,
        _patch_db([state]),
        _patch_time(),
    ):
        mock_pm.lock = __import__("threading").Lock()
        mock_pm.plugins = pmap({_PLUGIN_A: plugin})
        mock_pm.errors = pmap()
        mock_pm.updater = MagicMock(is_alive=lambda: False)
        mock_pm.updater_error = None

        result = _run(status_full())

    assert result.plugin_active_templates[_PLUGIN_A] == ["alpha", "gamma"]
    assert result.plugin_excluded_template_names[_PLUGIN_A] == ["beta"]


def test_all_templates_excluded() -> None:
    plugin = _make_plugin("t1", "t2")
    state = _make_plugin_state(_PLUGIN_A, excluded=["t1", "t2"])

    with (
        patch("forecastbox.domain.plugin.manager.PluginManager") as mock_pm,
        _patch_db([state]),
        _patch_time(),
    ):
        mock_pm.lock = __import__("threading").Lock()
        mock_pm.plugins = pmap({_PLUGIN_A: plugin})
        mock_pm.errors = pmap()
        mock_pm.updater = MagicMock(is_alive=lambda: False)
        mock_pm.updater_error = None

        result = _run(status_full())

    assert result.plugin_active_templates[_PLUGIN_A] == []
    assert set(result.plugin_excluded_template_names[_PLUGIN_A]) == {"t1", "t2"}


def test_excluded_name_not_in_plugin_templates_is_ignored() -> None:
    """A name in excluded_templates that doesn't match any actual template is silently ignored."""
    plugin = _make_plugin("alpha", "beta")
    state = _make_plugin_state(_PLUGIN_A, excluded=["nonexistent", "beta"])

    with (
        patch("forecastbox.domain.plugin.manager.PluginManager") as mock_pm,
        _patch_db([state]),
        _patch_time(),
    ):
        mock_pm.lock = __import__("threading").Lock()
        mock_pm.plugins = pmap({_PLUGIN_A: plugin})
        mock_pm.errors = pmap()
        mock_pm.updater = MagicMock(is_alive=lambda: False)
        mock_pm.updater_error = None

        result = _run(status_full())

    assert result.plugin_active_templates[_PLUGIN_A] == ["alpha"]
    assert result.plugin_excluded_template_names[_PLUGIN_A] == ["beta"]


def test_disabled_plugin_absent_from_template_dicts() -> None:
    """Disabled plugins are not in PluginManager.plugins, so they are absent from the template dicts."""
    # Plugin B is in the DB but not loaded (disabled)
    state_b = _make_plugin_state(_PLUGIN_B, excluded=["something"])
    state_b.enabled = False

    with (
        patch("forecastbox.domain.plugin.manager.PluginManager") as mock_pm,
        _patch_db([state_b]),
        _patch_time(),
    ):
        mock_pm.lock = __import__("threading").Lock()
        mock_pm.plugins = pmap()  # no loaded plugins
        mock_pm.errors = pmap()
        mock_pm.updater = MagicMock(is_alive=lambda: False)
        mock_pm.updater_error = None

        result = _run(status_full())

    assert _PLUGIN_B not in result.plugin_active_templates
    assert _PLUGIN_B not in result.plugin_excluded_template_names


def test_multiple_plugins_each_computed_independently() -> None:
    plugin_a = _make_plugin("x", "y")
    plugin_b = _make_plugin("p", "q", "r")
    state_a = _make_plugin_state(_PLUGIN_A, excluded=["x"])
    state_b = _make_plugin_state(_PLUGIN_B, excluded=["q", "r"])

    with (
        patch("forecastbox.domain.plugin.manager.PluginManager") as mock_pm,
        _patch_db([state_a, state_b]),
        _patch_time(),
    ):
        mock_pm.lock = __import__("threading").Lock()
        mock_pm.plugins = pmap({_PLUGIN_A: plugin_a, _PLUGIN_B: plugin_b})
        mock_pm.errors = pmap()
        mock_pm.updater = MagicMock(is_alive=lambda: False)
        mock_pm.updater_error = None

        result = _run(status_full())

    assert result.plugin_active_templates[_PLUGIN_A] == ["y"]
    assert result.plugin_excluded_template_names[_PLUGIN_A] == ["x"]
    assert result.plugin_active_templates[_PLUGIN_B] == ["p"]
    assert set(result.plugin_excluded_template_names[_PLUGIN_B]) == {"q", "r"}


def test_plugin_with_no_templates_gives_empty_lists() -> None:
    plugin = _make_plugin()  # no templates
    state = _make_plugin_state(_PLUGIN_A, excluded=[])

    with (
        patch("forecastbox.domain.plugin.manager.PluginManager") as mock_pm,
        _patch_db([state]),
        _patch_time(),
    ):
        mock_pm.lock = __import__("threading").Lock()
        mock_pm.plugins = pmap({_PLUGIN_A: plugin})
        mock_pm.errors = pmap()
        mock_pm.updater = MagicMock(is_alive=lambda: False)
        mock_pm.updater_error = None

        result = _run(status_full())

    assert result.plugin_active_templates[_PLUGIN_A] == []
    assert result.plugin_excluded_template_names[_PLUGIN_A] == []


def test_loaded_plugin_without_db_state_uses_empty_exclusions() -> None:
    """A plugin loaded in memory but without a DB state entry should have all templates active."""
    plugin = _make_plugin("alpha", "beta")

    with (
        patch("forecastbox.domain.plugin.manager.PluginManager") as mock_pm,
        _patch_db([]),  # no DB state rows at all
        _patch_time(),
    ):
        mock_pm.lock = __import__("threading").Lock()
        mock_pm.plugins = pmap({_PLUGIN_A: plugin})
        mock_pm.errors = pmap()
        mock_pm.updater = MagicMock(is_alive=lambda: False)
        mock_pm.updater_error = None

        result = _run(status_full())

    assert result.plugin_active_templates[_PLUGIN_A] == ["alpha", "beta"]
    assert result.plugin_excluded_template_names[_PLUGIN_A] == []
