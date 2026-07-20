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
    BoundingBoxWSENType,
    ClosedEnumType,
    DatetimeType,
    DateType,
    FableType,
    FloatType,
    GeoDomainSingleType,
    GeoDomainType,
    IntType,
    ListType,
    NotFableType,
    NotStringInput,
    OpenEnumType,
    StringType,
    UnionType,
    WrongType,
    _parse,
    parse,
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

    def test_serialize_quotes_items(self) -> None:
        assert ClosedEnumType(["option1", "option2"]).serialize() == "enumClosed['option1','option2']"

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

    def test_serialize_quotes_items(self) -> None:
        assert OpenEnumType(["option1", "option2"]).serialize() == "enumOpen['option1','option2']"

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


class TestGeoDomainType:
    """GeoDomainType: comma-separated names, or a west,south,east,north integer bbox validated via BoundingBoxWSENType."""

    def test_parses_as_a_list_type(self) -> None:
        t = parse("geodomain")
        assert isinstance(t, GeoDomainType)
        assert isinstance(t, UnionType)

    def test_serialize(self) -> None:
        assert GeoDomainType().serialize() == "geodomain"
        assert parse("geodomain").serialize() == "geodomain"

    def test_convert_names(self) -> None:
        assert GeoDomainType().validate_convert("Germany,France,Italy") == ["Germany", "France", "Italy"]

    def test_convert_bbox(self) -> None:
        # west,south,east,north
        assert GeoDomainType().validate_convert("-10,35,30,60") == [-10, 35, 30, 60]

    def test_bbox_crossing_antimeridian_is_valid(self) -> None:
        # west > east is a valid box crossing the antimeridian
        assert GeoDomainType().validate_convert("170,-10,-170,10") == [170, -10, -170, 10]

    def test_bbox_south_greater_than_north_raises(self) -> None:
        with pytest.raises(WrongType, match="Cannot convert"):
            GeoDomainType().validate_convert("-10,60,30,35")

    def test_bbox_latitude_out_of_range_raises(self) -> None:
        with pytest.raises(WrongType, match="Cannot convert"):
            GeoDomainType().validate_convert("-10,-100,30,60")

    def test_numeric_but_not_integer_bbox_raises(self) -> None:
        # an almost-bbox must fail loudly instead of being resolved as four region names
        with pytest.raises(WrongType, match="Cannot convert"):
            GeoDomainType().validate_convert("-10.25,35.5,30,60")
        with pytest.raises(WrongType, match="Cannot convert"):
            GeoDomainType().validate_convert("nan,35,30,60")
        with pytest.raises(WrongType, match="Cannot convert"):
            GeoDomainType().validate_convert("-10,35,inf,60")

    def test_four_non_numeric_tokens_are_names(self) -> None:
        value = "Germany,France,Italy,Spain"
        assert GeoDomainType().validate_convert(value) == ["Germany", "France", "Italy", "Spain"]

    @pytest.mark.parametrize("value", ["auto", "global", "datadefined"])
    def test_no_restriction_sentinel_alone_is_valid(self, value: str) -> None:
        assert GeoDomainType().validate_convert(value) == value

    @pytest.mark.parametrize("value", ["auto,Germany", "Germany,auto", "global,Europe"])
    def test_no_restriction_sentinel_is_exclusive(self, value: str) -> None:
        with pytest.raises(WrongType, match=r"Cannot convert.*to any of.*"):
            GeoDomainType().validate_convert(value)

    def test_convert_empty_string_to_empty_list(self) -> None:
        assert GeoDomainType().validate_convert("") == []

    def test_convert_non_string_raises_type_error(self) -> None:
        with pytest.raises(NotStringInput):
            GeoDomainType().validate_convert(["Germany"])


