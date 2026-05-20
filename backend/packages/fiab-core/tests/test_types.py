# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for FableType and its subclasses."""

from datetime import date, datetime

import pytest

from fiab_core.types import (
    ClosedEnumType,
    DatetimeType,
    DateType,
    FableType,
    FloatType,
    IntType,
    ListType,
    NotFableType,
    NotStringInput,
    OpenEnumType,
    StringType,
    WrongType,
)


class TestStringType:
    """Tests for StringType"""

    def test_convert_valid_string(self) -> None:
        t = StringType()
        assert t.validate_convert("hello") == "hello"
        assert t.validate_convert("") == ""
        assert t.validate_convert("123") == "123"

    def test_convert_non_string_raises_type_error(self) -> None:
        t = StringType()
        with pytest.raises(NotStringInput):
            t.validate_convert(123)
        with pytest.raises(NotStringInput):
            t.validate_convert(None)
        with pytest.raises(NotStringInput):
            t.validate_convert(["hello"])


class TestIntType:
    """Tests for IntType"""

    def test_convert_valid_strings(self) -> None:
        t = IntType()
        assert t.validate_convert("42") == 42
        assert t.validate_convert("-42") == -42
        assert t.validate_convert("0") == 0

    def test_convert_invalid_string_raises_value_error(self) -> None:
        t = IntType()
        with pytest.raises(WrongType):
            t.validate_convert("not_an_int")
        with pytest.raises(WrongType):
            t.validate_convert("42.5")

    def test_convert_non_string_raises_type_error(self) -> None:
        t = IntType()
        with pytest.raises(NotStringInput):
            t.validate_convert(42)
        with pytest.raises(NotStringInput):
            t.validate_convert(None)


class TestFloatType:
    """Tests for FloatType"""

    def test_convert_valid_strings(self) -> None:
        t = FloatType()
        assert t.validate_convert("42.5") == 42.5
        assert t.validate_convert("-42.5") == -42.5
        assert t.validate_convert("0.0") == 0.0
        assert t.validate_convert("42") == 42.0

    def test_convert_invalid_string_raises_value_error(self) -> None:
        t = FloatType()
        with pytest.raises(WrongType):
            t.validate_convert("not_a_float")

    def test_convert_non_string_raises_type_error(self) -> None:
        t = FloatType()
        with pytest.raises(NotStringInput):
            t.validate_convert(42.5)
        with pytest.raises(NotStringInput):
            t.validate_convert(None)


class TestDateType:
    """Tests for DateType"""

    def test_convert_valid_iso_date(self) -> None:
        t = DateType()
        result = t.validate_convert("2026-05-08")
        assert result == date(2026, 5, 8)

    def test_convert_invalid_format_raises_value_error(self) -> None:
        t = DateType()
        with pytest.raises(WrongType):
            t.validate_convert("05/08/2026")
        with pytest.raises(WrongType):
            t.validate_convert("2026-05-08 10:30:00")
        with pytest.raises(WrongType):
            t.validate_convert("invalid_date")

    def test_convert_non_string_raises_type_error(self) -> None:
        t = DateType()
        with pytest.raises(NotStringInput):
            t.validate_convert(date(2026, 5, 8))
        with pytest.raises(NotStringInput):
            t.validate_convert(None)


class TestDatetimeType:
    """Tests for DatetimeType"""

    def test_convert_valid_iso_datetime(self) -> None:
        t = DatetimeType()
        result = t.validate_convert("2026-05-08T10:30:45")
        assert result == datetime(2026, 5, 8, 10, 30, 45)

    def test_convert_iso_datetime_with_microseconds(self) -> None:
        t = DatetimeType()
        result = t.validate_convert("2026-05-08T10:30:45.123456")
        assert result == datetime(2026, 5, 8, 10, 30, 45, 123456)

    def test_convert_iso_datetime_with_timezone(self) -> None:
        t = DatetimeType()
        result = t.validate_convert("2026-05-08T10:30:45+00:00")
        assert result.year == 2026
        assert result.month == 5
        assert result.day == 8

    def test_convert_invalid_format_raises_value_error(self) -> None:
        t = DatetimeType()
        with pytest.raises(WrongType):
            t.validate_convert("2026-05-08")
        with pytest.raises(WrongType):
            t.validate_convert("invalid_datetime")

    def test_convert_non_string_raises_type_error(self) -> None:
        t = DatetimeType()
        with pytest.raises(NotStringInput):
            t.validate_convert(datetime.now())
        with pytest.raises(NotStringInput):
            t.validate_convert(None)


