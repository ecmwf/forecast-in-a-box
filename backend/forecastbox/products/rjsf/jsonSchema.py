# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

# A pydantic implementation of JSON Schema for React JSON Schema Form (RJSF).
# This schema defines the structure of data as expected by RJSF based on the JSON Schema specification.
# https://rjsf-team.github.io/react-jsonschema-form/docs/

from typing import Any
from typing import Literal
from typing import Optional
from typing import Union

from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field


# Base Schema with discriminator
class BaseSchema(BaseModel):
    """Base class for all JSON Schema types.

    Examples
    --------
    >>> BaseSchema(title="Example", description="A base schema", default=None)
    """

    title: Optional[str] = None
    """Title of the schema."""
    description: Optional[str] = None
    """Description of the schema."""
    default: Optional[Any] = None
    """Default value for the schema."""
    additionalProperties: Optional[dict[str, Any]] = None
    """Additional properties allowed in the schema."""

    model_config = ConfigDict(extra="allow", use_enum_values=True, json_schema_extra={"discriminator": "type"})

    def update(self, *a, **k):
        pass


class EnumMixin:
    """Mixin for schemas that can have an enum.

    Examples
    --------
    >>> class MyEnumSchema(EnumMixin):
    ...     enum = ["a", "b", "c"]
    ...
    >>> s = MyEnumSchema()
    >>> s.update_enum(["x", "y"])
    """

    enum: Optional[list[Any]] = None
    """list of allowed values for the schema."""

    def update_enum(self, new_enum: list[Any]):
        if not isinstance(new_enum, list):
            raise TypeError("Enum must be a list")
        self.enum = new_enum


class StringSchema(BaseSchema, EnumMixin):
    """JSON Schema for string type.

    See Also
    --------
    https://json-schema.org/understanding-json-schema/reference/string.html

    Examples
    --------
    >>> StringSchema(type="string", title="Name", minLength=1, maxLength=10)
    >>> StringSchema(type="string", enum=["a", "b"])
    """

    type: Literal["string"] = Field(default="string")
    format: Optional[str] = None
    """String format (e.g., 'date', 'email')."""
    minLength: Optional[int] = None
    """Minimum length."""
    maxLength: Optional[int] = None
    """Maximum length."""

class IntegerSchema(BaseSchema, EnumMixin):
    """JSON Schema for integer type.

    See Also
    --------
    https://json-schema.org/understanding-json-schema/reference/numeric.html

    Examples
    --------
    >>> IntegerSchema(type="integer", minimum=0, maximum=100)
    >>> IntegerSchema(type="integer", enum=[1, 2, 3])
    """

    type: Literal["integer"] = Field(default="integer")
    minimum: Optional[int] = None
    """Minimum value."""
    maximum: Optional[int] = None
    """Maximum value."""
    multipleOf: Optional[int] = None
    """Value must be a multiple of this number."""

class NumberSchema(BaseSchema, EnumMixin):
    """JSON Schema for number type (float or int).

    See Also
    --------
    https://json-schema.org/understanding-json-schema/reference/numeric.html

    Examples
    --------
    >>> NumberSchema(type="number", minimum=0.0, maximum=10.0)
    >>> NumberSchema(type="number", enum=[1.1, 2.2])
    """

    type: Literal["number"] = Field(default="number")
    """Must be 'number'."""
    minimum: Optional[float] = None
    """Minimum value."""
    maximum: Optional[float] = None
    """Maximum value."""

class BooleanSchema(BaseSchema):
    """JSON Schema for boolean type.

    See Also
    --------
    https://json-schema.org/understanding-json-schema/reference/boolean.html

    Examples
    --------
    >>> BooleanSchema(type="boolean")
    """

    type: Literal["boolean"] = Field(default="boolean")


class NullSchema(BaseSchema):
    """JSON Schema for null type.

    See Also
    --------
    https://json-schema.org/understanding-json-schema/reference/null.html

    Examples
    --------
    >>> NullSchema(type="null")
    """

    type: Literal["null"] = Field(default="null")


class ObjectSchema(BaseSchema):
    """JSON Schema for object type.

    See Also
    --------
    https://json-schema.org/understanding-json-schema/reference/object.html

    Examples
    --------
    >>> ObjectSchema(type="object", properties={"name": StringSchema(type="string")}, required=["name"])
    """

    type: Literal["object"] = Field(default="object")
    properties: dict[str, "FieldSchema"]
    """Underlying fields of the object."""
    required: Optional[list[str]] = None
    """list of required property names."""

    anyOf: Optional[list["FieldSchema"]] = None
    oneOf: Optional[list["FieldSchema"]] = None
    allOf: Optional[list["FieldSchema"]] = None


class ArraySchema(BaseSchema):
    """JSON Schema for array type.

    See Also
    --------
    https://json-schema.org/understanding-json-schema/reference/array.html

    Examples
    --------
    >>> ArraySchema(type="array", items=StringSchema(type="string", enum=["test", "wow"]), minItems=1)
    """

    type: Literal["array"] = Field(default="array")
    items: "FieldSchema"
    """Schema for array items."""
    minItems: Optional[int] = None
    """Minimum number of items."""
    maxItems: Optional[int] = None
    """Maximum number of items."""
    uniqueItems: Optional[bool] = None
    """Whether all items must be unique."""


FieldSchema = Union[
    StringSchema,
    IntegerSchema,
    BooleanSchema,
    NumberSchema,
    NullSchema,
    ObjectSchema,
    ArraySchema,
]
"""Union type for all JSON Schema field types."""

ObjectSchema.model_rebuild()
ArraySchema.model_rebuild()


__all__ = [
    "StringSchema",
    "IntegerSchema",
    "BooleanSchema",
    "ObjectSchema",
    "FieldSchema",
    "ArraySchema",
    "NumberSchema",
    "NullSchema",
]
