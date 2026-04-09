# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for domain/glyphs/resolution."""

import datetime as dt

import pytest
from fiab_core.fable import BlockInstance, PluginBlockFactoryId, PluginCompositeId

from forecastbox.domain.glyphs.resolution import extract_glyphs, resolve_configurations, value_dt2str


def _block(config: dict[str, str]) -> BlockInstance:
    return BlockInstance(
        factory_id=PluginBlockFactoryId(
            plugin=PluginCompositeId(store="test", local="test"),
            factory="test_factory",
        ),
        configuration_values=config,
        input_ids={},
    )


# ---------------------------------------------------------------------------
# extract_glyphs
# ---------------------------------------------------------------------------


def test_extract_glyphs_no_glyphs() -> None:
    block = _block({"key": "plain_value"})
    result = extract_glyphs(block)
    assert result.e is None
    assert result.t == set()


def test_extract_glyphs_single() -> None:
    block = _block({"key": "${myVar}"})
    result = extract_glyphs(block)
    assert result.e is None
    assert result.t == {"myVar"}


def test_extract_glyphs_multiple_in_one_value() -> None:
    block = _block({"key": "${var1}_${var2}"})
    result = extract_glyphs(block)
    assert result.e is None
    assert result.t == {"var1", "var2"}


def test_extract_glyphs_across_multiple_keys() -> None:
    block = _block({"key1": "${var1}", "key2": "${var2}"})
    result = extract_glyphs(block)
    assert result.e is None
    assert result.t == {"var1", "var2"}


def test_extract_glyphs_deduplicates() -> None:
    block = _block({"a": "${runId}", "b": "prefix_${runId}_suffix"})
    result = extract_glyphs(block)
    assert result.e is None
    assert result.t == {"runId"}


def test_extract_glyphs_mixed_plain_and_template() -> None:
    block = _block({"a": "static", "b": "${dynamic}"})
    result = extract_glyphs(block)
    assert result.e is None
    assert result.t == {"dynamic"}


# ---------------------------------------------------------------------------
# resolve_configurations
# ---------------------------------------------------------------------------


def test_resolve_configurations_full_substitution() -> None:
    block = _block({"key": "${myVar}"})
    resolve_configurations(block, {"myVar": "hello"})
    assert block.configuration_values["key"] == "hello"


def test_resolve_configurations_partial_substitution() -> None:
    block = _block({"key": "prefix_${myVar}_suffix"})
    resolve_configurations(block, {"myVar": "world"})
    assert block.configuration_values["key"] == "prefix_world_suffix"


def test_resolve_configurations_multiple_glyphs_in_value() -> None:
    block = _block({"key": "${a}_${b}"})
    resolve_configurations(block, {"a": "hello", "b": "world"})
    assert block.configuration_values["key"] == "hello_world"


def test_resolve_configurations_multiple_keys() -> None:
    block = _block({"k1": "${x}", "k2": "static", "k3": "${y}"})
    resolve_configurations(block, {"x": "X_VAL", "y": "Y_VAL"})
    assert block.configuration_values["k1"] == "X_VAL"
    assert block.configuration_values["k2"] == "static"
    assert block.configuration_values["k3"] == "Y_VAL"


def test_resolve_configurations_no_templates_unchanged() -> None:
    block = _block({"key": "plain_value"})
    resolve_configurations(block, {"runId": "abc"})
    assert block.configuration_values["key"] == "plain_value"


def test_resolve_configurations_mutates_in_place() -> None:
    block = _block({"key": "${var}"})
    original_dict = block.configuration_values
    resolve_configurations(block, {"var": "resolved"})
    assert block.configuration_values is original_dict
    assert block.configuration_values["key"] == "resolved"


# ---------------------------------------------------------------------------
# value_dt2str
# ---------------------------------------------------------------------------


def test_value_dt2str_format() -> None:
    d = dt.datetime(2026, 3, 15, 12, 5, 9)
    assert value_dt2str(d) == "2026-03-15 12:05:09"


def test_value_dt2str_midnight() -> None:
    d = dt.datetime(2026, 1, 1, 0, 0, 0)
    assert value_dt2str(d) == "2026-01-01 00:00:00"
