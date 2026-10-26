# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for the AstDumpTransformer and the dump_ast helper."""

import pytest

from fiab_core.types.parser import _PARSER, AstDumpTransformer, dump_ast


@pytest.mark.parametrize(
    ("term", "name"),
    [
        ("str", "String"),
        ("int", "Int"),
        ("float", "Float"),
        ("date", "Date"),
        ("datetime", "Datetime"),
        ("timedelta", "TimeDelta"),
        ("none", "None"),
        ("param", "Parameter"),
        ("artifact", "Artifact"),
        ("geodomainSingle", "GeoDomainSingle"),
        ("geodomain", "GeoDomain"),
        ("bboxWSEN", "BoundingBoxWSEN"),
    ],
)
def test_atomic(term: str, name: str) -> None:
    assert dump_ast(term) == {"name": name}


def test_list() -> None:
    assert dump_ast("list[str]") == {"name": "List", "item": {"name": "String"}}


def test_union() -> None:
    expected = {"name": "Union", "types": [{"name": "Int"}, {"name": "List", "item": {"name": "String"}}]}
    assert dump_ast("union[int, list[str]]") == expected


def test_nested_union_and_list() -> None:
    expected = {
        "name": "List",
        "item": {"name": "Union", "types": [{"name": "Union", "types": [{"name": "Int"}, {"name": "None"}]}, {"name": "Date"}]},
    }
    assert dump_ast("list[union[union[int,none],date]]") == expected


def test_enums() -> None:
    assert dump_ast("enumClosed[int](1,2,3)") == {"name": "ClosedEnum", "subtype": {"name": "Int"}, "items": ["1", "2", "3"]}
    assert dump_ast("enumOpen[str]('a','b')") == {"name": "OpenEnum", "subtype": {"name": "String"}, "items": ["a", "b"]}


def test_enum_items_quoting_and_whitespace() -> None:
    expected = {"name": "ClosedEnum", "subtype": {"name": "String"}, "items": ["a", "b c", "d,e", "f"]}
    assert dump_ast("""enumClosed[str]( a , b c ,'d,e', "f" )""") == expected


def test_enum_items_are_not_validated() -> None:
    assert dump_ast("enumClosed[int](a)") == {"name": "ClosedEnum", "subtype": {"name": "Int"}, "items": ["a"]}


def test_traits() -> None:
    assert dump_ast("int{positive}") == {"name": "Int", "traits": [{"name": "Positive"}]}
    expected = {"name": "Float", "traits": [{"name": "NonNegative"}, {"name": "DivisibleBy", "arg": "0.5"}]}
    assert dump_ast("float{nonNegative, divisibleBy(0.5)}") == expected


def test_traits_on_nested_and_generic_types() -> None:
    expected = {
        "name": "List",
        "item": {"name": "TimeDelta", "traits": [{"name": "DivisibleBy", "arg": "PT6H"}]},
        "traits": [{"name": "NonNegative"}],
    }
    assert dump_ast("list[timedelta{divisibleBy(PT6H)}]{nonNegative}") == expected


def test_transformer_on_tree() -> None:
    tree = _PARSER.parse("union[int,str]", start="start")
    assert AstDumpTransformer().transform(tree) == {"name": "Union", "types": [{"name": "Int"}, {"name": "String"}]}


@pytest.mark.parametrize("term", ["", "string", "list[]", "union[]", "enumClosed[str]()", "int{}", "int{unknown}", "int,str"])
def test_invalid_raises(term: str) -> None:
    with pytest.raises(ValueError):
        dump_ast(term)
