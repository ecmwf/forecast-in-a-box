# (C) Copyright 2025- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

from datetime import date
from types import NoneType, UnionType
from typing import Callable, Literal, Union, get_args, get_origin

from pydantic import BaseModel
from pydantic.fields import FieldInfo
from pydantic_core import PydanticUndefined

from .forms import FieldWithUI
from .jsonSchema import ArraySchema, BooleanSchema, FieldSchema, IntegerSchema, ObjectSchema, StringSchema
from .uiSchema import UIAdditionalProperties, UIField, UIIntegerField, UIObjectField, UISchema, UIStringField


def _update_with_extra_json(field: FieldInfo, schema: FieldSchema, ui: UISchema) -> tuple[FieldSchema, UISchema]:
    """Update schema and ui with extra json from field."""
    if isinstance(field.json_schema_extra, dict) and field.json_schema_extra.get("rjsf") is not None:  # type: ignore # TODO fix type, didnt diagnose
        assert isinstance(field.json_schema_extra["rjsf"], dict), "rjsf extra must be a dict"
        for k, v in field.json_schema_extra["rjsf"].items():
            if hasattr(schema, k):
                setattr(schema, k, v)
            elif hasattr(ui, k):
                setattr(ui, k, v)
            else:
                raise ValueError(f"Unknown rjsf extra key: {k}")
    return schema, ui


def _set_base_field_info(field: FieldInfo, schema: FieldSchema, ui: UISchema) -> tuple[FieldSchema, UISchema]:
    """Set base field info from pydantic field to schema and ui."""
    if field.default is not PydanticUndefined:
        schema.default = field.default
    if field.default_factory is not None:
        schema.default = field.default_factory()  # type: ignore
    if field.title:
        schema.title = field.title
    if field.description:
        schema.description = field.description
        ui.description = field.description  # type: ignore[invalid-assignment] # ???
    return schema, ui


def _from_string_primative(field: FieldInfo) -> FieldWithUI:
    schema, ui = _set_base_field_info(field, StringSchema(type="string"), UIStringField())
    schema, ui = _update_with_extra_json(field, schema, ui)

    return FieldWithUI(jsonschema=schema, uischema=ui)


def _from_date_primative(field: FieldInfo) -> FieldWithUI:
    schema, ui = _set_base_field_info(field, StringSchema(type="string", format="date"), UIStringField(widget="date"))
    schema, ui = _update_with_extra_json(field, schema, ui)

    return FieldWithUI(jsonschema=schema, uischema=ui)


def _from_literal_primative(field: FieldInfo) -> FieldWithUI:
    literal_args = get_args(field.annotation)
    if not all(isinstance(arg, str) for arg in literal_args):
        raise TypeError("Only Literal[str, ...] is supported")

    schema, ui = _set_base_field_info(field, StringSchema(type="string", enum=list(literal_args)), UIStringField(widget="select"))  # type: ignore # TODO fix type, didnt diagnose
    schema, ui = _update_with_extra_json(field, schema, ui)

    return FieldWithUI(jsonschema=schema, uischema=ui)


def _from_integer_primative(field: FieldInfo) -> FieldWithUI:
    schema, ui = _set_base_field_info(field, IntegerSchema(type="integer"), UIIntegerField())
    schema, ui = _update_with_extra_json(field, schema, ui)

    return FieldWithUI(jsonschema=schema, uischema=ui)


def _from_boolean_primative(field: FieldInfo) -> FieldWithUI:
    schema, ui = _set_base_field_info(field, BooleanSchema(type="boolean"), UIField(widget="checkbox"))
    schema, ui = _update_with_extra_json(field, schema, ui)

    return FieldWithUI(jsonschema=schema, uischema=ui)


def _from_dict_primative(field: FieldInfo) -> FieldWithUI:
    schema, ui = _set_base_field_info(field, ObjectSchema(type="object", properties={}), UIAdditionalProperties())
    schema, ui = _update_with_extra_json(field, schema, ui)

    assert isinstance(ui, UIAdditionalProperties)

    if field.annotation and hasattr(field.annotation, "__args__") and len(field.annotation.__args__) == 2:
        _, value_type = get_args(field.annotation)
        if value_type is str:
            schema.additionalProperties = StringSchema(type="string")
            ui.additionalProperties = UIStringField(widget="text")
        elif value_type is int:
            schema.additionalProperties = IntegerSchema(type="integer")
            ui.additionalProperties = UIIntegerField()
        elif value_type is bool:
            schema.additionalProperties = BooleanSchema(type="boolean")
            ui.additionalProperties = UIField(widget="checkbox")
        else:
            raise ValueError(f"Unsupported dict value type: {value_type}")
    else:
        schema.additionalProperties = StringSchema(type="string")
        ui.additionalProperties = UIStringField(widget="text")

    return FieldWithUI(jsonschema=schema, uischema=ui)


