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
import math
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
        # NOTE probably change to value: str and get rid of the NoStringInput exception? Or utilize that centrally and have children override internal method only

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

    def __init__(self, real: bool = False) -> None:
        """If real is True, only allow real numbers (no NaN or inf)."""
        self.real = real

    def validate_convert(self, value: Any) -> float:
        if not isinstance(value, str):
            raise NotStringInput(f"Expected string, got {type(value).__name__}")
        try:
            result = float(value)
            if self.real and not (math.isnan(result) or math.isinf(result)):
                raise WrongType(f"Expected a real number, got {value!r}")
            return result
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


def _serialize_enum_item(item: Any, subtype: FableType) -> str:
    """Serialize a single already-converted enum member for ClosedEnumType/OpenEnumType.serialize().

    Dispatches on the enum's declared ``subtype`` rather than introspecting ``item`` itself, since the
    same converted Python value can mean different things for different types. Only the subtypes that
    are actually used as enum members today are covered; extend this as new cases arise.
    """
    if isinstance(subtype, ArtifactType):
        # NOTE we explicitly import in-body to not introduce a high level dependency for now
        from fiab_core.artifacts import CompositeArtifactId

        return f"'{CompositeArtifactId.to_str(item)}'"
    if isinstance(subtype, DateType):
        return item.isoformat()
    if isinstance(subtype, DatetimeType):
        # NOTE replacing microseconds to get rid of %f, we dont want that in outputs
        return item.replace(microsecond=0).isoformat()
    if isinstance(subtype, StringType):
        return f"'{item}'"
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
        items_str = ",".join(_serialize_enum_item(item, self.subtype) for item in self.items)
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
        items_str = ",".join(_serialize_enum_item(item, self.subtype) for item in self.items)
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
        super().__init__(FloatType(real=True))

    def validate_convert(self, value: Any) -> list[float]:
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


# GRID TYPES


class NamedGridType(StringType):
    """A string representing a named grid"""

    def _is_gaussian_grid(self, value: str) -> bool:
        """Check if the value is a valid Gaussian grid name, e.g., 'N320'."""
        if not isinstance(value, str):
            return False
        if not value[1:].isdigit():
            return False
        if value[0].upper() in ["N", "O"]:
            return True
        return False

    def validate_convert(self, value: Any) -> str:
        v = super().validate_convert(value)

        if not self._is_gaussian_grid(v):
            raise WrongType(f"{v!r} is not a valid grid name. Must be a Gaussian grid (e.g., 'N320').")
        return v

    def serialize(self) -> str:
        return "named-grid"


class LatLonGridType(FloatType):
    """A float representing the latitude or longitude resolution of a grid. Must be positive."""

    def validate_convert(self, value: Any) -> float:
        v = super().validate_convert(value)
        if v <= 0:
            raise WrongType(f"Grid resolution must be positive, got {v}")
        return v


class TupleFloatGridType(ListType):
    """A list of exactly two floats representing a grid resolution, e.g., [lat_res, lon_res]."""

    def __init__(self) -> None:
        super().__init__(FloatType())

    def validate_convert(self, value: Any) -> list[float]:
        result = super().validate_convert(value)
        if len(result) != 2:
            raise WrongType(f"TupleFloatGridType must have exactly 2 elements, got {len(result)}")
        lat_res, lon_res = result
        if lat_res <= 0 or lon_res <= 0:
            raise WrongType(f"Grid resolutions must be positive floats, got lat_res={lat_res}, lon_res={lon_res}")
        return result

    def serialize(self) -> str:
        return "tuple-float-grid"


class GridType(UnionType):
    """An alias for a union over named grid and tuple of floats representing grid resolution."""

    def __init__(self) -> None:
        super().__init__([NamedGridType(), TupleFloatGridType(), LatLonGridType()])

    def serialize(self) -> str:
        return "grid"


class ArtifactType(FableType):
    """A string representing an id from the artifact catalog. Utilized by the frontend
    to perform catalog lookup to build a better UI form, displaying additional info."""

    # NOTE we are being careful here as we dont want to introduce a strict dependency
    # of types on artifacts. Hence the (exceptional) string annotation, in-body import,
    # defensive lookup, etc
    def validate_convert(self, value: Any) -> "fiab_core.artifacts.CompositeArtifactId":
        if not isinstance(value, str):
            raise NotStringInput(f"Expected string, got {type(value).__name__}")
        from fiab_core.artifacts import ArtifactsProvider, CompositeArtifactId

        try:
            artifact_id = CompositeArtifactId.from_str(value)
        except Exception as e:
            raise WrongType(f"{value} is not a CompositeArtifactId: {e!r}") from None
        try:
            lookup = ArtifactsProvider.get_artifacts_lookup()
        except RuntimeError as e:
            logger.warning(f"no artifacts provider -- will not validate! {e!r}")
            return artifact_id
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
