# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Domain exceptions of the event trigger service.  Not-found and version conflicts derive
from the general experiment exceptions, so callers may catch either."""

from forecastbox.domain.experiment.exceptions import ExperimentNotFound, ExperimentVersionConflict


class TriggerNotFound(ExperimentNotFound):
    """Raised when a trigger experiment does not exist, is deleted, is not visible to the
    caller, or the experiment is not of the external-trigger type."""


class TriggerVersionConflict(ExperimentVersionConflict):
    """Raised when the version given in an update or delete is not the current version."""


class TriggerSpecInvalid(ValueError):
    """Raised when the trigger specification is invalid, eg a `glyph_map` target is not a
    valid glyph name."""
