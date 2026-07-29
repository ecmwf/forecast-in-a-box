# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""
FableType: Type system for Forecast As BLock Expression (Fable) configuration values.

Provides parsing, validation, and conversion for a small set of type expressions:
- str, int, float, date, datetime (atomic types)
- country (string subtype)
- enumClosed[subtype](...), enumOpen[subtype](...) (enumeration types, e.g. enumClosed[int](1,2))
- list[FableType] (container types)
- bboxWSEN (bounding box: exactly four integers, west-south-east-north, obeying constraints)
- geodomain (bounding box or region/country names; the frontend renders a map/region picker)
- union[FableType, ...] (union types)
"""

from abc import ABC, abstractmethod
from datetime import date, datetime
from typing import Any, Iterable, Literal, get_args

# PSEUDO TYPES / EXCEPTIONS


class NotFableType(Exception):
    """Raised when a type expression cannot be parsed."""


class NotStringInput(TypeError):
    """Raised when validate_convert receives a non-string input."""


class WrongType(Exception):
    """Raised when a value cannot be converted to the target type."""


# BASE CLASS FOR ALL REAL TYPES


class FableType(ABC):
    """Base class for all Fable type expressions. Provides validation and conversion of string values."""

    @abstractmethod
    def validate_convert(self, value: Any) -> Any:
        """Convert and validate a value according to this type.

        Accepts a string value and returns the converted value, or raises:
        - TypeError if value is not a string
        - ValueError for validation failures (e.g., invalid format, enum membership)
        """

    @abstractmethod
    def serialize(self) -> str:
        """Serialize this type to a string expression that can be parsed back via parse()."""


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


def _normalize_enum_item(item: str) -> str:
    item = item.strip()
    if len(item) >= 2 and item[0] == item[-1] and item[0] in ("'", '"'):
        return item[1:-1]
    return item


# PRIMITIVE TYPES


class StringType(FableType):
    """The string type. Conversion is a no-op; validates that the type expression is valid."""

    def validate_convert(self, value: Any) -> str:
        if not isinstance(value, str):
            raise NotStringInput(f"Expected string, got {type(value).__name__}")
        return value

    def serialize(self) -> str:
        return "str"


class IntType(FableType):
    """The integer type. Converts string to int."""

    def validate_convert(self, value: Any) -> int:
        if not isinstance(value, str):
            raise NotStringInput(f"Expected string, got {type(value).__name__}")
        try:
            return int(value)
        except ValueError:
            raise WrongType(f"Cannot convert {value!r} to int")

    def serialize(self) -> str:
        return "int"


class FloatType(FableType):
    """The float type. Converts string to float."""

    def validate_convert(self, value: Any) -> float:
        if not isinstance(value, str):
            raise NotStringInput(f"Expected string, got {type(value).__name__}")
        try:
            return float(value)
        except ValueError:
            raise WrongType(f"Cannot convert {value!r} to float")

    def serialize(self) -> str:
        return "float"


class DateType(FableType):
    """The date type. Converts ISO 8601 date string (YYYY-MM-DD) to datetime.date."""

    def validate_convert(self, value: Any) -> date:
        if not isinstance(value, str):
            raise NotStringInput(f"Expected string, got {type(value).__name__}")
        try:
            return datetime.strptime(value, "%Y-%m-%d").date()
        except ValueError:
            raise WrongType(f"Cannot parse {value!r} as date (expected ISO 8601 format: YYYY-MM-DD)")

    def serialize(self) -> str:
        return "date"


class DatetimeType(FableType):
    """The datetime type. Converts ISO 8601 datetime string to datetime.datetime.

    Accepts format: YYYY-MM-DDTHH:MM:SS or YYYY-MM-DDTHH:MM:SS.ffffff or with +HH:MM/-HH:MM timezone.
    """

    def validate_convert(self, value: Any) -> datetime:
        if not isinstance(value, str):
            raise NotStringInput(f"Expected string, got {type(value).__name__}")

        for fmt in [
            "%Y-%m-%dT%H:%M:%S.%f",
            "%Y-%m-%dT%H:%M:%S",
            "%Y-%m-%dT%H:%M:%S.%f%z",
            "%Y-%m-%dT%H:%M:%S%z",
        ]:
            try:
                return datetime.strptime(value, fmt)
            except ValueError:
                continue

        raise WrongType(f"Cannot parse {value!r} as datetime (expected ISO 8601 format)")

    def serialize(self) -> str:
        return "datetime"


# GENERIC TYPES


def _serialize_enum_item(item: Any) -> str:
    if isinstance(item, str):
        return f"'{item}'"
    if hasattr(item, "isoformat"):
        return item.isoformat()
    return str(item)


class ClosedEnumType(FableType):
    """Closed enumeration type. Validates membership in the enum, converting via the given subtype.

    ``items`` are the raw (string) representations of the allowed values, converted eagerly at
    construction time via ``subtype``. ``subtype`` may be a FableType instance or a type expression
    string (in which case it is parsed first). Defaults to StringType for backwards compatibility.
    """

    def __init__(self, items: Iterable[Any], subtype: FableType | str = StringType()) -> None:
        self.subtype = parse(subtype) if isinstance(subtype, str) else subtype
        self.items = [self.subtype.validate_convert(item) for item in items]
        self._item_set = set(self.items)

    def validate_convert(self, value: Any) -> Any:
        if not isinstance(value, str):
            raise NotStringInput(f"Expected string, got {type(value).__name__}")
        converted = self.subtype.validate_convert(value)
        if converted not in self._item_set:
            options = ", ".join(str(item) for item in self.items)
            raise WrongType(f"{value!r} is not a valid option. Valid options are: {options}")
        return converted

    def serialize(self) -> str:
        items_str = ",".join(_serialize_enum_item(item) for item in self.items)
        return f"enumClosed[{self.subtype.serialize()}]({items_str})"


class OpenEnumType(FableType):
    """Open enumeration type. Accepts any value convertible via the subtype; membership is not enforced.

    See ClosedEnumType for the meaning of ``items`` and ``subtype``.
    """

    def __init__(self, items: Iterable[Any], subtype: FableType | str = StringType()) -> None:
        self.subtype = parse(subtype) if isinstance(subtype, str) else subtype
        self.items = [self.subtype.validate_convert(item) for item in items]

    def validate_convert(self, value: Any) -> Any:
        if not isinstance(value, str):
            raise NotStringInput(f"Expected string, got {type(value).__name__}")
        return self.subtype.validate_convert(value)

    def serialize(self) -> str:
        items_str = ",".join(_serialize_enum_item(item) for item in self.items)
        return f"enumOpen[{self.subtype.serialize()}]({items_str})"


class ListType(FableType):
    """List type. Converts comma-separated string to a list by validating and converting each item."""

    def __init__(self, item_type: FableType) -> None:
        self.item_type = item_type

    def validate_convert(self, value: Any) -> list[Any]:
        if not isinstance(value, str):
            raise NotStringInput(f"Expected string, got {type(value).__name__}")

        value = value.strip()
        if not value:
            return []

        # TODO this is fundamentally limiting to not containing ,-based types, like list[list[int]] or list[bbox]
        # We should change to a proper parser here that understands the inner type and consumes with remainder,
        # similarly to how type parsing for union works
        items = [item.strip() for item in value.split(",")]
        result = []
        for i, item in enumerate(items):
            try:
                result.append(self.item_type.validate_convert(item))
            except (NotStringInput, WrongType) as e:
                raise WrongType(f"Error converting list item at index {i} ({item!r}): {e}")

        return result

    def serialize(self) -> str:
        return f"list[{self.item_type.serialize()}]"


class UnionType(FableType):
    """Union type. Tries each member type in order and returns the first successful conversion."""

    def __init__(self, types: list[FableType]) -> None:
        self.types = types

    def validate_convert(self, value: Any) -> Any:
        if not isinstance(value, str):
            raise NotStringInput(f"Expected string, got {type(value).__name__}")
        for t in self.types:
            try:
                return t.validate_convert(value)
            except WrongType:
                continue
        raise WrongType(f"Cannot convert {value!r} to any of: {', '.join(t.serialize() for t in self.types)}")

    def serialize(self) -> str:
        return f"union[{','.join(t.serialize() for t in self.types)}]"


# DOMAIN TYPES


class BoundingBoxWSENType(ListType):
    """Bounding box type. A list of exactly four integers: [west, south, east, north]. Validates eg:
    - latitudes are [-90, 90],
    - south <= north;
    - west > east is allowed and means the box crosses the antimeridian."""

    def __init__(self) -> None:
        super().__init__(IntType())

    def validate_convert(self, value: Any) -> list[int]:
        result = super().validate_convert(value)
        if len(result) != 4:
            raise WrongType(f"BoundingBoxWSEN must have exactly 4 elements, got {len(result)}")
        west, south, east, north = result
        if not (-90 <= south <= 90 and -90 <= north <= 90):
            raise WrongType(f"Invalid bounding box latitudes south={south}, north={north} (must be within [-90, 90])")
        if south > north:
            raise WrongType(f"Invalid bounding box: south ({south}) must be <= north ({north})")
        return result

    def serialize(self) -> str:
        return "bboxWSEN"


# NOTE convert to Type class if ever needs to be `serialize`d
UnrestrictedGeoDomainLiteral = Literal["auto", "global", "datadefined"]
UnrestrictedGeoDomainAlias = ClosedEnumType(get_args(UnrestrictedGeoDomainLiteral))


class GeoDomainSingleType(StringType):
    """Country/domain type. A string representing a country or preset area like Europe or Arctic (detailed validation to be added later)."""

    def validate_convert(self, value: Any) -> str:
        v = super().validate_convert(value)
        if v in UnrestrictedGeoDomainAlias.items:
            raise WrongType("cannot use {v} within country/domain, as that is a special value")
        try:
            float(v)
            raise WrongType(f"a number '{v}' is not a geo domain")
        except ValueError:
            pass
        return v

    def serialize(self) -> str:
        return "geodomainSingle"


class GeoDomainType(UnionType):
    """An alias for a union over bounding box, list of single geo domains, and a single geo domain type."""

    def __init__(self) -> None:
        super().__init__([BoundingBoxWSENType(), UnrestrictedGeoDomainAlias, ListType(GeoDomainSingleType())])

    def serialize(self) -> str:
        return "geodomain"


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
