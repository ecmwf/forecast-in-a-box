# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

# Main module interface for React JSON Schema Form (RJSF) integration.
# Provides pydantic implementations for both JSON Schema and UI Schema components,
# enabling definition and rendering of forms based on JSON Schema.
# https://rjsf-team.github.io/react-jsonschema-form/docs/


from typing import Any
from typing import List
from typing import Optional
from typing import TypeVar

from .forms import FieldWithUI
from .jsonSchema import ArraySchema
from .jsonSchema import EnumMixin
from .jsonSchema import FieldSchema
from .jsonSchema import ObjectSchema
from .jsonSchema import StringSchema
from .uiSchema import UIField
from .uiSchema import UIObjectField
from .uiSchema import UISchema


def __update_enum_within_jsonschema(jsonschema: FieldSchema, new_enum: List[Any]) -> FieldSchema:
    """Update the enum of a JSON schema."""

    if isinstance(jsonschema, EnumMixin):
        jsonschema.update_enum(new_enum)
    elif isinstance(jsonschema, ArraySchema):
        jsonschema.items = __update_enum_within_jsonschema(jsonschema.items, new_enum)
    else:
        raise TypeError("JSON schema does not support enum updates")
    return jsonschema


def update_enum_within_field(field: FieldWithUI, new_enum: List[Any]) -> FieldWithUI:
    """Update the enum of a field's JSON schema.

    Will only update the JSON schema if it supports enums,
    or is an array schema with items that support enums.

    Parameters
    ----------
    field : FieldWithUI
        The field to update.
    new_enum : List[Any]
        The new enum values to set.

    Returns
    -------
    FieldWithUI
        The updated field.

    Raises
    ------
    TypeError
        If the JSON schema does not support enum updates.
    """
    field.jsonschema = __update_enum_within_jsonschema(field.jsonschema, new_enum)
    return field


F = TypeVar("Field", bound=FieldSchema)
UI = TypeVar("UI", bound=UISchema)


def __collapse_enums_if_possible(jsonschema: FieldSchema, uischema: Optional[UI] = None) -> tuple[StringSchema, UI]:
    uischema = uischema or UIField(widget="text")
    if not isinstance(uischema, UIField):
        raise TypeError("UI schema must be a UIField to collapse enums")

    assert isinstance(jsonschema, EnumMixin), "JSON schema must support enum to collapse"
    assert jsonschema.enum and len(jsonschema.enum) == 1, "JSON schema enum must have exactly one value to collapse"

    uischema.readonly = True
    jsonschema = StringSchema(
        type="string",
        title=jsonschema.title,
        default=jsonschema.enum[0],
    )
    return jsonschema, uischema


def collapse_enums_if_possible(field: FieldWithUI) -> FieldWithUI:
    """Collapse enum values into a read only value
    if only one possible value is defined.

    Parameters
    ----------
    field : FieldWithUI
        The field to collapse enums for.

    Returns
    -------
    FieldWithUI
        The updated field with collapsed enums.
    """
    if isinstance(field.jsonschema, EnumMixin):
        if not field.jsonschema.enum or len(field.jsonschema.enum) > 1:
            return field

        # If there's only one enum value, collapse it to a read-only field
        field.jsonschema, field.ui = __collapse_enums_if_possible(field.jsonschema, field.ui)

    elif isinstance(field.jsonschema, ArraySchema) and isinstance(field.jsonschema.items, EnumMixin):
        if not field.jsonschema.items.enum or len(field.jsonschema.items.enum) > 1:
            return field

        field.jsonschema.items, uischema = __collapse_enums_if_possible(field.jsonschema.items, field.ui)
        field.ui = UIObjectField(anyOf=[uischema])

    elif isinstance(field.jsonschema, ObjectSchema):
        pass  # TODO: Handle object schemas with enum properties

    return field


__all__ = [
    "collapse_enums_if_possible",
    "update_enum_within_field",
]