def _from_list_primative(field: FieldInfo) -> FieldWithUI:
    schema, ui = _set_base_field_info(field, ArraySchema(type="array", items=StringSchema(type="string")), UIObjectField())
    schema, ui = _update_with_extra_json(field, schema, ui)

    assert isinstance(schema, ArraySchema)
    assert isinstance(ui, UIObjectField)

    if field.annotation and hasattr(field.annotation, "__args__") and len(field.annotation.__args__) == 1:
        item_type = get_args(field.annotation)[0]
        if item_type is str:
            schema.items = StringSchema(type="string")
            ui.anyOf = [UIStringField(widget="text")]
        elif item_type is int:
            schema.items = IntegerSchema(type="integer")
            ui.anyOf = [UIIntegerField()]
        elif item_type is bool:
            schema.items = BooleanSchema(type="boolean")
            ui.anyOf = [UIField(widget="checkbox")]
        else:
            raise ValueError(f"Unsupported list item type: {item_type}")
    else:
        schema.items = StringSchema(type="string")
        ui.anyOf = [UIStringField(widget="text")]

    return FieldWithUI(jsonschema=schema, uischema=ui)


PRIMATIVES: dict[type, Callable[[FieldInfo], FieldWithUI]] = {
    str: _from_string_primative,
    int: _from_integer_primative,
    bool: _from_boolean_primative,
    date: _from_date_primative,
    dict: _from_dict_primative,
    list: _from_list_primative,
    object: _from_string_primative,
    # Literal: _from_literal_primative,
}


def from_pydantic(model: type[BaseModel] | BaseModel) -> tuple[dict[str, FieldWithUI], list[str]]:
    """Convert a pydantic model to a dictionary of fields, and list of required.

    Parameters
    ----------
    model : type[BaseModel] | BaseModel
        The pydantic model to convert.

    Returns
    -------
    tuple[dict[str, FieldWithUI], list[str]]
        Field dictionary, and list of required fields.
    """

    def _get_with_annotation(annotation: type, field: FieldInfo) -> FieldWithUI:
        if annotation in PRIMATIVES:
            return PRIMATIVES[annotation](field)
        else:
            raise TypeError(f"Unsupported field type: {annotation}")

    def _get_from_model(m: type[BaseModel]) -> tuple[dict[str, FieldWithUI], list[str]]:
        fields: dict[str, FieldWithUI] = {}
        required = []

        for field_name, field in m.__pydantic_fields__.items():
            if field.exclude:
                continue
            field_name = field.serialization_alias or field.alias or field_name

            if not field.annotation:
                fields[field_name] = _from_string_primative(field)
                continue

            elif field.annotation in PRIMATIVES:
                fields[field_name] = _get_with_annotation(field.annotation, field)

            elif isinstance(field.annotation, UnionType) or get_origin(field.annotation) is Union:
                fields[field_name] = _get_with_annotation(get_args(field.annotation)[0], field)
                if NoneType in get_args(field.annotation):
                    fields[field_name].jsonschema.type = [fields[field_name].jsonschema.type, "null"]  # type: ignore

            elif get_origin(field.annotation) is dict:
                fields[field_name] = _from_dict_primative(field)

            elif get_origin(field.annotation) is list:
                fields[field_name] = _from_list_primative(field)

            elif get_origin(field.annotation) is Literal:
                fields[field_name] = _from_literal_primative(field)

            elif hasattr(field.annotation, "mro"):
                if BaseModel in field.annotation.mro():
                    sub_fields, sub_required = _get_from_model(field.annotation)

                    sub_fields_schema = {k: v.jsonschema for k, v in sub_fields.items()}
                    sub_fields_ui = {k: v.uischema for k, v in sub_fields.items()}

                    obj_schema = ObjectSchema(type="object", properties=sub_fields_schema)

                    if sub_required:
                        obj_schema.required = sub_required

                    schema, ui = _set_base_field_info(field, obj_schema, UIObjectField())
                    schema, ui = _update_with_extra_json(field, schema, ui)

                    assert isinstance(ui, UIObjectField)
                    ui.anyOf = list(sub_fields_ui.values())  # type: ignore # ???

                    fields[field_name] = FieldWithUI(jsonschema=schema, uischema=ui)
            else:
                fields[field_name] = _from_string_primative(field)

            if field.is_required():
                required.append(field_name)
        return fields, required

    return _get_from_model(model)  # type: ignore # TODO fix type, didnt diagnose
