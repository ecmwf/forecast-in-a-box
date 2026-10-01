# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Traits: additional validations that can be mixed into any FableType, eg ``int{positive}``
or ``float{nonNegative, divisibleBy(3)}``. Traits are declared independently of the type they
decorate, and are deliberately implemented in a generic fashion (relying on python dynamicity
of operators like ``>`` or ``%``) rather than special-casing the handful of base types they are
expected to be used with (Int, Float, TimeDelta).
"""

from abc import ABC, abstractmethod
from datetime import timedelta
from typing import Any

from cascade.low.func import Either

from fiab_core.types.dt_util import try_parse_timedelta
from fiab_core.types.exceptions import WrongType


class FableTrait(ABC):
    """Base class for all Fable trait expressions, mixed into a FableType to add extra validation
    on top of the main type conversion, eg ``int{positive}``."""

    @abstractmethod
    def serialize_main(self) -> str:
        """Serialize this trait's own (name and arguments) representation, eg ``divisibleBy(3)``."""

    def serialize(self) -> str:
        """Serialize this trait to a string expression that can be parsed back as part of a type."""
        return self.serialize_main()

    @abstractmethod
    def validate(self, value: Any) -> Either[None, str]:  # ty:ignore[invalid-type-arguments] # semigroup
        """Validate an already converted value against this trait.

        Returns Either.ok(None) if the value satisfies the trait, or Either.error(message)
        with a human readable description of the failure.
        """


def _zero_like(value: Any) -> Any:
    """Construct a zero value of the same type as ``value``, eg 0, 0.0 or timedelta(0).

    Relies on all the supported value types (int, float, timedelta) accepting a single
    integer 0 argument in their constructor to produce their respective zero value.
    """
    return type(value)(0)


class Positive(FableTrait):
    """Requires the value to be strictly greater than zero."""

    def serialize_main(self) -> str:
        return "positive"

    def validate(self, value: Any) -> Either[None, str]:  # ty:ignore[invalid-type-arguments] # semigroup
        if value > _zero_like(value):
            return Either.ok(None)
        return Either.error(f"{value!r} is not positive")


class NonNegative(FableTrait):
    """Requires the value to be greater than or equal to zero."""

    def serialize_main(self) -> str:
        return "nonNegative"

    def validate(self, value: Any) -> Either[None, str]:  # ty:ignore[invalid-type-arguments] # semigroup
        if value >= _zero_like(value):
            return Either.ok(None)
        return Either.error(f"{value!r} is not non-negative")


class DivisibleBy(FableTrait):
    """Requires the value to be evenly divisible by ``n``.

    ``n`` is given either as a plain number (int/float, for Int/Float typed values) or as a
    raw string, since the trait is declared independently of the type it is applied to -- a
    string argument may be a plain number or an ISO 8601 duration (for TimeDelta). Both
    interpretations are attempted eagerly at construction time, and the matching one is
    picked at validation time based on the actual value's type.
    """

    def __init__(self, n: int | float | str) -> None:
        self.raw = n.strip() if isinstance(n, str) else str(n)
        self.numeric: int | float | None = None
        if isinstance(n, (int, float)):
            self.numeric = n
        else:
            try:
                self.numeric = int(self.raw)
            except ValueError:
                try:
                    self.numeric = float(self.raw)
                except ValueError:
                    self.numeric = None
        self.duration: timedelta | None = try_parse_timedelta(self.raw)
        if self.numeric is None and self.duration is None:
            raise WrongType(f"divisibleBy argument {n!r} is neither a number nor a timedelta")

    def serialize_main(self) -> str:
        return f"divisibleBy({self.raw})"

    def validate(self, value: Any) -> Either[None, str]:  # ty:ignore[invalid-type-arguments] # semigroup
        divisor = self.duration if isinstance(value, timedelta) else self.numeric
        if divisor is None:
            return Either.error(f"{value!r} cannot be checked against divisibleBy({self.raw})")
        try:
            remainder = value % divisor
        except TypeError as e:
            return Either.error(f"{value!r} cannot be checked against divisibleBy({self.raw}): {e}")
        if remainder != _zero_like(remainder):
            return Either.error(f"{value!r} is not divisible by {self.raw}")
        return Either.ok(None)
