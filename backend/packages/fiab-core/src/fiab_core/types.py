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
- enumClosed[...], enumOpen[...] (enumeration types)
- list[FableType] (container types)
- bbox (bounding box: exactly four integers)
- union[FableType, ...] (union types)
"""

from abc import ABC, abstractmethod
from datetime import date, datetime
from typing import Any


class NotFableType(Exception):
    """Raised when a type expression cannot be parsed."""


class NotStringInput(TypeError):
    """Raised when validate_convert receives a non-string input."""


class WrongType(Exception):
    """Raised when a value cannot be converted to the target type."""


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
        """Serialize this type to a string expression that can be parsed back via FableType.parse()."""

    @staticmethod
    def parse(type_expr: str) -> "tuple[FableType, str]":
        """Parse a type expression from the start of type_expr.

        Returns ``(parsed_type, remainder)`` where ``remainder`` is the unparsed
        tail of the input string. At the outer call site, verify that the
        remainder is empty (or whitespace-only) to ensure the full expression
        was consumed.

        Supports:
        - Atomic types: 'str', 'int', 'float', 'date', 'datetime', 'country', 'bbox'
        - Enumerations: 'enumClosed[item1,item2]', 'enumOpen[item1,item2]'
        - Lists: 'list[int]', 'list[enumClosed[...]]', etc.
        - Union: 'union[int,str]', 'union[enumClosed[a,b],date]', etc.

        Raises NotFableType if the expression cannot be parsed.
        """
        type_expr = type_expr.lstrip()

        # Atomic types: startswith + word-boundary check (next char not alnum or '_')
        _ATOMIC = [
            ("datetime", DatetimeType),
            ("date", DateType),
            ("float", FloatType),
            ("int", IntType),
            ("str", StringType),
            ("country", CountryType),
            ("bbox", BoundingBoxType),
        ]
        for name, factory in _ATOMIC:
            n = len(name)
            if type_expr.startswith(name) and (len(type_expr) == n or not (type_expr[n].isalnum() or type_expr[n] == "_")):
                return (factory(), type_expr[n:])

        # enumClosed[...]
        if type_expr.startswith("enumClosed["):
            bs = 10  # index of '['
            pos = _find_matching_bracket(type_expr[bs:])
            if pos == -1:
                raise NotFableType("Unmatched '[' in enumClosed expression")
            inner = type_expr[bs + 1 : bs + pos]
            remainder = type_expr[bs + pos + 1 :]
            items = [_normalize_enum_item(item) for item in inner.split(",") if item.strip()]
            if not items:
                raise NotFableType("enumClosed must contain at least one item")
            return (ClosedEnumType(items), remainder)

        # enumOpen[...]
        if type_expr.startswith("enumOpen["):
            bs = 8  # index of '['
            pos = _find_matching_bracket(type_expr[bs:])
            if pos == -1:
                raise NotFableType("Unmatched '[' in enumOpen expression")
            inner = type_expr[bs + 1 : bs + pos]
            remainder = type_expr[bs + pos + 1 :]
            items = [_normalize_enum_item(item) for item in inner.split(",") if item.strip()]
            if not items:
                raise NotFableType("enumOpen must contain at least one item")
            return (OpenEnumType(items), remainder)

        # list[...]
        if type_expr.startswith("list["):
            bs = 4  # index of '['
            pos = _find_matching_bracket(type_expr[bs:])
            if pos == -1:
                raise NotFableType("Unmatched '[' in list expression")
            inner = type_expr[bs + 1 : bs + pos]
            remainder = type_expr[bs + pos + 1 :]
            inner_type, inner_remainder = FableType.parse(inner)
            if inner_remainder.strip():
                raise NotFableType(f"Unexpected content after inner type in list: {inner_remainder!r}")
            if isinstance(inner_type, (ListType, UnionType)):
                raise NotFableType("Nested lists and union types inside list are not supported")
            return (ListType(inner_type), remainder)

        # union[...]
        if type_expr.startswith("union["):
            bs = 5  # index of '['
            pos = _find_matching_bracket(type_expr[bs:])
            if pos == -1:
                raise NotFableType("Unmatched '[' in union expression")
            inner = type_expr[bs + 1 : bs + pos].strip()
            remainder = type_expr[bs + pos + 1 :]
            if not inner:
                raise NotFableType("union must contain at least one type")
            member_types: list[FableType] = []
            remaining = inner
            first = True
            while remaining:
                remaining = remaining.lstrip()
                if not first:
                    if not remaining.startswith(","):
                        raise NotFableType(f"Expected ',' between union member types, got {remaining!r}")
                    remaining = remaining[1:].lstrip()
                first = False
                t, remaining = FableType.parse(remaining)
                remaining = remaining.rstrip()
                if isinstance(t, (ListType, UnionType)):
                    raise NotFableType("union cannot contain list or union types")
                member_types.append(t)
            return (UnionType(member_types), remainder)

        raise NotFableType(
            f"Invalid type expression: {type_expr!r}. "
            "Expected one of: str, int, float, date, datetime, country, bbox, "
            "enumClosed[...], enumOpen[...], list[...], union[...]"
        )


def _find_matching_bracket(s: str) -> int:
    """Find the index of the ']' that matches the '[' at s[0]. Returns -1 if not found."""
    depth = 0
    for i, ch in enumerate(s):
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                return i
    return -1


def _normalize_enum_item(item: str) -> str:
    item = item.strip()
    if len(item) >= 2 and item[0] == item[-1] and item[0] in ("'", '"'):
        return item[1:-1]
    return item


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


class ClosedEnumType(FableType):
    """Closed enumeration type. Validates membership in the enum; conversion is a no-op."""

    def __init__(self, items: list[str]) -> None:
        self.items = items
        self._item_set = set(items)

    def validate_convert(self, value: Any) -> str:
        if not isinstance(value, str):
            raise NotStringInput(f"Expected string, got {type(value).__name__}")
        if value not in self._item_set:
            raise WrongType(f"{value!r} is not a valid option. Valid options are: {', '.join(self.items)}")
        return value

    def serialize(self) -> str:
        items_str = ",".join(self.items)
        return f"enumClosed[{items_str}]"


class OpenEnumType(FableType):
    """Open enumeration type. Accepts any string value; conversion is a no-op."""

    def __init__(self, items: list[str]) -> None:
        self.items = items

    def validate_convert(self, value: Any) -> str:
        if not isinstance(value, str):
            raise NotStringInput(f"Expected string, got {type(value).__name__}")
        return value

    def serialize(self) -> str:
        items_str = ",".join(self.items)
        return f"enumOpen[{items_str}]"


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


class BoundingBoxType(ListType):
    """Bounding box type. A list of exactly four integers: [west, south, east, north]."""

    def __init__(self) -> None:
        super().__init__(IntType())

    def validate_convert(self, value: Any) -> list[int]:
        result = super().validate_convert(value)
        if len(result) != 4:
            raise WrongType(f"BoundingBox must have exactly 4 elements, got {len(result)}")
        return result

    def serialize(self) -> str:
        return "bbox"


class CountryType(StringType):
    """Country type. A string representing a country (detailed validation to be added later)."""

    def serialize(self) -> str:
        return "country"


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
