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

_GLYPH_PATTERN = re.compile(r"\$\{(\w+)\}")


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


def _extract_glyph_names_from_value(value: str) -> set[str]:
    return set(_GLYPH_PATTERN.findall(value))


def _substitute_glyphs(value: str, glyph_values: dict[str, str]) -> str:
    return _GLYPH_PATTERN.sub(lambda m: glyph_values[m.group(1)], value)


def extract_glyphs(blockInstance: BlockInstance) -> Either[ExtractedGlyphs, list[str]]:  # type: ignore[invalid-argument]
    """Extract all ${glyph} references from the blockInstance's configuration_values.

    Always succeeds; returns an ExtractedGlyphs with the set of referenced glyph names
    and the set of option keys that contain at least one glyph. The error branch is
    reserved for future validation (e.g. malformed templates).
    """
    glyphs: set[str] = set()
    glyphed_options: set[str] = set()
    for key, value in blockInstance.configuration_values.items():
        names = _extract_glyph_names_from_value(value)
        if names:
            glyphs.update(names)
            glyphed_options.add(key)
    return Either.ok(ExtractedGlyphs(glyphs=glyphs, glyphed_options=glyphed_options))


def resolve_configurations(blockInstance: BlockInstance, glyph_values: dict[str, str]) -> None:
    """Mutate blockInstance's configuration_values, replacing ${glyph} patterns with their values.

    All glyphs referenced must be present in glyph_values. Call extract_glyphs
    and validate the set against available glyphs before invoking this function.
    """
    for key, value in blockInstance.configuration_values.items():
        blockInstance.configuration_values[key] = _substitute_glyphs(value, glyph_values)


def merge_glyph_values(
    intrinsic_values: dict[str, str],
    global_values: dict[str, str],
    local_values: dict[str, str],
    context_values: dict[str, str],
) -> dict[str, str]:
    """Merge glyphs from all four sources into a single resolution map.

    Resolution order (lowest to highest precedence): intrinsic < global < local < context.
    Intrinsic pinned keys (``startDatetime``, ``attemptCount``) always win regardless,
    so that each restart records its own actual values.
    """
    merged = {**intrinsic_values, **global_values, **local_values, **context_values}
    for pinned in ("startDatetime", "attemptCount"):
        if pinned in intrinsic_values:
            merged[pinned] = intrinsic_values[pinned]
    return merged


def expand_glyph_values(glyph_values: dict[str, str]) -> dict[str, str]:
    """Expand glyph values that themselves reference other glyphs using DFS.

    A glyph value like ``${root}/${runId}`` will be expanded to its fully-resolved
    string when ``root`` and ``runId`` are present in ``glyph_values``. Unknown
    references (keys absent from ``glyph_values``) are kept as-is so that the
    normal block-level unknown-glyph validation can surface them.

    Raises ``GlyphCircularReferenceError`` if any cycle is detected (including
    self-references like ``a = ${a}``).
    """
    result = dict(glyph_values)

    def _expand(key: str, visiting: frozenset[str]) -> str:
        value = result[key]
        if not _GLYPH_PATTERN.search(value):
            return value
        visiting = visiting | {key}

        def substitute(m: re.Match[str]) -> str:
            ref = m.group(1)
            if ref not in result:
                return m.group(0)
            if ref in visiting:
                cycle_path = " -> ".join(sorted(visiting)) + f" -> {ref}"
                raise GlyphCircularReferenceError(f"Circular glyph reference detected: {cycle_path}")
            return _expand(ref, visiting)

        expanded = _GLYPH_PATTERN.sub(substitute, value)
        result[key] = expanded
        return expanded

    for key in list(result.keys()):
        result[key] = _expand(key, frozenset())
    return result
