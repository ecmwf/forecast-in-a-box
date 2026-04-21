# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Core parsing and resolution of ${glyph} interpolation in BlockInstance configuration values."""

import datetime as dt
import re
from dataclasses import dataclass

from cascade.low.func import Either
from fiab_core.fable import BlockInstance

from forecastbox.domain.glyphs.exceptions import GlyphCircularReferenceError
from forecastbox.domain.glyphs.jinja_interpolation import extract_glyph_names, render_expression

# Used only by expand_glyph_values for simple ${varname} chain detection and substitution.
_GLYPH_PATTERN = re.compile(r"\$\{(\w+)\}")

PINNED_INTRINSIC_KEYS: frozenset[str] = frozenset({"startDatetime", "attemptCount"})
"""Intrinsic glyph keys that are always forced to their fresh intrinsic value in each attempt,
regardless of any stored context value. These must NOT be persisted in the runtime context
so that restarts always reflect the new attempt's own start time and attempt counter."""


@dataclass(frozen=True, eq=True, slots=True)
class ExtractedGlyphs:
    glyphs: set[str]
    """All glyph names referenced across all configuration_values."""
    glyphed_options: set[str]
    """Keys from configuration_values that contain at least one glyph reference."""


def value_dt2str(value: dt.datetime) -> str:
    """Convert a datetime to the canonical string format used for all runtime glyphs.

    To ensure that all runtime glyphs are stringified the same way.
    """
    return value.strftime("%Y-%m-%d %H:%M:%S")


def extract_glyphs(blockInstance: BlockInstance) -> Either[ExtractedGlyphs, list[str]]:  # type: ignore[invalid-argument]
    """Extract all ${...} references from the blockInstance's configuration_values.

    Returns an ``Either.ok`` with the set of referenced glyph names and the set of
    option keys that contain at least one glyph reference, or ``Either.err`` with a
    list of error messages if any configuration value contains a malformed expression.
    """
    glyphs: set[str] = set()
    glyphed_options: set[str] = set()
    errors: list[str] = []
    for key, value in blockInstance.configuration_values.items():
        result = extract_glyph_names(value)
        if result.e is not None:
            errors.append(f"{key!r}: {result.e}")
            continue
        if result.t:
            glyphs.update(result.t)
            glyphed_options.add(key)
    if errors:
        return Either.error(errors)
    return Either.ok(ExtractedGlyphs(glyphs=glyphs, glyphed_options=glyphed_options))


def resolve_configurations(blockInstance: BlockInstance, glyph_values: dict[str, str]) -> None:
    """Mutate blockInstance's configuration_values, evaluating ${...} expressions against glyph_values.

    Supports the full Jinja2 expression language with custom date/string filters.
    All glyphs referenced must be present in glyph_values. Call extract_glyphs
    and validate the set against available glyphs before invoking this function.
    """
    for key, value in blockInstance.configuration_values.items():
        blockInstance.configuration_values[key] = render_expression(value, glyph_values)


def merge_glyph_values(
    intrinsic_values: dict[str, str],
    public_overriddable_values: dict[str, str],
    user_values: dict[str, str],
    public_nonoverridable_values: dict[str, str],
    local_values: dict[str, str],
    context_values: dict[str, str],
) -> dict[str, str]:
    """Merge glyphs from all sources into a single resolution map.

    Resolution order (lowest to highest precedence):
    intrinsic < public_overriddable < user_own < public_nonoverridable < local < context.

    Intrinsic pinned keys (``startDatetime``, ``attemptCount``) always win regardless,
    so that each restart records its own actual values.
    """
    merged = {
        **intrinsic_values,
        **public_overriddable_values,
        **user_values,
        **public_nonoverridable_values,
        **local_values,
        **context_values,
    }
    for pinned in PINNED_INTRINSIC_KEYS:
        if pinned in intrinsic_values:
            merged[pinned] = intrinsic_values[pinned]
    return merged


def expand_glyph_values(glyph_values: dict[str, str], roots: set[str] | None = None) -> dict[str, str]:
    """Expand glyph values that themselves reference other glyphs using DFS.

    A glyph value like ``${root}/${runId}`` will be expanded to its fully-resolved
    string when ``root`` and ``runId`` are present in ``glyph_values``. Unknown
    references (keys absent from ``glyph_values``) are kept as-is so that the
    normal block-level unknown-glyph validation can surface them.

    When ``roots`` is provided, only the keys in ``roots`` and their transitive
    dependencies are visited and returned. This is useful when callers only need
    a subset of the expanded map — for example, to determine which raw glyph values
    to persist for a run. When ``roots`` is ``None`` (the default), all keys are
    expanded and the full map is returned.

    Raises ``GlyphCircularReferenceError`` if any cycle is detected (including
    self-references like ``a = ${a}``).
    """
    source = glyph_values
    memo: dict[str, str] = {}

    def _expand(key: str, visiting: frozenset[str]) -> str:
        if key in memo:
            return memo[key]
        value = source[key]
        if not _GLYPH_PATTERN.search(value):
            memo[key] = value
            return value
        visiting = visiting | {key}

        def substitute(m: re.Match[str]) -> str:
            ref = m.group(1)
            if ref not in source:
                return m.group(0)
            if ref in visiting:
                cycle_path = " -> ".join(sorted(visiting)) + f" -> {ref}"
                raise GlyphCircularReferenceError(f"Circular glyph reference detected: {cycle_path}")
            return _expand(ref, visiting)

        expanded = _GLYPH_PATTERN.sub(substitute, value)
        memo[key] = expanded
        return expanded

    for key in roots if roots is not None else list(source.keys()):
        if key in source:
            _expand(key, frozenset())

    return dict(memo) if roots is not None else {k: memo[k] for k in source}
