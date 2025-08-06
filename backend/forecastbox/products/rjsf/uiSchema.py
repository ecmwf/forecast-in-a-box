# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

# A pydantic implementation of the UI Schema for React JSON Schema Form (RJSF).
# This schema defines how the UI should be rendered based on the JSON Schema.
# https://rjsf-team.github.io/react-jsonschema-form/docs/

from typing import Any
from typing import Optional
from typing import Union

from pydantic import BaseModel
from pydantic import Field


class UIField(BaseModel):
    """Base UI schema field for RJSF.

    See Also
    --------
    https://rjsf-team.github.io/react-jsonschema-form/docs/api-reference/uiSchema

    Examples
    --------
    >>> UIField(widget="text", placeholder="Enter your name", autofocus=True)
    >>> UIField(classNames="my-class", style={"color": "red"})
    """

    widget: Optional[str] = None
    """Widget type to use for this field (e.g., 'text', 'textarea', 'checkbox', etc.)."""
    classNames: Optional[str] = None
    """CSS class names to apply to the field container."""
    style: Optional[dict[str, str]] = None
    """Inline styles to apply to the field container."""
    autocomplete: Optional[str] = None
    """HTML autocomplete attribute value."""
    autofocus: Optional[bool] = None
    """If True, the field will be auto-focused."""
    description: Optional[str] = None
    """Custom description for the field."""
    disabled: Optional[bool] = None
    """If True, the field will be disabled."""
    emptyValue: Optional[Any] = None
    """Value to use when the field is empty."""
    enumDisabled: Optional[list[Any]] = None
    """list of enum values to disable in a select."""
    enumNames: Optional[list[str]] = None
    """Custom display names for enum options."""
    help: Optional[str] = None
    """Help text to display below the field."""
    hideError: Optional[bool] = None
    """If True, validation errors will be hidden."""
    inputType: Optional[str] = None
    """HTML input type (e.g., 'text', 'number')."""
    label: Optional[bool] = None
    """If False, the label will be hidden."""
    order: Optional[list[str]] = None
    """Order of fields in the UI schema, if applicable."""
    placeholder: Optional[str] = None
    """Placeholder text for the field."""
    readonly: Optional[bool] = None
    """If True, the field will be read-only."""
    rows: Optional[int] = None
    """Number of rows for textarea widgets."""
    title: Optional[str] = None
    """Custom title for the field."""

    def export_with_prefix(self) -> dict[str, Any]:
        return {"ui:options": self.model_dump(exclude_none=True)}


class UIStringField(UIField):
    """UI schema for string fields.

    Examples
    --------
    >>> UIStringField(widget="textarea", format="email")
    """

    widget: Optional[str] = Field(default="text")
    """Widget type for string fields, default is 'text'."""
    format: Optional[str] = None
    """Format for string fields (e.g., 'email', 'date')."""


class UIIntegerField(UIField):
    """UI schema for integer fields.

    Examples
    --------
    >>> UIIntegerField(widget="updown")
    """

    widget: Optional[str] = Field(default="updown")
    """Widget type for integer fields, default is 'updown'."""


class UIBooleanField(UIField):
    """UI schema for boolean fields.

    Examples
    --------
    >>> UIBooleanField(widget="checkbox")
    """

    widget: Optional[str] = Field(default="checkbox")
    """Widget type for boolean fields, default is 'checkbox'."""


class UIObjectField(BaseModel):
    """UI schema for object fields.

    Allows for setting the anyOf, oneOf keys.

    Examples
    --------
    >>> UIObjectField(anyOf=[UIStringField(widget="text"), UIIntegerField(widget="updown")])
    """

    anyOf: Optional[list["UISchema"]] = None
    """list of schemas for 'anyOf' condition."""
    oneOf: Optional[list["UISchema"]] = None
    """list of schemas for 'oneOf' condition."""

    def export_with_prefix(self) -> dict[str, Any]:
        """Export the UI schema with prefix."""
        result = {}
        if self.anyOf:
            result["anyOf"] = [schema.export_with_prefix() for schema in self.anyOf]
        if self.oneOf:
            result["oneOf"] = [schema.export_with_prefix() for schema in self.oneOf]
        return result


UISchema = Union[UIStringField, UIIntegerField, UIBooleanField, UIObjectField, UIField]
"""Union type for all UI schema field types."""

UIObjectField.model_rebuild()

__all__ = ["UIField", "UIStringField", "UIIntegerField", "UIBooleanField", "UIObjectField", "UISchema"]
