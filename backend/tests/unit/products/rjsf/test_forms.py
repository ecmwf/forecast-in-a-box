import pytest
from forecastbox.products.rjsf.forms import FieldWithUI
from forecastbox.products.rjsf.forms import FormDefinition
from forecastbox.products.rjsf.jsonSchema import IntegerSchema
from forecastbox.products.rjsf.jsonSchema import NullSchema
from forecastbox.products.rjsf.jsonSchema import StringSchema
from forecastbox.products.rjsf.uiSchema import UIIntegerField
from forecastbox.products.rjsf.uiSchema import UIStringField


def test_export_jsonschema_and_uischema():
    # Compose a form with two fields, one with UI, one without
    fields = {
        "name": FieldWithUI(
            jsonschema=StringSchema(type="string", title="Name"),
            ui=UIStringField(widget="text", placeholder="Enter name"),
        ),
        "age": FieldWithUI(jsonschema=IntegerSchema(type="integer", title="Age", minimum=0, maximum=120), ui=None),
    }
    form = FormDefinition(title="Person", fields=fields, required=["name"])
    jsonschema = form.export_jsonschema()
    uischema = form.export_uischema()
    assert jsonschema["title"] == "Person"
    assert jsonschema["type"] == "object"
    assert "name" in jsonschema["properties"]
    assert "age" in jsonschema["properties"]
    assert jsonschema["required"] == ["name"]
    assert "name" in uischema
    assert "ui:options" in uischema["name"]
    assert "age" not in uischema  # No UI for age


def test_export_all_combines_json_and_ui():
    fields = {"foo": FieldWithUI(jsonschema=StringSchema(type="string", title="Foo"), ui=UIStringField(widget="text"))}
    form = FormDefinition(title="Test", fields=fields)
    all_export = form.export_all()
    assert "jsonSchema" in all_export
    assert "uiSchema" in all_export
    assert all_export["jsonSchema"]["title"] == "Test"
    assert "foo" in all_export["uiSchema"]


def test_apply_data_includes_formData():
    fields = {
        "bar": FieldWithUI(jsonschema=IntegerSchema(type="integer", title="Bar"), ui=UIIntegerField(widget="updown"))
    }
    form = FormDefinition(title="Test2", fields=fields)
    data = {"bar": 42}
    result = form.apply_data(data)
    assert "formData" in result
    assert result["formData"] == data
    assert result["jsonSchema"]["properties"]["bar"]["type"] == "integer"
    assert "bar" in result["uiSchema"]


def test_required_defaults_to_empty_list():
    form = FormDefinition(title="NoRequired", fields={})
    assert form.required == []


def test_update_enum_within_field():
    from forecastbox.products.rjsf import update_enum_within_field
    from forecastbox.products.rjsf.jsonSchema import ArraySchema
    from forecastbox.products.rjsf.jsonSchema import StringSchema

    # StringSchema supports enum
    field = FieldWithUI(jsonschema=StringSchema(type="string", title="Color"), ui=UIStringField(widget="text"))
    updated = update_enum_within_field(field, ["red", "green", "blue"])
    if isinstance(updated.jsonschema, StringSchema):
        assert updated.jsonschema.enum == ["red", "green", "blue"]

    # ArraySchema with StringSchema items
    arr_schema = ArraySchema(type="array", title="Colors", items=StringSchema(type="string", title="Color"))
    arr_field = FieldWithUI(jsonschema=arr_schema, ui=None)
    updated_arr = update_enum_within_field(arr_field, ["yellow", "purple"])
    # Only check items.enum if the schema is an ArraySchema and items is a StringSchema
    if isinstance(updated_arr.jsonschema, ArraySchema) and isinstance(updated_arr.jsonschema.items, StringSchema):
        assert updated_arr.jsonschema.items.enum == ["yellow", "purple"]

    # Should raise TypeError for IntegerSchema (no enum)
    int_field = FieldWithUI(jsonschema=NullSchema(), ui=None)
    with pytest.raises(TypeError):
        update_enum_within_field(int_field, [1, 2, 3])
