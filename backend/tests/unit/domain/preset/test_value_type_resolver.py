# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for the preset value_type resolver.

All catalogue / plugin-manager interactions are mocked so these tests run
without a running server or installed plugins.

Patch targets use the ``value_type_resolver`` module's own namespace because
``plugins_ready``, ``catalogue_view``, and ``status_brief`` are imported there
at module level.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from forecastbox.domain.preset.value_type_resolver import _wait_for_plugins, resolve_value_type

# Patch targets — the names as they appear in the resolver module's namespace.
_PLUGINS_READY = "forecastbox.domain.preset.value_type_resolver.plugins_ready"
_CATALOGUE_VIEW = "forecastbox.domain.preset.value_type_resolver.catalogue_view"
_STATUS_BRIEF = "forecastbox.domain.preset.value_type_resolver.status_brief"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_catalogue(store: str, local: str, factory: str, option: str, value_type: str) -> dict:
    """Build a minimal fake catalogue dict that resolve_value_type can navigate."""
    from fiab_core.fable import (
        BlockFactoryId,
        ConfigurationOptionId,
        PluginCompositeId,
        PluginId,
        PluginStoreId,
    )

    option_obj = MagicMock()
    option_obj.value_type = value_type

    factory_obj = MagicMock()
    factory_obj.configuration_options = {ConfigurationOptionId(option): option_obj}

    catalogue_obj = MagicMock()
    catalogue_obj.factories = {BlockFactoryId(factory): factory_obj}

    plugin_id = PluginCompositeId(store=PluginStoreId(store), local=PluginId(local))
    return {plugin_id: catalogue_obj}


# ---------------------------------------------------------------------------
# Tests: pass-through for non-glyph value types
# ---------------------------------------------------------------------------


def test_plain_string_type_is_returned_unchanged() -> None:
    assert resolve_value_type("string") == "string"


def test_enum_closed_type_is_returned_unchanged() -> None:
    assert resolve_value_type("enumClosed[a,b,c]") == "enumClosed[a,b,c]"


def test_integer_type_is_returned_unchanged() -> None:
    assert resolve_value_type("integer") == "integer"


def test_empty_string_is_returned_unchanged() -> None:
    assert resolve_value_type("") == ""


def test_unrelated_glyph_prefix_is_returned_unchanged() -> None:
    # A glyph[...] that is NOT catalogue: should pass through.
    assert resolve_value_type("glyph[something_else]") == "glyph[something_else]"


# ---------------------------------------------------------------------------
# Tests: successful catalogue resolution
# ---------------------------------------------------------------------------


def test_resolves_forecast_option_from_catalogue() -> None:
    """Happy path: glyph[catalogue:...] resolves to the catalogue value_type."""
    catalogue = _make_catalogue(
        store="ecmwf",
        local="ecmwf-base",
        factory="operationalForecastSource",
        option="forecast",
        value_type="enumClosed[aifs-ens,ifs-ens]",
    )

    with (
        patch(_PLUGINS_READY, return_value=True),
        patch(_CATALOGUE_VIEW, return_value=catalogue),
    ):
        result = resolve_value_type("glyph[catalogue:ecmwf/ecmwf-base/operationalForecastSource/forecast]")

    assert result == "enumClosed[aifs-ens,ifs-ens]"


def test_resolves_checkpoint_option_from_catalogue() -> None:
    """Resolves the anemoiSource checkpoint option."""
    catalogue = _make_catalogue(
        store="ecmwf",
        local="ecmwf-base",
        factory="anemoiSource",
        option="checkpoint",
        value_type="enumClosed[ecmwf:aifs-global-o48,ecmwf:aifs-global-o96]",
    )

    with (
        patch(_PLUGINS_READY, return_value=True),
        patch(_CATALOGUE_VIEW, return_value=catalogue),
    ):
        result = resolve_value_type("glyph[catalogue:ecmwf/ecmwf-base/anemoiSource/checkpoint]")

    assert result == "enumClosed[ecmwf:aifs-global-o48,ecmwf:aifs-global-o96]"


