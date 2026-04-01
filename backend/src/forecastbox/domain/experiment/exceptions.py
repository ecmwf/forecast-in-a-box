# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Domain exceptions for the experiment domain."""


class ExperimentNotFound(Exception):
    """Raised when an experiment blueprint does not exist or has been deleted."""


class ExperimentAccessDenied(Exception):
    """Raised when the actor does not have permission to perform the operation."""


class ExperimentVersionConflict(Exception):
    """Raised when the provided version does not match the current version in the database."""


class SchedulerBusy(Exception):
    """Raised when the scheduler lock cannot be acquired within the timeout."""
