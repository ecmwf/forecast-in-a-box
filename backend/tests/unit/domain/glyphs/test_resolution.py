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
from fiab_core.fable import (
    BlockFactoryId,
    BlockInstance,
    ConfigurationOptionId,
    PluginBlockFactoryId,
    PluginCompositeId,
    PluginId,
    PluginStoreId,
)

from forecastbox.domain.glyphs.exceptions import GlyphCircularReferenceError
from forecastbox.domain.glyphs.resolution import ExtractedGlyphs, expand_glyph_values, extract_glyphs, resolve_configurations, value_dt2str


def _block(config: dict[str, str]) -> BlockInstance:
    return BlockInstance(
        factory_id=PluginBlockFactoryId(
            plugin=PluginCompositeId(store=PluginStoreId("test"), local=PluginId("test")),
            factory=BlockFactoryId("test_factory"),
        ),
        configuration_values={ConfigurationOptionId(key): value for key, value in config.items()},
        input_ids={},
    )


def _value(block: BlockInstance, key: str) -> str:
    return block.configuration_values[ConfigurationOptionId(key)]


def _cid(key: str) -> ConfigurationOptionId:
    return ConfigurationOptionId(key)


# ---------------------------------------------------------------------------
# extract_glyphs
# ---------------------------------------------------------------------------


def test_extract_glyphs_no_glyphs() -> None:
    block = _block({"key": "plain_value"})
    result = extract_glyphs(block)
    assert result.e is None
    assert result.t == ExtractedGlyphs(glyphs=set(), glyphed_options=set())


def test_extract_glyphs_single() -> None:
    block = _block({"key": "${myVar}"})
    result = extract_glyphs(block)
    assert result.e is None
    assert result.t == ExtractedGlyphs(glyphs={"myVar"}, glyphed_options={_cid("key")})


def test_extract_glyphs_multiple_in_one_value() -> None:
    block = _block({"key": "${var1}_${var2}"})
    result = extract_glyphs(block)
    assert result.e is None
    assert result.t == ExtractedGlyphs(glyphs={"var1", "var2"}, glyphed_options={_cid("key")})


def test_extract_glyphs_across_multiple_keys() -> None:
    block = _block({"key1": "${var1}", "key2": "${var2}"})
    result = extract_glyphs(block)
    assert result.e is None
    assert result.t == ExtractedGlyphs(glyphs={"var1", "var2"}, glyphed_options={_cid("key1"), _cid("key2")})


def test_extract_glyphs_deduplicates() -> None:
    block = _block({"a": "${runId}", "b": "prefix_${runId}_suffix"})
    result = extract_glyphs(block)
    assert result.e is None
    assert result.t == ExtractedGlyphs(glyphs={"runId"}, glyphed_options={_cid("a"), _cid("b")})


def test_extract_glyphs_mixed_plain_and_template() -> None:
    block = _block({"a": "static", "b": "${dynamic}"})
    result = extract_glyphs(block)
    assert result.e is None
    assert result.t == ExtractedGlyphs(glyphs={"dynamic"}, glyphed_options={_cid("b")})


# ---------------------------------------------------------------------------
# resolve_configurations
# ---------------------------------------------------------------------------


def test_resolve_configurations_full_substitution() -> None:
    block = _block({"key": "${myVar}"})
    resolve_configurations(block, {"myVar": "hello"})
    assert _value(block, "key") == "hello"


def test_resolve_configurations_partial_substitution() -> None:
    block = _block({"key": "prefix_${myVar}_suffix"})
    resolve_configurations(block, {"myVar": "world"})
    assert _value(block, "key") == "prefix_world_suffix"


def test_resolve_configurations_multiple_glyphs_in_value() -> None:
    block = _block({"key": "${a}_${b}"})
    resolve_configurations(block, {"a": "hello", "b": "world"})
    assert _value(block, "key") == "hello_world"


def test_resolve_configurations_multiple_keys() -> None:
    block = _block({"k1": "${x}", "k2": "static", "k3": "${y}"})
    resolve_configurations(block, {"x": "X_VAL", "y": "Y_VAL"})
    assert _value(block, "k1") == "X_VAL"
    assert _value(block, "k2") == "static"
    assert _value(block, "k3") == "Y_VAL"


def test_resolve_configurations_no_templates_unchanged() -> None:
    block = _block({"key": "plain_value"})
    resolve_configurations(block, {"runId": "abc"})
    assert _value(block, "key") == "plain_value"


def test_resolve_configurations_mutates_in_place() -> None:
    block = _block({"key": "${var}"})
    original_dict = block.configuration_values
    resolve_configurations(block, {"var": "resolved"})
    assert block.configuration_values is original_dict
    assert _value(block, "key") == "resolved"


