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
import re
from abc import ABC, abstractmethod
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, Iterable, Literal, get_args

import fiab_core  # to satisfy the type checker for artifacts annotation
from fiab_core.metkit import MetkitParamResolver
from fiab_core.types.dt_util import parse_timedelta
from fiab_core.types.exceptions import NotNoneInput, NotStringInput, WrongType
from fiab_core.types.traits import FableTrait, Finite

logger = logging.getLogger(__name__)

_Traits = FableTrait | list[FableTrait] | None
"""Convenience alias accepted by FableType's constructor: a single trait, a list of them, or none."""

# BASE CLASS FOR ALL REAL TYPES


class FableType(ABC):
    """Base class for all Fable type expressions. Provides validation and conversion of string values.

    Supports mixing in traits (see fiab_core.types.traits), which add extra validation on top of
    the main type conversion and are serialized as a ``{}`` suffix, eg ``int{positive}``.
    """

    def __init__(self, traits: _Traits = None) -> None:
        """``traits`` may be a single FableTrait, a list of them, or None, for convenience at call sites
        that only need to attach a single trait, eg ``IntType(traits=Positive())``."""
        if traits is None:
            self.traits: list[FableTrait] = []
        elif isinstance(traits, FableTrait):
            self.traits = [traits]
        else:
            self.traits = list(traits)

    @abstractmethod
    def validate_convert_main(self, value: Any) -> Any:
        """Convert and validate a value according to this type, ignoring traits.

        Accepts a string value and returns the converted value, or raises:
        - TypeError if value is not a string
        - ValueError for validation failures (e.g., invalid format, enum membership)
        """
        # NOTE probably change to value: str and get rid of the NoStringInput exception? Or utilize that centrally and have children override internal method only

    def validate_convert(self, value: Any) -> Any:
        """Convert and validate a value according to this type, then validate it against each trait.

        Traits are only invoked if the main conversion succeeds. Issues are collected across all
        traits (not just the first failing one) and raised together as a single WrongType.
        """
        converted = self.validate_convert_main(value)
        issues: list[str] = []
        for trait in self.traits:
            result = trait.validate(converted)
            if result.e is not None:
                issues.append(result.e)
        if issues:
            raise WrongType(f"Trait validation failed for {value!r}: {'; '.join(issues)}")
        return converted

    @abstractmethod
    def serialize_main(self) -> str:
        """Serialize this type's own expression, ignoring traits, to a string that can be parsed back via parse()."""

    def serialize(self) -> str:
        """Serialize this type (including its traits) to a string expression that can be parsed back via parse()."""
        main = self.serialize_main()
        if not self.traits:
            return main
        traits_str = ",".join(trait.serialize() for trait in self.traits)
        return f"{main}{{{traits_str}}}"


# PRIMITIVE TYPES


class StringType(FableType):
    """The string type. Conversion is a no-op; validates that the type expression is valid."""

    def validate_convert_main(self, value: Any) -> str:
        if not isinstance(value, str):
            raise NotStringInput(f"Expected string, got {type(value).__name__}")
        return value

    def serialize_main(self) -> str:
        return "str"


class NoneType(FableType):
    """The none type. The only accepted value is ``None``, which is returned as-is.

    Meant to be used as a member of a union, eg ``union[int,none]``, to declare that
    an option accepts an explicit null. Note that an explicit null is a different thing
    than a missing value -- the latter is never passed to validate_convert at all."""

    def validate_convert_main(self, value: Any) -> None:
        if value is not None:
            raise NotNoneInput(f"Expected None, got {type(value).__name__}")
        return None

    def serialize_main(self) -> str:
        return "none"


class IntType(FableType):
    """The integer type. Converts string to int."""

    def validate_convert_main(self, value: Any) -> int:
        if not isinstance(value, str):
            raise NotStringInput(f"Expected string, got {type(value).__name__}")
        try:
            return int(value)
        except ValueError:
            raise WrongType(f"Cannot convert {value!r} to int")

    def serialize_main(self) -> str:
        return "int"


class FloatType(FableType):
    """The float type. Converts string to float. NaN and infinity are accepted unless the Finite trait is attached."""

    def validate_convert_main(self, value: Any) -> float:
        if not isinstance(value, str):
            raise NotStringInput(f"Expected string, got {type(value).__name__}")
        try:
            return float(value)
        except ValueError:
            raise WrongType(f"Cannot convert {value!r} to float")

    def serialize_main(self) -> str:
        return "float"