class TestClosedEnumType:
    """Tests for ClosedEnumType"""

    def test_convert_valid_enum_value(self) -> None:
        t = ClosedEnumType(["option1", "option2", "option3"])
        assert t.validate_convert("option1") == "option1"
        assert t.validate_convert("option2") == "option2"

    def test_convert_invalid_enum_value_raises_value_error(self) -> None:
        t = ClosedEnumType(["option1", "option2"])
        with pytest.raises(WrongType):
            t.validate_convert("invalid_option")

    def test_convert_non_string_raises_type_error(self) -> None:
        t = ClosedEnumType(["option1", "option2"])
        with pytest.raises(NotStringInput):
            t.validate_convert(123)
        with pytest.raises(NotStringInput):
            t.validate_convert(None)

    def test_enum_is_case_sensitive(self) -> None:
        t = ClosedEnumType(["Option1", "Option2"])
        assert t.validate_convert("Option1") == "Option1"
        with pytest.raises(WrongType):
            t.validate_convert("option1")


class TestOpenEnumType:
    """Tests for OpenEnumType"""

    def test_convert_any_string(self) -> None:
        t = OpenEnumType(["option1", "option2"])
        assert t.validate_convert("option1") == "option1"
        assert t.validate_convert("any_value") == "any_value"
        assert t.validate_convert("") == ""

    def test_convert_non_string_raises_type_error(self) -> None:
        t = OpenEnumType(["option1", "option2"])
        with pytest.raises(NotStringInput):
            t.validate_convert(123)
        with pytest.raises(NotStringInput):
            t.validate_convert(None)


class TestListType:
    """Tests for ListType"""

    def test_convert_valid_int_list(self) -> None:
        t = ListType(IntType())
        assert t.validate_convert("1,2,3") == [1, 2, 3]
        assert t.validate_convert("42") == [42]

    def test_convert_empty_string_to_empty_list(self) -> None:
        t = ListType(IntType())
        assert t.validate_convert("") == []

    def test_convert_list_with_whitespace(self) -> None:
        t = ListType(IntType())
        assert t.validate_convert("1, 2, 3") == [1, 2, 3]
        assert t.validate_convert(" 1 , 2 , 3 ") == [1, 2, 3]

    def test_convert_list_with_invalid_item_raises_error(self) -> None:
        t = ListType(IntType())
        with pytest.raises(WrongType):
            t.validate_convert("1,not_an_int,3")

    def test_convert_list_of_strings(self) -> None:
        t = ListType(StringType())
        assert t.validate_convert("a,b,c") == ["a", "b", "c"]

    def test_convert_list_of_floats(self) -> None:
        t = ListType(FloatType())
        assert t.validate_convert("1.5,2.5,3.5") == [1.5, 2.5, 3.5]

    def test_convert_list_of_enum_values(self) -> None:
        t = ListType(ClosedEnumType(["option1", "option2"]))
        assert t.validate_convert("option1,option2,option1") == [
            "option1",
            "option2",
            "option1",
        ]
        with pytest.raises(WrongType):
            t.validate_convert("option1,invalid,option2")

    def test_convert_non_string_raises_type_error(self) -> None:
        t = ListType(IntType())
        with pytest.raises(NotStringInput):
            t.validate_convert(["1", "2", "3"])
        with pytest.raises(NotStringInput):
            t.validate_convert(None)