# ---------------------------------------------------------------------------
# value_dt2str
# ---------------------------------------------------------------------------


def test_value_dt2str_format() -> None:
    d = dt.datetime(2026, 3, 15, 12, 5, 9)
    assert value_dt2str(d) == "2026-03-15 12:05:09"


def test_value_dt2str_midnight() -> None:
    d = dt.datetime(2026, 1, 1, 0, 0, 0)
    assert value_dt2str(d) == "2026-01-01 00:00:00"


# ---------------------------------------------------------------------------
# expand_glyph_values
# ---------------------------------------------------------------------------


def test_expand_plain_values_unchanged() -> None:
    glyphs = {"a": "hello", "b": "world"}
    result = expand_glyph_values(glyphs)
    assert result == {"a": "hello", "b": "world"}


def test_expand_single_level() -> None:
    glyphs = {"root": "/data", "myPath": "${root}/output"}
    result = expand_glyph_values(glyphs)
    assert result["myPath"] == "/data/output"
    assert result["root"] == "/data"


def test_expand_two_level_chain() -> None:
    glyphs = {"base": "/data", "mid": "${base}/mid", "full": "${mid}/end"}
    result = expand_glyph_values(glyphs)
    assert result["full"] == "/data/mid/end"
    assert result["mid"] == "/data/mid"


def test_expand_multiple_refs_in_one_value() -> None:
    glyphs = {"a": "foo", "b": "bar", "combined": "${a}_${b}"}
    result = expand_glyph_values(glyphs)
    assert result["combined"] == "foo_bar"


def test_expand_unknown_ref_kept_as_literal() -> None:
    """A reference to a key not in glyph_values is preserved as-is."""
    glyphs = {"known": "val", "path": "${known}/${unknown}"}
    result = expand_glyph_values(glyphs)
    assert result["path"] == "val/${unknown}"


def test_expand_does_not_mutate_input() -> None:
    glyphs = {"root": "/data", "myPath": "${root}/output"}
    original = dict(glyphs)
    expand_glyph_values(glyphs)
    assert glyphs == original


def test_expand_self_reference_raises() -> None:
    glyphs = {"a": "${a}"}
    with pytest.raises(GlyphCircularReferenceError):
        expand_glyph_values(glyphs)


def test_expand_mutual_cycle_raises() -> None:
    glyphs = {"a": "${b}", "b": "${a}"}
    with pytest.raises(GlyphCircularReferenceError):
        expand_glyph_values(glyphs)


def test_expand_longer_cycle_raises() -> None:
    glyphs = {"a": "${b}", "b": "${c}", "c": "${a}"}
    with pytest.raises(GlyphCircularReferenceError):
        expand_glyph_values(glyphs)


def test_expand_mixed_cyclic_and_acyclic() -> None:
    """Acyclic glyphs can be expanded even if other keys form a cycle — cycle raises."""
    glyphs = {"root": "/data", "path": "${root}/output", "x": "${y}", "y": "${x}"}
    with pytest.raises(GlyphCircularReferenceError):
        expand_glyph_values(glyphs)


def test_expand_composite_with_intrinsic_style_value() -> None:
    """Models the real use-case: local composite glyph referencing global and intrinsic."""
    glyphs = {"runId": "abc123", "root": "/data", "myPath": "${root}/${runId}"}
    result = expand_glyph_values(glyphs)
    assert result["myPath"] == "/data/abc123"


# ---------------------------------------------------------------------------
# expand_glyph_values with roots parameter
# ---------------------------------------------------------------------------


def test_expand_roots_returns_only_reachable_keys() -> None:
    glyphs = {"root": "/data", "myPath": "${root}/output", "unrelated": "ignored"}
    result = expand_glyph_values(glyphs, roots={"myPath"})
    assert set(result.keys()) == {"myPath", "root"}
    assert result["myPath"] == "/data/output"
    assert result["root"] == "/data"


def test_expand_roots_single_plain_value() -> None:
    glyphs = {"a": "plain", "b": "also_plain"}
    result = expand_glyph_values(glyphs, roots={"a"})
    assert result == {"a": "plain"}


def test_expand_roots_transitive_chain() -> None:
    glyphs = {"base": "/x", "mid": "${base}/y", "full": "${mid}/z", "other": "skip"}
    result = expand_glyph_values(glyphs, roots={"full"})
    assert set(result.keys()) == {"full", "mid", "base"}
    assert result["full"] == "/x/y/z"


def test_expand_roots_unknown_root_key_ignored() -> None:
    """A root key not present in glyph_values is silently skipped."""
    glyphs = {"a": "hello"}
    result = expand_glyph_values(glyphs, roots={"a", "nonexistent"})
    assert result == {"a": "hello"}