class TestFableTypeParse:
    """Tests for parse"""

    def test_parse_atomic_types(self) -> None:
        assert isinstance(parse("str"), StringType)
        assert isinstance(parse("int"), IntType)
        assert isinstance(parse("float"), FloatType)
        assert isinstance(parse("date"), DateType)
        assert isinstance(parse("datetime"), DatetimeType)

    def test_parse_whitespace_handling(self) -> None:
        assert isinstance(parse("  str  "), StringType)
        assert isinstance(parse(" int "), IntType)

    def test_parse_closed_enum(self) -> None:
        t = parse("enumClosed[option1,option2,option3]")
        assert isinstance(t, ClosedEnumType)
        assert t.serialize() == "enumClosed['option1','option2','option3']"
        assert t.validate_convert("option1") == "option1"
        with pytest.raises(WrongType):
            t.validate_convert("invalid")

    def test_parse_open_enum(self) -> None:
        t = parse("enumOpen[option1,option2]")
        assert isinstance(t, OpenEnumType)
        assert t.serialize() == "enumOpen['option1','option2']"
        assert t.validate_convert("any_value") == "any_value"

    def test_parse_list_of_int(self) -> None:
        t = parse("list[int]")
        assert isinstance(t, ListType)
        assert t.validate_convert("1,2,3") == [1, 2, 3]

    def test_parse_list_of_string(self) -> None:
        t = parse("list[str]")
        assert isinstance(t, ListType)
        assert t.validate_convert("a,b,c") == ["a", "b", "c"]

    def test_parse_list_of_enum(self) -> None:
        t = parse("list[enumClosed[a,b]]")
        assert isinstance(t, ListType)
        assert isinstance(t.item_type, ClosedEnumType)
        assert t.validate_convert("a,b,a") == ["a", "b", "a"]
        assert t.serialize() == "list[enumClosed['a','b']]"

    def test_parse_nested_list_now_supported(self) -> None:
        t = parse("list[list[int]]")
        assert isinstance(t, ListType)
        assert isinstance(t.item_type, ListType)
        # outer comma-split means each inner list gets one element
        assert t.validate_convert("1,2,3") == [[1], [2], [3]]

    def test_parse_invalid_type_raises_error(self) -> None:
        with pytest.raises(ValueError):
            parse("invalid_type")
        with pytest.raises(ValueError, match="Unexpected trailing content"):
            parse("string")

    def test_parse_empty_enum_raises_error(self) -> None:
        with pytest.raises(ValueError):
            parse("enumClosed[]")
        with pytest.raises(ValueError):
            parse("enumOpen[]")

    def test_parse_list_with_whitespace(self) -> None:
        t = parse("list[ int ]")
        assert isinstance(t, ListType)

    def test_parse_enum_with_whitespace(self) -> None:
        t = parse("enumClosed[ a , b , c ]")
        assert isinstance(t, ClosedEnumType)
        assert t.validate_convert("a") == "a"

    def test_parse_enum_with_quoted_items(self) -> None:
        t = parse("enumClosed['a', 'b', 'c']")
        assert isinstance(t, ClosedEnumType)
        assert t.serialize() == "enumClosed['a','b','c']"
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
            fable_type = parse(type_expr)
            result = fable_type.validate_convert(input_val)
            assert result == expected, f"Failed for {type_expr}"

    def test_error_propagation(self) -> None:
        """Test that type errors and value errors propagate correctly"""
        t = parse("list[int]")
        with pytest.raises(WrongType):
            t.validate_convert("1,not_int,3")

        with pytest.raises(NotStringInput):
            t.validate_convert(123)


class TestGeoDomainSingleType:
    """Tests for GeoDomainSingleType"""

    def test_convert_valid_string(self) -> None:
        t = GeoDomainSingleType()
        assert t.validate_convert("France") == "France"
        assert t.validate_convert("GB") == "GB"
        assert t.validate_convert("") == ""

    def test_convert_non_string_raises_type_error(self) -> None:
        t = GeoDomainSingleType()
        with pytest.raises(NotStringInput):
            t.validate_convert(123)
        with pytest.raises(NotStringInput):
            t.validate_convert(None)

    def test_convert_unrestricted_raises_wrong_type(self) -> None:
        t = GeoDomainSingleType()
        with pytest.raises(WrongType):
            t.validate_convert("auto")

    def test_serialize(self) -> None:
        assert GeoDomainSingleType().serialize() == "geodomainSingle"

    def test_parse_and_round_trip(self) -> None:
        t = parse("geodomainSingle")
        assert isinstance(t, GeoDomainSingleType)
        assert t.validate_convert("Germany") == "Germany"
        assert t.serialize() == "geodomainSingle"


