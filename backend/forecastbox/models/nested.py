# (C) Copyright 2025- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.


from typing import Any

from forecastbox.rjsf import FieldWithUI, StringSchema, UIStringField

from .metadata import ControlMetadata
from .model import BaseForecastModel


class NestedModel(BaseForecastModel):
    @property
    def _regions(self) -> list[str]:
        assert self.control.nested is not None, "NestedModel requires a 'nested' configuration in the control metadata."
        return list(self.control.nested.keys())[:-1]

    def validate_checkpoint(self):
        if not self.control.nested:
            raise ValueError("NestedModel requires a 'nested' configuration in the control metadata.")
        if self.control.input_source:
            raise ValueError("NestedModel does not support 'input_source' in control metadata. Use 'nested' instead.")

    def _create_input_configuration(self, control: ControlMetadata) -> dict[str, dict[str, Any]]:
        assert control.nested is not None, "NestedModel requires a 'nested' configuration in the control metadata."
        return {
            'cutout': control.nested,
        }

    def _post_processors(self, kwargs: dict[str, Any]) -> list[dict[str, Any]]:
        return [{'extract_from_state': kwargs.get('region', self._regions[0])}]

    @property
    def _pkg_versions(self) -> dict[str, str]:
        """Model specific override for package versions."""
        return {
            'anemoi-plugins-ecmwf-inference[mir,regrid]': "0.1.3",
        }

    @property
    def _execution_kwargs(self) -> dict[str, Any]:
        """Model specific execution kwargs."""
        return {
            "output": {"out": {"templates": "mir", "check_encoding": False}},
        }

    @property
    def _extra_form_fields(self) -> dict[str, FieldWithUI]:
        """Extra fields to be added to the model definition form."""
        return {
            "region": FieldWithUI(
                jsonschema=StringSchema(
                    title="Region",
                    description="The region to extract of the nested model.",
                    enum=self._regions, # type: ignore
                    default=self._regions[0],
                ),
                ui=UIStringField(widget="select"),
            ),
        }
