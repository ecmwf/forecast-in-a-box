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
- enumClosed[...], enumOpen[...] (enumeration types)
- list[FableType] (container types)
"""

from abc import ABC, abstractmethod
from datetime import date, datetime
from typing import Any


class NotFableType(Exception):
    """Raised when a type expression cannot be parsed."""


class NotStringInput(Exception):
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

    @staticmethod
    def parse(type_expr: str) -> "FableType":
        """Parse a type expression string into a FableType instance.

        Supports:
        - Atomic types: 'str', 'int', 'float', 'date', 'datetime'
        - Enumerations: 'enumClosed[item1,item2]', 'enumOpen[item1,item2]'
        - Lists: 'list[int]', 'list[enumClosed[...]]', etc.

        Raises NotFableType if the type expression is invalid.
        """
        type_expr = type_expr.strip()

        if type_expr == "str":
            return StringType()
        if type_expr == "int":
            return IntType()
        if type_expr == "float":
            return FloatType()
        if type_expr == "date":
            return DateType()
        if type_expr == "datetime":
            return DatetimeType()

        if type_expr.startswith("enumClosed[") and type_expr.endswith("]"):
            items_str = type_expr[11:-1]
            items = [item.strip() for item in items_str.split(",") if item.strip()]
            if not items:
                raise NotFableType("enumClosed must contain at least one item")
            return ClosedEnumType(items)

        if type_expr.startswith("enumOpen[") and type_expr.endswith("]"):
            items_str = type_expr[9:-1]
            items = [item.strip() for item in items_str.split(",") if item.strip()]
            if not items:
                raise NotFableType("enumOpen must contain at least one item")
            return OpenEnumType(items)

        if type_expr.startswith("list[") and type_expr.endswith("]"):
            inner_type_expr = type_expr[5:-1]
            inner_type = FableType.parse(inner_type_expr)
            if isinstance(inner_type, ListType):
                raise NotFableType("Nested lists are not supported")
            return ListType(inner_type)

        raise NotFableType(
            f"Invalid type expression: {type_expr!r}. "
            "Expected one of: str, int, float, date, datetime, "
            "enumClosed[...], enumOpen[...], list[...]"
        )


class StringType(FableType):
    """The string type. Conversion is a no-op; validates that the type expression is valid."""

    def validate_convert(self, value: Any) -> str:
        if not isinstance(value, str):
            raise NotStringInput(f"Expected string, got {type(value).__name__}")
        return value


class IntType(FableType):
    """The integer type. Converts string to int."""

    def validate_convert(self, value: Any) -> int:
        if not isinstance(value, str):
            raise NotStringInput(f"Expected string, got {type(value).__name__}")
        try:
            return int(value)
        except ValueError:
            raise WrongType(f"Cannot convert {value!r} to int")


class FloatType(FableType):
    """The float type. Converts string to float."""

    def validate_convert(self, value: Any) -> float:
        if not isinstance(value, str):
            raise NotStringInput(f"Expected string, got {type(value).__name__}")
        try:
            return float(value)
        except ValueError:
            raise WrongType(f"Cannot convert {value!r} to float")


class DateType(FableType):
    """The date type. Converts ISO 8601 date string (YYYY-MM-DD) to datetime.date."""

    def validate_convert(self, value: Any) -> date:
        if not isinstance(value, str):
            raise NotStringInput(f"Expected string, got {type(value).__name__}")
        try:
            return datetime.strptime(value, "%Y-%m-%d").date()
        except ValueError:
            raise WrongType(f"Cannot parse {value!r} as date (expected ISO 8601 format: YYYY-MM-DD)")


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


class OpenEnumType(FableType):
    """Open enumeration type. Accepts any string value; conversion is a no-op."""

    def __init__(self, items: list[str]) -> None:
        self.items = items

    def validate_convert(self, value: Any) -> str:
        if not isinstance(value, str):
            raise NotStringInput(f"Expected string, got {type(value).__name__}")
        return value


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