class DateType(FableType):
    """The date type. Converts ISO 8601 date string (YYYY-MM-DD) to datetime.date."""

    def validate_convert_main(self, value: Any) -> date:
        if not isinstance(value, str):
            raise NotStringInput(f"Expected string, got {type(value).__name__}")
        try:
            return datetime.strptime(value, "%Y-%m-%d").date()
        except ValueError:
            raise WrongType(f"Cannot parse {value!r} as date (expected ISO 8601 format: YYYY-MM-DD)")

    def serialize_main(self) -> str:
        return "date"


class DatetimeType(FableType):
    """The datetime type. Converts ISO 8601 datetime string to datetime.datetime.

    Accepts format: YYYY-MM-DDTHH:MM:SS or YYYY-MM-DDTHH:MM:SS.ffffff or with +HH:MM/-HH:MM timezone.
    """

    def validate_convert_main(self, value: Any) -> datetime:
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

    def serialize_main(self) -> str:
        return "datetime"


# NOTE deliberately no support for calendar-dependent components (years, months) since
# they do not correspond to a fixed duration and would make the conversion ambiguous.
# See fiab_core.types.dt_util.parse_timedelta for the actual parsing logic, shared with
# traits that need to opportunistically interpret an argument as a duration.


class TimeDeltaType(FableType):
    """The timedelta type. Converts an ISO 8601 duration string to datetime.timedelta.

    Supports the fixed-length components weeks (W), days (D), hours (H), minutes (M) and
    seconds (S, may be fractional), the latter three following a literal 'T' designator,
    e.g. 'P3DT12H30M', 'PT30M', 'P1W'. Calendar-dependent components (years, months) are
    not supported, since a fixed number of days cannot represent them unambiguously.

    The leading 'P' designator is optional on input for convenience, so e.g. 'T12H' or
    '3DT1M' are accepted too.
    """

    def validate_convert_main(self, value: Any) -> timedelta:
        if not isinstance(value, str):
            raise NotStringInput(f"Expected string, got {type(value).__name__}")
        return parse_timedelta(value)

    def serialize_main(self) -> str:
        return "timedelta"


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
    if isinstance(subtype, GridType):
        return GridType.value_to_str(item)
    return str(item)


class ClosedEnumType(FableType):
    """Closed enumeration type. Validates membership in the enum, converting via the given subtype.

    ``items`` are the raw (string) representations of the allowed values, converted eagerly at
    construction time via ``subtype``. ``subtype`` must be a FableType instance. Defaults
    to StringType for backwards compatibility.
    """

    def __init__(self, items: Iterable[Any], subtype: FableType = StringType(), traits: _Traits = None) -> None:
        super().__init__(traits)
        self.subtype = subtype
        self.items = [self.subtype.validate_convert(item) for item in items]
        self._item_set = set(self.items)

    def validate_convert_main(self, value: Any) -> Any:
        # NOTE no isinstance check here -- the subtype is responsible for rejecting
        # inputs of a wrong shape, and it may well accept a non-string one (eg NoneType)
        converted = self.subtype.validate_convert(value)
        if converted not in self._item_set:
            options = ", ".join(str(item) for item in self.items)
            raise WrongType(f"{value!r} is not a valid option. Valid options are: {options}")
        return converted

    def serialize_main(self) -> str:
        items_str = ",".join(_serialize_enum_item(item, self.subtype) for item in self.items)
        return f"enumClosed[{self.subtype.serialize()}]({items_str})"


class OpenEnumType(FableType):
    """Open enumeration type. Accepts any value convertible via the subtype; membership is not enforced.

    See ClosedEnumType for the meaning of ``items`` and ``subtype``.
    """

    def __init__(self, items: Iterable[Any], subtype: FableType = StringType(), traits: _Traits = None) -> None:
        super().__init__(traits)
        self.subtype = subtype
        self.items = [self.subtype.validate_convert(item) for item in items]

    def validate_convert_main(self, value: Any) -> Any:
        # NOTE see the comment in ClosedEnumType.validate_convert
        return self.subtype.validate_convert(value)

    def serialize_main(self) -> str:
        items_str = ",".join(_serialize_enum_item(item, self.subtype) for item in self.items)
        return f"enumOpen[{self.subtype.serialize()}]({items_str})"


class ListType(FableType):
    """List type. Converts comma-separated string to a list by validating and converting each item."""

    def __init__(self, item_type: FableType, traits: _Traits = None) -> None:
        super().__init__(traits)
        self.item_type = item_type

    def validate_convert_main(self, value: Any) -> list[Any]:
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
            except (NotStringInput, NotNoneInput, WrongType) as e:
                raise WrongType(f"Error converting list item at index {i} ({item!r}): {e}")

        return result

    def serialize_main(self) -> str:
        return f"list[{self.item_type.serialize()}]"