def test_expand_roots_cycle_still_raises() -> None:
    glyphs = {"a": "${b}", "b": "${a}"}
    with pytest.raises(GlyphCircularReferenceError):
        expand_glyph_values(glyphs, roots={"a"})


def test_expand_roots_none_equivalent_to_no_roots() -> None:
    glyphs = {"root": "/data", "myPath": "${root}/output"}
    assert expand_glyph_values(glyphs, roots=None) == expand_glyph_values(glyphs)


# ---------------------------------------------------------------------------
# expand_glyph_values — jinja expression support (bug fix regression tests)
# ---------------------------------------------------------------------------


def test_expand_glyph_with_jinja_filter() -> None:
    """A glyph value containing a jinja filter expression is fully evaluated.

    Previously, expand_glyph_values used a regex that only matched ${word} and
    skipped ${submitDatetime | floor_day}, leaving the raw string in the map.
    """
    glyphs = {"submitDatetime": "2024-01-15 06:00:00", "myDate": "${submitDatetime | floor_day}"}
    result = expand_glyph_values(glyphs)
    assert result["myDate"] == "2024-01-15 00:00:00"


def test_expand_nested_glyph_with_jinja_filter() -> None:
    """Transitive expansion works when an intermediate glyph contains a jinja filter."""
    glyphs = {
        "submitDatetime": "2024-01-15 06:00:00",
        "baseDate": "${submitDatetime | floor_day}",
        "path": "${baseDate}/output",
    }
    result = expand_glyph_values(glyphs)
    assert result["baseDate"] == "2024-01-15 00:00:00"
    assert result["path"] == "2024-01-15 00:00:00/output"


def test_expand_glyph_with_mixed_known_filter_and_unknown() -> None:
    """A glyph value mixing a jinja filter on a known ref with an unknown ref.

    The known filter is evaluated; the unknown ref placeholder survives so the
    downstream block-level validation can report it.
    """
    glyphs = {"submitDatetime": "2024-01-15 06:00:00", "mixed": "${submitDatetime | floor_day}/${missing}"}
    result = expand_glyph_values(glyphs)
    assert result["mixed"] == "2024-01-15 00:00:00/${missing}"


def test_expand_glyph_filter_on_unknown_ref_kept_as_is() -> None:
    """When a jinja filter is applied to an unknown ref, the value is kept unchanged.

    Rendering would fail (floor_day on a placeholder string), so we fall back to
    the original value rather than surfacing a cryptic render error.
    """
    glyphs = {"myDate": "${unknownGlyph | floor_day}"}
    result = expand_glyph_values(glyphs)
    assert result["myDate"] == "${unknownGlyph | floor_day}"


def test_expand_glyph_chained_datetime_filters() -> None:
    """Chained filters on a known datetime glyph are fully evaluated."""
    glyphs = {"submitDatetime": "2024-01-15 06:30:00", "rounded": "${submitDatetime | add_days(1) | floor_day}"}
    result = expand_glyph_values(glyphs)
    assert result["rounded"] == "2024-01-16 00:00:00"


# ---------------------------------------------------------------------------
# extract_glyphs — jinja2 expression syntax
# ---------------------------------------------------------------------------


def test_extract_glyphs_datetime_filter_expression() -> None:
    """Datetime filter expressions are parsed; only the variable name is returned."""
    block = _block({"key": "${submitDatetime | add_days(1)}"})
    result = extract_glyphs(block)
    assert result.e is None
    assert result.t == ExtractedGlyphs(glyphs={"submitDatetime"}, glyphed_options={_cid("key")})


def test_extract_glyphs_chained_filters() -> None:
    block = _block({"key": "${submitDatetime | add_days(1) | floor_day}"})
    result = extract_glyphs(block)
    assert result.e is None
    assert result.t == ExtractedGlyphs(glyphs={"submitDatetime"}, glyphed_options={_cid("key")})


def test_extract_glyphs_string_filters() -> None:
    block = _block({"key": "${myParam | upper}"})
    result = extract_glyphs(block)
    assert result.e is None
    assert result.t == ExtractedGlyphs(glyphs={"myParam"}, glyphed_options={_cid("key")})


def test_extract_glyphs_excludes_globals() -> None:
    """timedelta and datetime globals must not appear as glyph names."""
    block = _block({"key": "${submitDatetime + timedelta(days=1)}"})
    result = extract_glyphs(block)
    assert result.e is None
    assert result.t == ExtractedGlyphs(glyphs={"submitDatetime"}, glyphed_options={_cid("key")})


