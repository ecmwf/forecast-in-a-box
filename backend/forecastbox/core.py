# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

from abc import ABC, abstractmethod

from forecastbox.rjsf import FieldWithUI


class FormFieldProvider(ABC):
    """Abstract base class for providing form fields for RJSF."""

    @property
    @abstractmethod
    def formfields(self) -> dict[str, FieldWithUI]:
        """Dictionary of form fields.

        Will be used to populate the form definition with fields that have both JSON Schema and optional UI Schema.
        """
        return {}