class UnionType(FableType):
    """Union type. Tries each member type in order and returns the first successful conversion."""

    def __init__(self, types: list[FableType], traits: _Traits = None) -> None:
        super().__init__(traits)
        self.types = types

    def validate_convert_main(self, value: Any) -> Any:
        # NOTE we deliberately try the member types *before* checking that the input is a
        # string, because some members (notably NoneType) legitimately accept a non-string
        # input. Only if no member accepted the value do we report the non-string input.
        # This makes an input like a list against `union[none]` report NotStringInput, which
        # is a bit misleading, but we accept that in exchange for a simpler implementation.
        for t in self.types:
            try:
                return t.validate_convert(value)
            except (WrongType, NotStringInput, NotNoneInput):
                continue
        if not isinstance(value, str):
            raise NotStringInput(f"Expected string, got {type(value).__name__}")
        raise WrongType(f"Cannot convert {value!r} to any of: {', '.join(t.serialize() for t in self.types)}")

    def serialize_main(self) -> str:
        return f"union[{','.join(t.serialize() for t in self.types)}]"


# DOMAIN TYPES


class BoundingBoxWSENType(ListType):
    """Bounding box type. A list of exactly four integers: [west, south, east, north]. Validates eg:
    - latitudes are [-90, 90],
    - south <= north;
    - west > east is allowed and means the box crosses the antimeridian."""

    def __init__(self, traits: _Traits = None) -> None:
        super().__init__(FloatType(traits=Finite()), traits=traits)

    def validate_convert_main(self, value: Any) -> list[float]:
        result = super().validate_convert_main(value)
        if len(result) != 4:
            raise WrongType(f"BoundingBoxWSEN must have exactly 4 elements, got {len(result)}")
        west, south, east, north = result
        if not (-90 <= south <= 90 and -90 <= north <= 90):
            raise WrongType(f"Invalid bounding box latitudes south={south}, north={north} (must be within [-90, 90])")
        if south > north:
            raise WrongType(f"Invalid bounding box: south ({south}) must be <= north ({north})")
        return result

    def serialize_main(self) -> str:
        return "bboxWSEN"


# NOTE convert to Type class if ever needs to be `serialize`d
UnrestrictedGeoDomainLiteral = Literal["auto", "global", "datadefined"]
UnrestrictedGeoDomainAlias = ClosedEnumType(get_args(UnrestrictedGeoDomainLiteral))


class GeoDomainSingleType(StringType):
    """Country/domain type. A string representing a country or preset area like Europe or Arctic (detailed validation to be added later)."""

    def validate_convert_main(self, value: Any) -> str:
        v = super().validate_convert_main(value)
        if v in UnrestrictedGeoDomainAlias.items:
            raise WrongType("cannot use {v} within country/domain, as that is a special value")
        try:
            float(v)
            raise WrongType(f"a number '{v}' is not a geo domain")
        except ValueError:
            pass
        return v

    def serialize_main(self) -> str:
        return "geodomainSingle"


class GeoDomainType(UnionType):
    """An alias for a union over bounding box, list of single geo domains, and a single geo domain type."""

    def __init__(self, traits: _Traits = None) -> None:
        super().__init__([BoundingBoxWSENType(), UnrestrictedGeoDomainAlias, ListType(GeoDomainSingleType())], traits=traits)

    def serialize_main(self) -> str:
        return "geodomain"


# GRID TYPES

GridValue = str | int | float | list[int | float]
"""A converted grid: a Gaussian grid name, a single resolution in degrees, or a [west_east, south_north] pair of resolutions."""


MIN_GRID_RESOLUTION = 0.01
"""The finest lat/lon increment in degrees, inclusive."""

MIN_GAUSSIAN_NUMBER = 1
MAX_GAUSSIAN_NUMBER = 8000
"""The inclusive range of the number of a Gaussian grid name, such as 320 in 'N320'."""

_GAUSSIAN_NAME = re.compile(r"([NnOo])([0-9]+)")


