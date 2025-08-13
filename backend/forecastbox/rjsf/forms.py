# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

# Pydantic models for form definitions that combine JSON Schema and UI Schema for React JSON Schema Form (RJSF).
# These models define how forms are structured and rendered using both JSON Schema and UI Schema components.
# https://rjsf-team.github.io/react-jsonschema-form/docs/

from typing import Any

from pydantic import BaseModel, Field
from typing_extensions import TypedDict

from .jsonSchema import FieldSchema
from .uiSchema import UISchema


class ExportedJsonSchema(TypedDict):
    title: str
    type: str
    required: list[str]
    properties: dict[str, dict]
    """The JSON Schema definition for the form."""


class ExportedSchemas(TypedDict):
    jsonSchema: ExportedJsonSchema
    uiSchema: dict[str, dict]
    formData: dict[str, Any]


# Combined Schema + UI
class FieldWithUI(BaseModel):
    """Combines a JSON Schema field with an optional UI Schema for RJSF."""

    jsonschema: FieldSchema
    """The JSON Schema definition for the field."""
    ui: UISchema | None = None
    """The UI Schema definition for the field (controls rendering and widgets)."""


class FormDefinition(BaseModel):
    """Defines a form using a set of fields, each with JSON Schema and optional UI Schema."""

    title: str
    """The title of the form."""
    fields: dict[str, FieldWithUI]
    """The fields in the form, keyed by field name."""
    required: list[str] | None = []
    """list of required field names."""
    submitButtonOptions: dict[str, Any] | None = None
    """Options for submit button, such as label and props."""
    formData: dict[str, Any] = Field(default_factory=dict)

    def export_jsonschema(self) -> ExportedJsonSchema:
        """Exports the form definition as a JSON Schema object.
        This includes the title, type, required fields, and properties for each field.
        """
        return {
            "title": self.title,
            "type": "object",
            "required": self.required or [],
            "properties": {key: field.jsonschema.model_dump(exclude_none=True) for key, field in self.fields.items()},
        }

    def export_uischema(self) -> dict[str, Any]:
        """Exports the form definition as a UI Schema object.
        This includes the UI options for each field that has a UI Schema defined.
        """
        uischema = {key: field.ui.export_with_prefix() for key, field in self.fields.items() if field.ui}
        if self.submitButtonOptions:
            uischema["ui:submitButtonOptions"] = self.submitButtonOptions
        return uischema

    def export_all(self) -> ExportedSchemas:
        """Exports both JSON Schema and UI Schema in a combined format.
        This is useful for rendering forms in RJSF.
        """
        return {"jsonSchema": self.export_jsonschema(), "uiSchema": self.export_uischema(), 'formData': self.formData}
