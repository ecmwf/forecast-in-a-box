# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Domain exceptions for the job definition layer.

Raised by domain.job_definition.db and domain.job_definition.service; translated to
HTTP responses at the router boundary.
"""


class JobDefinitionNotFound(Exception):
    """Raised when a requested JobDefinition does not exist (or has been soft-deleted)."""


class JobDefinitionAccessDenied(Exception):
    """Raised when the actor lacks permission to mutate a JobDefinition."""


class JobDefinitionVersionConflict(Exception):
    """Raised when the provided version does not match the current version in the database."""
