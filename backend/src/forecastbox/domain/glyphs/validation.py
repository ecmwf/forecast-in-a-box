# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Shared validation of glyph names -- used both when a global glyph is created/updated
and when a BlueprintBuilder's local glyphs are validated.

A glyph name is rejected if it collides with either an intrinsic glyph name (``runId``,
etc.) or a name reserved by the jinja2 interpolation environment (filters and globals,
e.g. ``timedelta``, ``floor_day``).
"""

from cascade.low.func import Either

from forecastbox.domain.glyphs.intrinsic import get_values_and_examples
from forecastbox.domain.glyphs.jinja_interpolation import is_jinja_reserved_name


def validate_glyph(s: str) -> Either[str, str]:  # type: ignore[invalid-argument]
    """Validate a glyph name against intrinsic glyph names and jinja2 reserved names.

    Returns ``Either.ok(s)`` when ``s`` is a valid glyph name, or ``Either.error(reason)``
    when it clashes with an intrinsic glyph or a jinja2 reserved keyword.
    """
    if s in get_values_and_examples():
        return Either.error(f"clashes with intrinsic glyph {s!r}")
    if is_jinja_reserved_name(s):
        return Either.error(f"clashes with jinja keyword {s!r}")
    return Either.ok(s)
