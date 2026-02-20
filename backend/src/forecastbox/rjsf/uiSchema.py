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

from typing import Any, Union

from pydantic import BaseModel, Field


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

    widget: str | None = None
    """Widget type to use for this field (e.g., 'text', 'textarea', 'checkbox', etc.)."""
    classNames: str | None = None
    """CSS class names to apply to the field container."""
    style: dict[str, str] | None = None
    """Inline styles to apply to the field container."""
    autocomplete: str | None = None
    """HTML autocomplete attribute value."""
    autofocus: bool | None = None
    """If True, the field will be auto-focused."""
    description: str | None = None
    """Custom description for the field."""
    disabled: bool | None = None
    """If True, the field will be disabled."""
    enableMarkdownInDescription: bool | None = None
    """If True, Markdown will be enabled in the description."""
    emptyValue: Any | None = None
    """Value to use when the field is empty."""
    enumDisabled: list[Any] | None = None
    """list of enum values to disable in a select."""
    enumNames: list[str] | None = None
    """Custom display names for enum options."""
    help: str | None = None
    """Help text to display below the field."""
    hideError: bool | None = None
    """If True, validation errors will be hidden."""
    inputType: str | None = None
    """HTML input type (e.g., 'text', 'number')."""
    label: bool | None = None
    """If False, the label will be hidden."""
    order: list[str] | None = None
    """Order of fields in the UI schema, if applicable."""
    placeholder: str | None = None
    """Placeholder text for the field."""
    readonly: bool | None = None
    """If True, the field will be read-only."""
    rows: int | None = None
    """Number of rows for textarea widgets."""
    title: str | None = None
    """Custom title for the field."""

    def export_with_prefix(self, *, ignore_keys: list[str] | None = None) -> dict[str, Any]:
        model_dump = self.model_dump(exclude_none=True)
        if ignore_keys:
            model_dump = {k: v for k, v in model_dump.items() if k not in ignore_keys}
        if not model_dump:
            return {}
        return {"ui:options": model_dump}


class UIItems(BaseModel):
    """Base class for items in UI schema."""

    items: "dict[str, UISchema] | None" = None

    def export_with_prefix(self) -> dict[str, Any]:
        """Export the UI schema with prefix."""
        result = {}
        if self.items:
            result = {"items": {k: v.export_with_prefix() for k, v in self.items.items()}}
        return result


class UIAdditionalProperties(UIField):
    """Base class for additional properties in UI schema."""

    additionalProperties: "UISchema | None" = None

    def export_with_prefix(self, *, ignore_keys: list[str] | None = None) -> dict[str, Any]:
        """Export the UI schema with prefix."""
        ignore_keys = ignore_keys or []
        ignore_keys.append("additionalProperties")

        result = super().export_with_prefix(ignore_keys=ignore_keys)
        if self.additionalProperties:
            result = {"additionalProperties": self.additionalProperties.export_with_prefix(ignore_keys=ignore_keys)}
        return result


class UIStringField(UIField):
    """UI schema for string fields.

    Examples
    --------
    >>> UIStringField(widget="textarea", format="email")
    """

    widget: str | None = Field(default="text")
    """Widget type for string fields, default is 'text'."""
    format: str | None = None
    """Format for string fields (e.g., 'email', 'date')."""


class UIIntegerField(UIField):
    """UI schema for integer fields.

    Examples
    --------
    >>> UIIntegerField(widget="updown")
    """

    widget: str | None = Field(default="updown")
    """Widget type for integer fields, default is 'updown'."""


class UIBooleanField(UIField):
    """UI schema for boolean fields.

    Examples
    --------
    >>> UIBooleanField(widget="checkbox")
    """

    widget: str | None = Field(default="checkbox")
    """Widget type for boolean fields, default is 'checkbox'."""


class UIObjectField(UIField):
    """UI schema for object fields.

    Allows for setting the anyOf, oneOf keys.

    Examples
    --------
    >>> UIObjectField(anyOf=[UIStringField(widget="text"), UIIntegerField(widget="updown")])
    """

    anyOf: list["UISchema"] | None = None
    """list of schemas for 'anyOf' condition."""
    oneOf: list["UISchema"] | None = None
    """list of schemas for 'oneOf' condition."""

    def export_with_prefix(self, *, ignore_keys: list[str] | None = None) -> dict[str, Any]:
        """Export the UI schema with prefix."""
        ignore_keys = ignore_keys or []
        ignore_keys.extend(["anyOf", "oneOf"])
        result = super().export_with_prefix(ignore_keys=ignore_keys)

        if self.anyOf:
            result["anyOf"] = [schema.export_with_prefix(ignore_keys=ignore_keys) for schema in self.anyOf]
        if self.oneOf:
            result["oneOf"] = [schema.export_with_prefix(ignore_keys=ignore_keys) for schema in self.oneOf]
        return result


UISchema = Union[UIStringField, UIIntegerField, UIBooleanField, UIObjectField, UIField, UIAdditionalProperties, UIItems]
"""Union type for all UI schema field types."""

UIObjectField.model_rebuild()
UIItems.model_rebuild()
UIAdditionalProperties.model_rebuild()

__all__ = ["UIField", "UIStringField", "UIIntegerField", "UIBooleanField", "UIObjectField", "UISchema"]
