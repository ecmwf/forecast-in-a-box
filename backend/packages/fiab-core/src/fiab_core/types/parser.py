# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""
Parsers and utility methods for the types from definition.py
"""

from fiab_core.types.definitions import *
from fiab_core.types.exceptions import NotFableType


def _normalize_enum_item(item: str) -> str:
    item = item.strip()
    if len(item) >= 2 and item[0] == item[-1] and item[0] in ("'", '"'):
        return item[1:-1]
    return item


def _split_by_delim(s: str, open_ch: str, close_ch: str) -> tuple[str, str, str]:
    """Split 'prefix<open_ch>inner<close_ch>remainder' into (prefix, inner, remainder).

    The inner content is stripped of leading/trailing whitespace.
    Raises NotFableType if open_ch is not found or if the delimiters are unmatched.
    """
    open_pos = s.find(open_ch)
    if open_pos == -1:
        raise NotFableType(f"Expected {open_ch!r} in expression: {s!r}")
    prefix = s[:open_pos]
    depth = 0
    for i in range(open_pos, len(s)):
        ch = s[i]
        if ch == open_ch:
            depth += 1
        elif ch == close_ch:
            depth -= 1
            if depth == 0:
                return (prefix, s[open_pos + 1 : i].strip(), s[i + 1 :])
    raise NotFableType(f"Unmatched {open_ch!r} in {prefix!r} expression")


def _split_by_brackets(s: str) -> tuple[str, str, str]:
    """Split 'prefix[inner]remainder' into (prefix, inner, remainder)."""
    return _split_by_delim(s, "[", "]")


def _split_by_parens(s: str) -> tuple[str, str, str]:
    """Split 'prefix(inner)remainder' into (prefix, inner, remainder)."""
    return _split_by_delim(s, "(", ")")


def _parse(type_expr: str) -> tuple[FableType, str]:
    """Parse a type expression from the start of type_expr.

    Returns ``(parsed_type, remainder)`` where ``remainder`` is the unparsed
    tail of the input string. At the outer call site, verify that the
    remainder is empty (or whitespace-only) to ensure the full expression
    was consumed.

    Supports:
    - Atomic types: 'str', 'int', 'float', 'date', 'datetime', 'country', 'bboxWSEN'
    - Enumerations: "enumClosed[str]('item1','item2')", "enumOpen[int](1,2)"
    - Lists: 'list[int]', 'list[enumClosed[...](...)]', etc.
    - Union: 'union[int,str]', "union[enumClosed[str]('a','b'),date]", etc.

    Raises NotFableType if the expression cannot be parsed.
    """
    type_expr = type_expr.lstrip()

    # Atomic types (no generics)
    # NOTE be careful about prefixes! datetime must come before date, similarly for geodomain/Single
    _ATOMIC = [
        ("datetime", DatetimeType),
        ("date", DateType),
        ("float", FloatType),
        ("int", IntType),
        ("str", StringType),
        ("param", ParameterType),
        ("artifact", ArtifactType),
        ("geodomainSingle", GeoDomainSingleType),
        ("bboxWSEN", BoundingBoxWSENType),
        ("geodomain", GeoDomainType),
    ]
    for name, factory in _ATOMIC:
        n = len(name)
        if type_expr.startswith(name):
            return (factory(), type_expr[n:])

    # Enum types (enumClosed and enumOpen share identical logic)
    # Grammar: enumClosed[subtype](item1,item2,...), e.g. enumClosed[int](1,2) or enumOpen[str]('a','b')
    _ENUMS = {"enumClosed": ClosedEnumType, "enumOpen": OpenEnumType}
    for prefix, factory in _ENUMS.items():
        if type_expr.startswith(prefix):
            _, subtype_expr, after_subtype = _split_by_brackets(type_expr)
            subtype, subtype_remainder = _parse(subtype_expr)
            if subtype_remainder.strip():
                raise NotFableType(f"Unexpected content after enum subtype in {prefix}: {subtype_remainder!r}")
            after_subtype = after_subtype.lstrip()
            should_be_empty, items_str, remainder = _split_by_parens(after_subtype)
            if should_be_empty:
                raise NotFableType(f"{prefix} must be followed by '(' item, item, ... ')' after the subtype, gotten {should_be_empty}")
            items = [_normalize_enum_item(item) for item in items_str.split(",") if item.strip()]
            if not items:
                raise NotFableType(f"{prefix} must contain at least one item")
            return (factory(items, subtype), remainder)

    # list[...]
    if type_expr.startswith("list["):
        _, inner, remainder = _split_by_brackets(type_expr)
        inner_type, inner_remainder = _parse(inner)
        if inner_remainder.strip():
            raise NotFableType(f"Unexpected content after inner type in list: {inner_remainder!r}")
        return (ListType(inner_type), remainder)

    # union[...]
    if type_expr.startswith("union["):
        _, inner, remainder = _split_by_brackets(type_expr)
        member_types: list[FableType] = []
        remaining = inner
        first = True
        while remaining:
            if not first:
                if not remaining.startswith(","):
                    raise NotFableType(f"Expected ',' between union member types, got {remaining!r}")
                remaining = remaining[1:].lstrip()
            first = False
            t, remaining = _parse(remaining)
            remaining = remaining.lstrip()
            member_types.append(t)
        if not member_types:
            raise NotFableType("union must contain at least one type")
        return (UnionType(member_types), remainder)

    raise NotFableType(
        f"Invalid type expression: {type_expr!r}. "
        "Expected one of: str, int, float, date, datetime, country, bboxWSEN, geodomain, "
        "enumClosed[subtype](...), enumOpen[subtype](...), list[...], union[...]"
    )


def parse(type_expr: str | FableType) -> FableType:
    """Parse a complete Fable type expression."""
    if isinstance(type_expr, FableType):
        return type_expr
    if not isinstance(type_expr, str):
        raise ValueError(f"Expected a Fable type expression string, got {type(type_expr).__name__}")
    try:
        parsed, remainder = _parse(type_expr)
        if remainder.strip():
            raise NotFableType(f"Unexpected trailing content in type expression: {remainder!r}")
    except NotFableType as exc:
        raise ValueError(str(exc)) from exc
    return parsed
