# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Validation utilities for block configuration values."""

from .blocks import BlockInstanceConfigurationError


def positive(value: float, option_id: str) -> None:
    """Validator that raises BlockInstanceConfigurationError if value is not positive."""
    if value <= 0:
        raise BlockInstanceConfigurationError(f"Configuration option {option_id!r} must be positive, got {value!r}")


def negative(value: float, option_id: str) -> None:
    """Validator that raises BlockInstanceConfigurationError if value is not negative."""
    if value >= 0:
        raise BlockInstanceConfigurationError(f"Configuration option {option_id!r} must be negative, got {value!r}")


def non_negative(value: float, option_id: str) -> None:
    """Validator that raises BlockInstanceConfigurationError if value is negative."""
    if value < 0:
        raise BlockInstanceConfigurationError(f"Configuration option {option_id!r} must be non-negative, got {value!r}")


def non_positive(value: float, option_id: str) -> None:
    """Validator that raises BlockInstanceConfigurationError if value is positive."""
    if value > 0:
        raise BlockInstanceConfigurationError(f"Configuration option {option_id!r} must be non-positive, got {value!r}")
