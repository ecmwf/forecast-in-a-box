# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Domain exceptions for the blueprint layer.

Raised by domain.blueprint.db and domain.blueprint.service; translated to
HTTP responses at the router boundary.
"""


class BlueprintNotFound(Exception):
    """Raised when a requested Blueprint does not exist (or has been soft-deleted)."""


class BlueprintAccessDenied(Exception):
    """Raised when the actor lacks permission to mutate a Blueprint."""


class BlueprintVersionConflict(Exception):
    """Raised when the provided version does not match the current version in the database."""
