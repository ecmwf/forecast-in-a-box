# (C) Copyright 2025- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.


from typing import Any

from .metadata import ControlMetadata
from .model import BaseForecastModel

DEFAULT_GLOBAL_INPUT_SOURCE = "opendata"


class GlobalModel(BaseForecastModel):
    def validate_checkpoint(self):
        if self.control.nested:
            raise ValueError("GlobalModel cannot have a 'nested' configuration in the control metadata.")

    def _create_input_configuration(self, control: ControlMetadata) -> str | dict[str, Any]:
        return control.input_source or DEFAULT_GLOBAL_INPUT_SOURCE
