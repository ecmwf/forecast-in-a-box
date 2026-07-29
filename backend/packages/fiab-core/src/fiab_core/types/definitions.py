# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Definitions of all the types"""

import logging
from abc import ABC, abstractmethod
from datetime import date, datetime
from typing import Any, Iterable, Literal, get_args

import fiab_core  # to satisfy the type checker for artifacts annotation
from fiab_core.types.exceptions import NotStringInput, WrongType

logger = logging.getLogger(__name__)

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
    construction time via ``subtype``. ``subtype`` must be a FableType instance. Defaults
    to StringType for backwards compatibility.
    """

    def __init__(self, items: Iterable[Any], subtype: FableType = StringType()) -> None:
        self.subtype = subtype
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

    def __init__(self, items: Iterable[Any], subtype: FableType = StringType()) -> None:
        self.subtype = subtype
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


class ArtifactType(StringType):
    """A string representing an id from the artifact catalog. Utilized by the frontend
    to perform catalog lookup to build a better UI form, displaying additional info"""

    # NOTE we are being careful here as we dont want to introduce a strict dependency
    # of types on artifacts. Hence the (exceptional) string annotation, in-body import,
    # defensive lookup, etc
    def validate_convert(self, value: Any) -> "fiab_core.artifacts.CompositeArtifactId":
        raw: str = super().validate_convert(value)
        from fiab_core.artifacts import ArtifactsProvider, CompositeArtifactId

        try:
            artifact_id = CompositeArtifactId.from_str(raw)
        except Exception as e:
            raise WrongType(f"{raw} is not a CompositeArtifactId: {e!r}") from None
        try:
            lookup = ArtifactsProvider.get_artifacts_lookup()
        except RuntimeError as e:
            logger.warning(f"no artifacts provider -- will not validate! {e!r}")
            return
        if artifact_id not in lookup:
            raise WrongType(f"{artifact_id=} is not known to the ArtifactsProvider")
        return artifact_id

    def serialize(self) -> str:
        return "artifact"


class ParameterType(StringType):
    """A string representing a parameter name, like 2t or u or v. Utilized by the frontend
    to perform param lookup to build a better UI form, displaying additional info,
    name conversion, etc"""

    def validate_convert(self, value: Any) -> str:
        raw: str = super().validate_convert(value)
        # TODO here we should do some "param lookup into metkit" but:
        # a/ must be opportunistic -- we dont want a metkit dependency
        # b/ that code may not yet exist?
        return raw

    def serialize(self) -> str:
        return "param"
