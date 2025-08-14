from forecastbox.rjsf.forms import FieldWithUI, FormDefinition
from forecastbox.rjsf.jsonSchema import IntegerSchema, StringSchema
from forecastbox.rjsf.uiSchema import UIStringField


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


def test_required_defaults_to_empty_list():
    form = FormDefinition(title="NoRequired", fields={})
    assert form.required == []