def _is_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _check_resolution(resolution: Any, value: Any) -> None:
    """Raise unless the resolution in degrees is a finite number of at least the minimum, with value being the whole input."""
    if not _is_number(resolution) or not math.isfinite(resolution) or resolution <= 0:
        raise WrongType(f"Resolution {resolution!r} in {value!r} must be a positive finite number of degrees.")
    if resolution < MIN_GRID_RESOLUTION:
        raise WrongType(f"Resolution {resolution!r} in {value!r} is finer than the minimum of {MIN_GRID_RESOLUTION} degrees.")


class GridType(FableType):
    """Grid type. A union of a named Gaussian grid ('N320' or 'O96', in any case, with a number from 1 to 8000), a single resolution
    in degrees, and a pair of resolutions in degrees written 'west_east/south_north', the order used by MARS and MIR. A resolution
    is at least 0.01 degrees. The string 'auto' converts to None, and a Gaussian grid name converts to its upper case form."""

    def _validate_gaussian_grid(self, value: str, match: re.Match[str]) -> str:
        digits = match.group(2)
        number = int(digits)
        if not MIN_GAUSSIAN_NUMBER <= number <= MAX_GAUSSIAN_NUMBER:
            raise WrongType(f"Gaussian grid number {number} in {value!r} must be from {MIN_GAUSSIAN_NUMBER} to {MAX_GAUSSIAN_NUMBER}.")
        if digits != str(number):
            raise WrongType(f"Gaussian grid number {digits!r} in {value!r} must not have leading zeros.")
        return f"{match.group(1).upper()}{number}"

    def _validate_string_resolution(self, value: str) -> float | list[float]:
        parts = value.split("/")
        if len(parts) > 2:
            raise WrongType(f"String value {value!r} has more than two resolutions.")
        try:
            resolutions = [float(part) for part in parts]
        except ValueError:
            raise WrongType(
                f"String value {value!r} is neither a valid Gaussian grid, a valid resolution, a pair of resolutions, or 'auto'."
            ) from None
        for resolution in resolutions:
            _check_resolution(resolution, value)
        return resolutions if len(resolutions) == 2 else resolutions[0]

    def _validate_list_resolution(self, value: list) -> list[int | float]:
        if len(value) != 2:
            raise WrongType(f"List value {value!r} must hold two resolutions.")
        for resolution in value:
            _check_resolution(resolution, value)
        return value

    def validate_convert_main(self, value: Any) -> GridValue | None:
        if isinstance(value, str):
            if value == "auto":
                return None
            if match := _GAUSSIAN_NAME.fullmatch(value):
                return self._validate_gaussian_grid(value, match)
            return self._validate_string_resolution(value)

        if isinstance(value, list):
            return self._validate_list_resolution(value)

        if isinstance(value, (int, float)):
            _check_resolution(value, value)
            return value

        raise WrongType(f"Value {value!r} is not a valid grid type")

    @staticmethod
    def value_to_str(value: GridValue | None) -> str:
        """Return the canonical string of a converted grid, which converts back to the same grid.

        None is 'auto', a Gaussian grid name is as converted, a resolution is its shortest decimal without a trailing '.0' (for
        example '0.25' or '1'), and a pair is the two such strings joined by a slash in west-east, south-north order.
        """
        if value is None:
            return "auto"
        if isinstance(value, str):
            return value
        if isinstance(value, list):
            return "/".join(GridType.value_to_str(resolution) for resolution in value)
        return format(Decimal(repr(float(value))).normalize(), "f")

    def serialize_main(self) -> str:
        return "grid"


class ArtifactType(FableType):
    """A string representing an id from the artifact catalog. Utilized by the frontend
    to perform catalog lookup to build a better UI form, displaying additional info."""

    # NOTE we are being careful here as we dont want to introduce a strict dependency
    # of types on artifacts. Hence the (exceptional) string annotation, in-body import,
    # defensive lookup, etc
    def validate_convert_main(self, value: Any) -> "fiab_core.artifacts.CompositeArtifactId":
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

    def serialize_main(self) -> str:
        return "artifact"


class ParameterType(StringType):
    """A string representing a parameter  or id, like 2t or u or v. Utilized by the frontend
    to perform param lookup to build a better UI form, displaying additional info,
    name conversion, etc"""

    def validate_convert_main(self, value: Any) -> str:
        value: str = super().validate_convert_main(value)
        try:
            paramid = int(value)
            shortname = MetkitParamResolver.param_id_to_shortname(paramid)
        except RuntimeError as error:
            logger.warning(f"no Metkit parameter resolver -- will not validate: {error!r}")
        else:
            if shortname is None:
                raise WrongType("{paramid=} is not known to Metkit ParamDB")

        return value

    def serialize_main(self) -> str:
        return "param"