def test_case_insensitive_glyph_prefix() -> None:
    """The glyph[catalogue:...] prefix is matched case-insensitively."""
    catalogue = _make_catalogue(
        store="ecmwf",
        local="ecmwf-base",
        factory="operationalForecastSource",
        option="forecast",
        value_type="enumClosed[aifs-ens]",
    )

    with (
        patch(_PLUGINS_READY, return_value=True),
        patch(_CATALOGUE_VIEW, return_value=catalogue),
    ):
        result = resolve_value_type("GLYPH[CATALOGUE:ecmwf/ecmwf-base/operationalForecastSource/forecast]")

    assert result == "enumClosed[aifs-ens]"


# ---------------------------------------------------------------------------
# Tests: graceful degradation
# ---------------------------------------------------------------------------


def test_returns_raw_when_plugins_not_ready() -> None:
    """When plugins are not ready, the raw glyph string is returned."""
    raw = "glyph[catalogue:ecmwf/ecmwf-base/operationalForecastSource/forecast]"

    with patch(_PLUGINS_READY, return_value=False):
        result = resolve_value_type(raw)

    assert result == raw


def test_returns_raw_when_catalogue_view_returns_bool() -> None:
    """When catalogue_view() returns False (lock timeout), raw string is returned."""
    raw = "glyph[catalogue:ecmwf/ecmwf-base/operationalForecastSource/forecast]"

    with (
        patch(_PLUGINS_READY, return_value=True),
        patch(_CATALOGUE_VIEW, return_value=False),
    ):
        result = resolve_value_type(raw)

    assert result == raw


def test_returns_raw_when_plugin_not_in_catalogue() -> None:
    """When the plugin is not found in the catalogue, raw string is returned."""
    raw = "glyph[catalogue:unknown/plugin/factory/option]"

    with (
        patch(_PLUGINS_READY, return_value=True),
        patch(_CATALOGUE_VIEW, return_value={}),
    ):
        result = resolve_value_type(raw)

    assert result == raw


def test_returns_raw_when_factory_not_in_catalogue() -> None:
    """When the factory is not found in the plugin catalogue, raw string is returned."""
    from fiab_core.fable import PluginCompositeId, PluginId, PluginStoreId

    plugin_id = PluginCompositeId(store=PluginStoreId("ecmwf"), local=PluginId("ecmwf-base"))
    catalogue_obj = MagicMock()
    catalogue_obj.factories = {}  # no factories

    raw = "glyph[catalogue:ecmwf/ecmwf-base/missingFactory/option]"

    with (
        patch(_PLUGINS_READY, return_value=True),
        patch(_CATALOGUE_VIEW, return_value={plugin_id: catalogue_obj}),
    ):
        result = resolve_value_type(raw)

    assert result == raw


def test_returns_raw_when_option_not_in_factory() -> None:
    """When the option is not found in the factory, raw string is returned."""
    from fiab_core.fable import BlockFactoryId, PluginCompositeId, PluginId, PluginStoreId

    plugin_id = PluginCompositeId(store=PluginStoreId("ecmwf"), local=PluginId("ecmwf-base"))
    factory_obj = MagicMock()
    factory_obj.configuration_options = {}  # no options

    catalogue_obj = MagicMock()
    catalogue_obj.factories = {BlockFactoryId("operationalForecastSource"): factory_obj}

    raw = "glyph[catalogue:ecmwf/ecmwf-base/operationalForecastSource/missingOption]"

    with (
        patch(_PLUGINS_READY, return_value=True),
        patch(_CATALOGUE_VIEW, return_value={plugin_id: catalogue_obj}),
    ):
        result = resolve_value_type(raw)

    assert result == raw


def test_returns_raw_on_unexpected_exception() -> None:
    """Any unexpected exception during resolution returns the raw string."""
    raw = "glyph[catalogue:ecmwf/ecmwf-base/operationalForecastSource/forecast]"

    with patch(_PLUGINS_READY, side_effect=RuntimeError("boom")):
        result = resolve_value_type(raw)

    assert result == raw


def test_returns_raw_when_plugins_not_initialized() -> None:
    """When plugins_ready() returns False (e.g. updater is None), raw string is returned.

    This covers the specific scenario where PluginManager.updater is None
    (server started but submit_load_plugins has not been called yet).
    """
    raw = "glyph[catalogue:ecmwf/ecmwf-base/operationalForecastSource/forecast]"

    with patch(_PLUGINS_READY, return_value=False):
        result = resolve_value_type(raw)

    assert result == raw


# ---------------------------------------------------------------------------
# Tests: whitespace handling
# ---------------------------------------------------------------------------


