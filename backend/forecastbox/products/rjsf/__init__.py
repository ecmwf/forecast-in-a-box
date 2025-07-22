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

from .forms import FieldWithUI
from .forms import FormDefinition
from .jsonSchema import ArraySchema
from .jsonSchema import BooleanSchema
from .jsonSchema import EnumMixin
from .jsonSchema import FieldSchema
from .jsonSchema import IntegerSchema
from .jsonSchema import NullSchema
from .jsonSchema import NumberSchema
from .jsonSchema import StringSchema
from .uiSchema import UIBooleanField
from .uiSchema import UIIntegerField
from .uiSchema import UISchema
from .uiSchema import UIStringField


def __update_enum_within_jsonschema(jsonschema: FieldSchema, new_enum: List[Any]) -> FieldSchema:
    """Update the enum of a JSON schema."""
    from .jsonSchema import ArraySchema
    from .jsonSchema import EnumMixin

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


__all__ = [
    "FormDefinition",
    "FieldWithUI",
    "FieldSchema",
    "EnumMixin",
    "ArraySchema",
    "StringSchema",
    "IntegerSchema",
    "NumberSchema",
    "BooleanSchema",
    "NullSchema",
    "UISchema",
    "UIStringField",
    "UIIntegerField",
    "UIBooleanField",
    "update_enum_within_field",
]