def test_extract_glyphs_pure_arithmetic_no_variables() -> None:
    # A value with ${...} containing only constants/globals (no glyph variable names)
    # must still be added to glyphed_options so it gets rendered and returned in
    # resolved_configuration_options.
    block = _block({"key": "${42 ** 10}"})
    result = extract_glyphs(block)
    assert result.e is None
    assert result.t == ExtractedGlyphs(glyphs=set(), glyphed_options={_cid("key")})


def test_extract_glyphs_multiple_variables_in_expression() -> None:
    block = _block({"key": "${a + b | floor_day}"})
    result = extract_glyphs(block)
    assert result.e is None
    assert result.t == ExtractedGlyphs(glyphs={"a", "b"}, glyphed_options={_cid("key")})


def test_extract_glyphs_malformed_expression_returns_error() -> None:
    block = _block({"key": "${x |}"})
    result = extract_glyphs(block)
    assert result.e is not None
    assert len(result.e) == 1
    assert "'key'" in result.e[0]


# ---------------------------------------------------------------------------
# resolve_configurations — jinja2 datetime filters
# ---------------------------------------------------------------------------

_DT = "2024-01-15 06:00:00"
_GLYPHS = {"submitDatetime": _DT}


def test_resolve_add_days() -> None:
    block = _block({"key": "${submitDatetime | add_days(1)}"})
    resolve_configurations(block, _GLYPHS)
    assert _value(block, "key") == "2024-01-16 06:00:00"


def test_resolve_sub_days() -> None:
    block = _block({"key": "${submitDatetime | sub_days(2)}"})
    resolve_configurations(block, _GLYPHS)
    assert _value(block, "key") == "2024-01-13 06:00:00"


def test_resolve_add_hours() -> None:
    block = _block({"key": "${submitDatetime | add_hours(6)}"})
    resolve_configurations(block, _GLYPHS)
    assert _value(block, "key") == "2024-01-15 12:00:00"


def test_resolve_floor_day() -> None:
    block = _block({"key": "${submitDatetime | floor_day}"})
    resolve_configurations(block, {"submitDatetime": "2024-01-15 06:30:00"})
    assert _value(block, "key") == "2024-01-15 00:00:00"


def test_resolve_floor_hour() -> None:
    block = _block({"key": "${submitDatetime | floor_hour}"})
    resolve_configurations(block, {"submitDatetime": "2024-01-15 06:45:00"})
    assert _value(block, "key") == "2024-01-15 06:00:00"


def test_resolve_chained_datetime_filters() -> None:
    block = _block({"key": "${submitDatetime | add_days(1) | floor_day}"})
    resolve_configurations(block, {"submitDatetime": "2024-01-15 14:30:00"})
    assert _value(block, "key") == "2024-01-16 00:00:00"


def test_resolve_timedelta_global() -> None:
    block = _block({"key": "${submitDatetime + timedelta(days=1)}"})
    resolve_configurations(block, _GLYPHS)
    assert _value(block, "key") == "2024-01-16 06:00:00"


def test_resolve_string_upper() -> None:
    block = _block({"key": "${myParam | upper}"})
    resolve_configurations(block, {"myParam": "hello_world"})
    assert _value(block, "key") == "HELLO_WORLD"


def test_resolve_string_lower() -> None:
    block = _block({"key": "${myParam | lower}"})
    resolve_configurations(block, {"myParam": "Hello"})
    assert _value(block, "key") == "hello"


def test_resolve_string_split_first() -> None:
    block = _block({"key": "${myParam | split('_') | first}"})
    resolve_configurations(block, {"myParam": "hello_world"})
    assert _value(block, "key") == "hello"


def test_resolve_string_replace() -> None:
    block = _block({"key": "${myParam | replace('_', '-')}"})
    resolve_configurations(block, {"myParam": "hello_world"})
    assert _value(block, "key") == "hello-world"


def test_resolve_arithmetic_expression() -> None:
    block = _block({"key": "${x | int * 2 + 1}"})
    resolve_configurations(block, {"x": "7"})
    assert _value(block, "key") == "15"


def test_resolve_pure_arithmetic_literal() -> None:
    block = _block({"key": "${42 ** 2}"})
    resolve_configurations(block, {})
    assert _value(block, "key") == "1764"


def test_resolve_date_like_string_not_coerced() -> None:
    """A date-only string ('2024-01-15') must be passed through as-is without coercion."""
    block = _block({"key": "${myDate}"})
    resolve_configurations(block, {"myDate": "2024-01-15"})
    assert _value(block, "key") == "2024-01-15"


def test_resolve_mixed_literal_and_expression() -> None:
    block = _block({"key": "prefix_${submitDatetime | floor_day}_suffix"})
    resolve_configurations(block, _GLYPHS)
    assert _value(block, "key") == "prefix_2024-01-15 00:00:00_suffix"