class TestBoundingBoxWSENType:
    """Tests for BoundingBoxWSENType"""

    def test_convert_valid_bbox(self) -> None:
        t = BoundingBoxWSENType()
        assert t.validate_convert("-10,40,30,70") == [-10, 40, 30, 70]
        assert t.validate_convert("0,0,0,0") == [0, 0, 0, 0]

    def test_convert_wrong_element_count_raises_error(self) -> None:
        t = BoundingBoxWSENType()
        with pytest.raises(WrongType):
            t.validate_convert("1,2,3")
        with pytest.raises(WrongType):
            t.validate_convert("1,2,3,4,5")
        with pytest.raises(WrongType):
            t.validate_convert("")

    def test_convert_non_integer_elements_raises_error(self) -> None:
        t = BoundingBoxWSENType()
        with pytest.raises(WrongType):
            t.validate_convert("1.5,2,3,4")
        with pytest.raises(WrongType):
            t.validate_convert("a,b,c,d")

    def test_convert_non_string_raises_type_error(self) -> None:
        t = BoundingBoxWSENType()
        with pytest.raises(NotStringInput):
            t.validate_convert([1, 2, 3, 4])
        with pytest.raises(NotStringInput):
            t.validate_convert(None)

    def test_serialize(self) -> None:
        assert BoundingBoxWSENType().serialize() == "bboxWSEN"

    def test_parse_and_round_trip(self) -> None:
        t = parse("bboxWSEN")
        assert isinstance(t, BoundingBoxWSENType)
        assert t.validate_convert("10,20,30,40") == [10, 20, 30, 40]
        assert t.serialize() == "bboxWSEN"

    def test_list_of_bbox_now_supported(self) -> None:
        t = parse("list[bboxWSEN]")
        assert isinstance(t, ListType)
        assert isinstance(t.item_type, BoundingBoxWSENType)
        # list[bboxWSEN] always fails at validate_convert: outer comma-split leaves
        # single-element slots that cannot satisfy bbox's 4-element requirement
        with pytest.raises(WrongType):
            t.validate_convert("1,2,3,4")