class TestFableTypeParse:
    """Tests for FableType.parse"""

    def test_parse_atomic_types(self) -> None:
        assert isinstance(FableType.parse("str"), StringType)
        assert isinstance(FableType.parse("int"), IntType)
        assert isinstance(FableType.parse("float"), FloatType)
        assert isinstance(FableType.parse("date"), DateType)
        assert isinstance(FableType.parse("datetime"), DatetimeType)

    def test_parse_whitespace_handling(self) -> None:
        assert isinstance(FableType.parse("  str  "), StringType)
        assert isinstance(FableType.parse(" int "), IntType)

    def test_parse_closed_enum(self) -> None:
        t = FableType.parse("enumClosed[option1,option2,option3]")
        assert isinstance(t, ClosedEnumType)
        assert t.validate_convert("option1") == "option1"
        with pytest.raises(WrongType):
            t.validate_convert("invalid")

    def test_parse_open_enum(self) -> None:
        t = FableType.parse("enumOpen[option1,option2]")
        assert isinstance(t, OpenEnumType)
        assert t.validate_convert("any_value") == "any_value"

    def test_parse_list_of_int(self) -> None:
        t = FableType.parse("list[int]")
        assert isinstance(t, ListType)
        assert t.validate_convert("1,2,3") == [1, 2, 3]

    def test_parse_list_of_string(self) -> None:
        t = FableType.parse("list[str]")
        assert isinstance(t, ListType)
        assert t.validate_convert("a,b,c") == ["a", "b", "c"]

    def test_parse_list_of_enum(self) -> None:
        t = FableType.parse("list[enumClosed[a,b]]")
        assert isinstance(t, ListType)
        assert isinstance(t.item_type, ClosedEnumType)
        assert t.validate_convert("a,b,a") == ["a", "b", "a"]
        assert t.serialize() == "list[enumClosed[a,b]]"

    def test_parse_nested_lists_raises_error(self) -> None:
        with pytest.raises(NotFableType):
            FableType.parse("list[list[int]]")

    def test_parse_invalid_type_raises_error(self) -> None:
        with pytest.raises(NotFableType):
            FableType.parse("invalid_type")
        with pytest.raises(NotFableType):
            FableType.parse("string")

    def test_parse_empty_enum_raises_error(self) -> None:
        with pytest.raises(NotFableType):
            FableType.parse("enumClosed[]")
        with pytest.raises(NotFableType):
            FableType.parse("enumOpen[]")

    def test_parse_list_with_whitespace(self) -> None:
        t = FableType.parse("list[ int ]")
        assert isinstance(t, ListType)

    def test_parse_enum_with_whitespace(self) -> None:
        t = FableType.parse("enumClosed[ a , b , c ]")
        assert isinstance(t, ClosedEnumType)
        assert t.validate_convert("a") == "a"

    def test_parse_enum_with_quoted_items(self) -> None:
        t = FableType.parse("enumClosed['a', 'b', 'c']")
        assert isinstance(t, ClosedEnumType)
        assert t.validate_convert("b") == "b"


class TestValidateConvertIntegration:
    """Integration tests for validate_convert with various types"""

    def test_round_trip_conversion(self) -> None:
        cases = [
            ("str", "hello world", "hello world"),
            ("int", "42", 42),
            ("float", "3.14", 3.14),
            ("date", "2026-05-08", date(2026, 5, 8)),
            ("datetime", "2026-05-08T10:30:45", datetime(2026, 5, 8, 10, 30, 45)),
            ("enumClosed[a,b,c]", "b", "b"),
            ("enumOpen[x,y]", "any_value", "any_value"),
            ("list[int]", "1,2,3", [1, 2, 3]),
            ("list[str]", "a,b,c", ["a", "b", "c"]),
        ]

        for type_expr, input_val, expected in cases:
            fable_type = FableType.parse(type_expr)
            result = fable_type.validate_convert(input_val)
            assert result == expected, f"Failed for {type_expr}"

    def test_error_propagation(self) -> None:
        """Test that type errors and value errors propagate correctly"""
        t = FableType.parse("list[int]")
        with pytest.raises(WrongType):
            t.validate_convert("1,not_int,3")

        with pytest.raises(NotStringInput):
            t.validate_convert(123)
