# (C) Copyright 2025- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.


from .model import BaseForecastModel


class NestedModel(BaseForecastModel):
    def validate_checkpoint(self):
        if not self.control.nested:
            raise ValueError("NestedModel requires a 'nested' configuration in the control metadata.")

    region_to_extract: str | None = None