class TestUnionType:
    """Tests for UnionType"""

    def test_convert_greedy_first_match(self) -> None:
        t = UnionType([IntType(), FloatType()])
        assert t.validate_convert("42") == 42
        assert isinstance(t.validate_convert("42"), int)

    def test_convert_falls_through_to_second_type(self) -> None:
        t = UnionType([IntType(), FloatType()])
        assert t.validate_convert("3.14") == 3.14

    def test_convert_all_fail_raises_error(self) -> None:
        t = UnionType([IntType(), FloatType()])
        with pytest.raises(WrongType):
            t.validate_convert("not_a_number")

    def test_convert_non_string_raises_type_error(self) -> None:
        t = UnionType([IntType(), StringType()])
        with pytest.raises(NotStringInput):
            t.validate_convert(42)
        with pytest.raises(NotStringInput):
            t.validate_convert(None)

    def test_serialize(self) -> None:
        t = UnionType([IntType(), StringType()])
        assert t.serialize() == "union[int,str]"

    def test_serialize_multi_type(self) -> None:
        t = UnionType([IntType(), FloatType(), DateType()])
        assert t.serialize() == "union[int,float,date]"

    def test_parse_and_round_trip(self) -> None:
        t = parse("union[int,str]")
        assert isinstance(t, UnionType)
        assert len(t.types) == 2
        assert isinstance(t.types[0], IntType)
        assert isinstance(t.types[1], StringType)
        assert t.serialize() == "union[int,str]"

    def test_parse_union_with_date_and_datetime(self) -> None:
        t = parse("union[date,datetime]")
        assert isinstance(t, UnionType)
        assert t.validate_convert("2026-05-08T10:30:45") == datetime(2026, 5, 8, 10, 30, 45)

    def test_parse_union_with_country(self) -> None:
        t = parse("union[int,geodomainSingle]")
        assert isinstance(t, UnionType)
        assert t.validate_convert("42") == 42
        assert t.validate_convert("France") == "France"

    def test_parse_empty_union_raises_error(self) -> None:
        with pytest.raises(ValueError):
            parse("union[]")

    def test_parse_union_of_unions_now_supported(self) -> None:
        t = parse("union[union[int,str],float]")
        assert isinstance(t, UnionType)
        assert isinstance(t.types[0], UnionType)
        assert isinstance(t.types[1], FloatType)
        assert t.validate_convert("42") == 42

    def test_parse_union_with_list_now_supported(self) -> None:
        t = parse("union[list[int],str]")
        assert isinstance(t, UnionType)
        assert isinstance(t.types[0], ListType)
        assert t.validate_convert("1,2,3") == [1, 2, 3]
        assert t.validate_convert("hello") == "hello"

    def test_parse_union_with_bbox_now_supported(self) -> None:
        t = parse("union[bboxWSEN,str]")
        assert isinstance(t, UnionType)
        assert isinstance(t.types[0], BoundingBoxWSENType)
        assert t.validate_convert("1,2,3,4") == [1, 2, 3, 4]
        assert t.validate_convert("hello") == "hello"

    def test_parse_list_of_union_now_supported(self) -> None:
        t = parse("list[union[int,str]]")
        assert isinstance(t, ListType)
        assert isinstance(t.item_type, UnionType)
        assert t.validate_convert("42,hello,3") == [42, "hello", 3]

    def test_parse_union_of_lists(self) -> None:
        t = parse("union[list[int],list[float]]")
        assert isinstance(t, UnionType)
        assert t.validate_convert("1,2,3") == [1, 2, 3]
        assert t.validate_convert("1.5,2.5") == [1.5, 2.5]

    def test_parse_union_with_enum(self) -> None:
        t = parse("union[enumClosed[a,b],str]")
        assert isinstance(t, UnionType)
        assert isinstance(t.types[0], ClosedEnumType)
        assert t.validate_convert("a") == "a"
        assert t.validate_convert("anything") == "anything"

    def test_parse_union_with_whitespace(self) -> None:
        t = parse("union[ int , str ]")
        assert isinstance(t, UnionType)
        assert isinstance(t.types[0], IntType)
        assert isinstance(t.types[1], StringType)


class TestFableTypeParseRemainder:
    """Tests for the remainder returned by the internal parser."""

    def test_atomic_type_returns_remainder(self) -> None:
        t, remainder = _parse("int,str")
        assert isinstance(t, IntType)
        assert remainder == ",str"

    def test_list_type_returns_remainder(self) -> None:
        t, remainder = _parse("list[int],more")
        assert isinstance(t, ListType)
        assert remainder == ",more"

    def test_enum_type_returns_remainder(self) -> None:
        t, remainder = _parse("enumClosed[a,b],extra")
        assert isinstance(t, ClosedEnumType)
        assert remainder == ",extra"

    def test_union_type_returns_remainder(self) -> None:
        t, remainder = _parse("union[int,str],extra")
        assert isinstance(t, UnionType)
        assert remainder == ",extra"

    def test_nested_brackets_in_list_parsed_correctly(self) -> None:
        t, remainder = _parse("list[enumClosed[a,b]]suffix")
        assert isinstance(t, ListType)
        assert isinstance(t.item_type, ClosedEnumType)
        assert remainder == "suffix"

    def test_unmatched_bracket_in_list_raises_error(self) -> None:
        with pytest.raises(NotFableType):
            _parse("list[int")

    def test_unmatched_bracket_in_union_raises_error(self) -> None:
        with pytest.raises(NotFableType):
            _parse("union[int,str")

    def test_unmatched_bracket_in_enum_raises_error(self) -> None:
        with pytest.raises(NotFableType):
            _parse("enumClosed[a,b")

    def test_union_with_enum_member(self) -> None:
        t, remainder = _parse("union[enumClosed[x,y],int]")
        assert isinstance(t, UnionType)
        assert remainder == ""
        assert isinstance(t.types[0], ClosedEnumType)
        assert isinstance(t.types[1], IntType)
        assert t.validate_convert("x") == "x"
        assert t.validate_convert("42") == 42

    def test_extra_content_in_list_raises_error(self) -> None:
        with pytest.raises(NotFableType):
            _parse("list[int garbage]")
