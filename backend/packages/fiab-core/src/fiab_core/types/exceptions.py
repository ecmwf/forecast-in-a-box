# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Parsing and type exceptions"""


class NotFableType(Exception):
    """Raised when a type expression cannot be parsed."""


class NotStringInput(TypeError):
    """Raised when validate_convert receives a non-string input."""


class NotNoneInput(TypeError):
    """Raised when validate_convert of a none-typed value receives a non-None input."""


class WrongType(Exception):
    """Raised when a value cannot be converted to the target type."""
