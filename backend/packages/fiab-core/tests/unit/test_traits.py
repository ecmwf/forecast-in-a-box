# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for FableTrait and its subclasses, and their integration with FableType."""

from datetime import timedelta

import pytest

from fiab_core.types.definitions import FloatType, IntType, TimeDeltaType, UnionType
from fiab_core.types.exceptions import NotFableType, WrongType
from fiab_core.types.parser import parse
from fiab_core.types.traits import DivisibleBy, NonNegative, Positive


class TestPositive:
    """Tests for the Positive trait"""

    def test_validate_numbers(self) -> None:
        t = Positive()
        assert t.validate(1).e is None
        assert t.validate(0.5).e is None
        assert t.validate(0).e is not None
        assert t.validate(-1).e is not None

    def test_validate_timedelta(self) -> None:
        t = Positive()
        assert t.validate(timedelta(days=1)).e is None
        assert t.validate(timedelta(0)).e is not None
        assert t.validate(timedelta(days=-1)).e is not None

    def test_serialize(self) -> None:
        assert Positive().serialize() == "positive"


class TestNonNegative:
    """Tests for the NonNegative trait"""

    def test_validate_numbers(self) -> None:
        t = NonNegative()
        assert t.validate(1).e is None
        assert t.validate(0).e is None
        assert t.validate(-1).e is not None

    def test_validate_timedelta(self) -> None:
        t = NonNegative()
        assert t.validate(timedelta(0)).e is None
        assert t.validate(timedelta(days=-1)).e is not None

    def test_serialize(self) -> None:
        assert NonNegative().serialize() == "nonNegative"


class TestDivisibleBy:
    """Tests for the DivisibleBy trait"""

    def test_validate_int(self) -> None:
        t = DivisibleBy("3")
        assert t.validate(9).e is None
        assert t.validate(10).e is not None

    def test_validate_float(self) -> None:
        t = DivisibleBy("1.5")
        assert t.validate(3.0).e is None
        assert t.validate(2.0).e is not None

    def test_validate_timedelta_with_duration_arg(self) -> None:
        t = DivisibleBy("P1D")
        assert t.validate(timedelta(days=3)).e is None
        assert t.validate(timedelta(hours=12)).e is not None

    def test_validate_timedelta_with_numeric_arg_fails_gracefully(self) -> None:
        # "3" parses as a number, but not as a timedelta, so it cannot be applied to a timedelta
        t = DivisibleBy("3")
        result = t.validate(timedelta(days=3))
        assert result.e is not None

    def test_construction_fails_for_unparseable_argument(self) -> None:
        with pytest.raises(WrongType):
            DivisibleBy("not_a_number_or_duration")

    def test_serialize(self) -> None:
        assert DivisibleBy("3").serialize() == "divisibleBy(3)"
        assert DivisibleBy("P1D").serialize() == "divisibleBy(P1D)"

    def test_accepts_int_argument(self) -> None:
        t = DivisibleBy(3)
        assert t.validate(9).e is None
        assert t.validate(10).e is not None
        assert t.serialize() == "divisibleBy(3)"

    def test_accepts_float_argument(self) -> None:
        t = DivisibleBy(1.5)
        assert t.validate(3.0).e is None
        assert t.validate(2.0).e is not None
        assert t.serialize() == "divisibleBy(1.5)"

    def test_accepts_timedelta_argument(self) -> None:
        t = DivisibleBy(timedelta(hours=1))
        assert t.validate(timedelta(hours=3)).e is None
        assert t.validate(timedelta(minutes=30)).e is not None
        assert t.serialize() == "divisibleBy(PT1H)"

    def test_int_argument_does_not_apply_to_timedelta(self) -> None:
        t = DivisibleBy(3)
        result = t.validate(timedelta(days=3))
        assert result.e is not None

    def test_timedelta_argument_does_not_apply_to_int(self) -> None:
        t = DivisibleBy(timedelta(hours=1))
        result = t.validate(3)
        assert result.e is not None


class TestTraitsOnFableType:
    """Integration tests for traits mixed into FableType via the parser."""

    def test_int_with_single_trait(self) -> None:
        t = parse("int{positive}")
        assert isinstance(t, IntType)
        assert t.serialize() == "int{positive}"
        assert t.validate_convert("5") == 5
        with pytest.raises(WrongType):
            t.validate_convert("0")
        with pytest.raises(WrongType):
            t.validate_convert("-5")

    def test_float_with_single_trait(self) -> None:
        t = parse("float{nonNegative}")
        assert isinstance(t, FloatType)
        assert t.serialize() == "float{nonNegative}"
        assert t.validate_convert("0") == 0.0
        with pytest.raises(WrongType):
            t.validate_convert("-0.5")

    def test_int_with_multiple_traits(self) -> None:
        t = parse("int{positive, divisibleBy(3)}")
        assert t.serialize() == "int{positive,divisibleBy(3)}"
        assert t.validate_convert("9") == 9
        with pytest.raises(WrongType):
            t.validate_convert("10")
        with pytest.raises(WrongType):
            t.validate_convert("-3")

    def test_multiple_trait_failures_are_all_collected(self) -> None:
        t = parse("int{positive, divisibleBy(3)}")
        with pytest.raises(WrongType, match="is not positive") as exc_info:
            t.validate_convert("-10")
        assert "is not divisible by 3" in str(exc_info.value)

    def test_timedelta_with_divisible_by_duration(self) -> None:
        t = parse("timedelta{divisibleBy(P1D)}")
        assert isinstance(t, TimeDeltaType)
        assert t.serialize() == "timedelta{divisibleBy(P1D)}"
        assert t.validate_convert("P3D") == timedelta(days=3)
        with pytest.raises(WrongType):
            t.validate_convert("PT12H")

    def test_union_with_trait_applies_after_member_conversion(self) -> None:
        t = parse("union[int,float]{nonNegative}")
        assert isinstance(t, UnionType)
        assert t.serialize() == "union[int,float]{nonNegative}"
        assert t.validate_convert("5") == 5
        assert t.validate_convert("5.5") == 5.5
        with pytest.raises(WrongType):
            t.validate_convert("-5")

    def test_list_of_trait_type(self) -> None:
        t = parse("list[int{positive}]")
        assert t.serialize() == "list[int{positive}]"
        assert t.validate_convert("1,2,3") == [1, 2, 3]
        with pytest.raises(WrongType):
            t.validate_convert("1,-2,3")

    def test_trait_is_skipped_when_main_conversion_fails(self) -> None:
        t = parse("int{positive}")
        with pytest.raises(WrongType, match="Cannot convert"):
            t.validate_convert("not_an_int")

    def test_unknown_trait_raises_error(self) -> None:
        with pytest.raises(ValueError):
            parse("int{unknownTrait}")

    def test_empty_traits_raises_error(self) -> None:
        with pytest.raises(ValueError):
            parse("int{}")

    def test_trait_without_required_argument_raises_error(self) -> None:
        with pytest.raises(ValueError):
            parse("int{divisibleBy}")

    def test_no_traits_serializes_without_braces(self) -> None:
        assert parse("int").serialize() == "int"

    def test_parse_internal_unknown_trait_raises_not_fable_type(self) -> None:
        from fiab_core.types.parser import _parse_trait

        with pytest.raises(NotFableType):
            _parse_trait("unknownTrait")
