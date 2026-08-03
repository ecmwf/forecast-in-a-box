# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for domain/glyphs/validation and the jinja-reserved-name predicate."""

from forecastbox.domain.glyphs.intrinsic import get_values_and_examples
from forecastbox.domain.glyphs.jinja_interpolation import is_jinja_reserved_name
from forecastbox.domain.glyphs.validation import validate_glyph

# ---------------------------------------------------------------------------
# is_jinja_reserved_name
# ---------------------------------------------------------------------------


def test_is_jinja_reserved_name_true_for_filter() -> None:
    assert is_jinja_reserved_name("floor_day") is True


def test_is_jinja_reserved_name_true_for_global() -> None:
    assert is_jinja_reserved_name("timedelta") is True
    assert is_jinja_reserved_name("datetime") is True


def test_is_jinja_reserved_name_false_for_regular_name() -> None:
    assert is_jinja_reserved_name("myCustomGlyph") is False


# ---------------------------------------------------------------------------
# validate_glyph
# ---------------------------------------------------------------------------


def test_validate_glyph_ok_for_regular_name() -> None:
    result = validate_glyph("myCustomGlyph")
    assert result.e is None
    assert result.t == "myCustomGlyph"


def test_validate_glyph_rejects_intrinsic_name() -> None:
    intrinsic_name = next(iter(get_values_and_examples()))
    result = validate_glyph(intrinsic_name)
    assert result.t is None
    assert result.e is not None
    assert "intrinsic glyph" in result.e
    assert repr(intrinsic_name) in result.e


def test_validate_glyph_rejects_jinja_reserved_name() -> None:
    result = validate_glyph("timedelta")
    assert result.t is None
    assert result.e is not None
    assert "jinja keyword" in result.e
    assert repr("timedelta") in result.e


def test_validate_glyph_intrinsic_check_takes_precedence() -> None:
    # Sanity check: none of the intrinsic names currently collide with jinja reserved
    # names, so the two checks are independently exercised. If this ever changes, the
    # intrinsic check should win (it is checked first in validate_glyph).
    intrinsic_names = set(get_values_and_examples())
    assert not any(is_jinja_reserved_name(name) for name in intrinsic_names)
