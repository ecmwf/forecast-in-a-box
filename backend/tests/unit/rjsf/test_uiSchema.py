from forecastbox.rjsf.uiSchema import UIBooleanField, UIField, UIIntegerField, UIObjectField, UIStringField


def test_uifield_export_with_prefix():
    field = UIField(widget="custom", classNames="my-class", placeholder="test")
    exported = field.export_with_prefix()
    assert "ui:options" in exported
    opts = exported["ui:options"]
    assert opts["widget"] == "custom"
    assert opts["classNames"] == "my-class"
    assert opts["placeholder"] == "test"
    assert "style" not in opts


def test_uistringfield_defaults_and_override():
    field = UIStringField()
    exported = field.export_with_prefix()
    assert exported["ui:options"]["widget"] == "text"
    # Override widget
    field2 = UIStringField(widget="textarea", format="email")
    exported2 = field2.export_with_prefix()
    assert exported2["ui:options"]["widget"] == "textarea"
    assert exported2["ui:options"]["format"] == "email"


def test_uiintegerfield_and_uibooleanfield():
    int_field = UIIntegerField()
    bool_field = UIBooleanField()
    assert int_field.widget == "updown"
    assert bool_field.widget == "checkbox"
    # Exported
    assert int_field.export_with_prefix()["ui:options"]["widget"] == "updown"
    assert bool_field.export_with_prefix()["ui:options"]["widget"] == "checkbox"


def test_uiarrayfield_and_uiobjectfield_export():
    arr_field = UIObjectField()
    obj_field = UIObjectField(anyOf=[UIStringField(), UIIntegerField()])
    # Should export with only set fields
    assert arr_field.export_with_prefix() == {}
    assert obj_field.export_with_prefix() == {
        "anyOf": [{"ui:options": {"widget": "text"}}, {"ui:options": {"widget": "updown"}}]
    }


def test_uifield_all_options():
    field = UIField(
        widget="custom",
        classNames="cls",
        style={"color": "red"},
        autocomplete="on",
        autofocus=True,
        description="desc",
        disabled=True,
        emptyValue=None,
        enumDisabled=[1],
        enumNames=["A"],
        help="helptext",
        hideError=True,
        inputType="number",
        label=False,
        placeholder="ph",
        readonly=True,
        rows=3,
        title="title",
    )
    exported = field.export_with_prefix()["ui:options"]
    assert exported["widget"] == "custom"
    assert exported["classNames"] == "cls"
    assert exported["style"] == {"color": "red"}
    assert exported["autocomplete"] == "on"
    assert exported["autofocus"] is True
    assert exported["description"] == "desc"
    assert exported["disabled"] is True
    assert exported["enumDisabled"] == [1]
    assert exported["enumNames"] == ["A"]
    assert exported["help"] == "helptext"
    assert exported["hideError"] is True
    assert exported["inputType"] == "number"
    assert exported["label"] is False
    assert exported["placeholder"] == "ph"
    assert exported["readonly"] is True
    assert exported["rows"] == 3
    assert exported["title"] == "title"