def test_leading_trailing_whitespace_is_stripped() -> None:
    """Leading/trailing whitespace in the value_type string is handled."""
    catalogue = _make_catalogue(
        store="ecmwf",
        local="ecmwf-base",
        factory="operationalForecastSource",
        option="forecast",
        value_type="enumClosed[aifs-ens]",
    )

    with (
        patch(_PLUGINS_READY, return_value=True),
        patch(_CATALOGUE_VIEW, return_value=catalogue),
    ):
        result = resolve_value_type("  glyph[catalogue:ecmwf/ecmwf-base/operationalForecastSource/forecast]  ")

    assert result == "enumClosed[aifs-ens]"


# ---------------------------------------------------------------------------
# Tests: _wait_for_plugins race-condition handling
# ---------------------------------------------------------------------------


def test_wait_for_plugins_returns_true_immediately_when_ready() -> None:
    """When plugins are already ready, _wait_for_plugins returns True without sleeping."""
    with patch(_PLUGINS_READY, return_value=True):
        result = _wait_for_plugins(timeout_s=5.0, poll_s=0.01)
    assert result is True


def test_wait_for_plugins_returns_false_when_not_initialized() -> None:
    """When the updater thread has not been submitted yet, returns False immediately."""
    with (
        patch(_PLUGINS_READY, return_value=False),
        patch(_STATUS_BRIEF, return_value="not_initialized"),
    ):
        result = _wait_for_plugins(timeout_s=5.0, poll_s=0.01)
    assert result is False


def test_wait_for_plugins_returns_false_on_failure_state() -> None:
    """When the updater is in a failure state, returns False immediately."""
    with (
        patch(_PLUGINS_READY, return_value=False),
        patch(_STATUS_BRIEF, return_value="failure: something went wrong"),
    ):
        result = _wait_for_plugins(timeout_s=5.0, poll_s=0.01)
    assert result is False


def test_wait_for_plugins_polls_until_ready() -> None:
    """When updater is running, _wait_for_plugins polls until plugins become ready."""
    # First call: not ready (running); second call: ready.
    ready_sequence = [False, True]

    def _plugins_ready_side_effect() -> bool:
        return ready_sequence.pop(0) if ready_sequence else True

    with (
        patch(_PLUGINS_READY, side_effect=_plugins_ready_side_effect),
        patch(_STATUS_BRIEF, return_value="running"),
    ):
        result = _wait_for_plugins(timeout_s=5.0, poll_s=0.01)
    assert result is True


def test_wait_for_plugins_times_out() -> None:
    """When plugins never become ready within the timeout, returns False."""
    with (
        patch(_PLUGINS_READY, return_value=False),
        patch(_STATUS_BRIEF, return_value="running"),
    ):
        # Use a very short timeout so the test doesn't take long.
        result = _wait_for_plugins(timeout_s=0.05, poll_s=0.01)
    assert result is False


def test_resolve_waits_for_running_plugins_then_resolves() -> None:
    """When plugins are still loading, resolve_value_type waits and then resolves."""
    catalogue = _make_catalogue(
        store="ecmwf",
        local="ecmwf-base",
        factory="operationalForecastSource",
        option="forecast",
        value_type="enumClosed[aifs-ens,ifs-ens]",
    )

    # Simulate: first call to plugins_ready returns False (still running),
    # second call returns True (finished).
    ready_sequence = [False, True]

    def _plugins_ready_side_effect() -> bool:
        return ready_sequence.pop(0) if ready_sequence else True

    with (
        patch(_PLUGINS_READY, side_effect=_plugins_ready_side_effect),
        patch(_STATUS_BRIEF, return_value="running"),
        patch(_CATALOGUE_VIEW, return_value=catalogue),
    ):
        result = resolve_value_type("glyph[catalogue:ecmwf/ecmwf-base/operationalForecastSource/forecast]")

    assert result == "enumClosed[aifs-ens,ifs-ens]"


def test_resolve_returns_raw_when_wait_times_out() -> None:
    """When plugins never become ready within the timeout, raw glyph is returned.

    Patches ``_wait_for_plugins`` directly so the test does not actually sleep.
    """
    raw = "glyph[catalogue:ecmwf/ecmwf-base/operationalForecastSource/forecast]"

    with patch("forecastbox.domain.preset.value_type_resolver._wait_for_plugins", return_value=False):
        result = resolve_value_type(raw)

    assert result == raw
