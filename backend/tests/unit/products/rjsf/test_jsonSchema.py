import pytest
from forecastbox.products.rjsf import jsonSchema

# Test StringSchema


def test_string_schema_basic():
    schema = jsonSchema.StringSchema(type="string", title="Name", minLength=2, maxLength=10)
    assert schema.type == "string"
    assert schema.title == "Name"
    assert schema.minLength == 2
    assert schema.maxLength == 10


def test_string_schema_enum():
    schema = jsonSchema.StringSchema(type="string", title="TestEnum")
    # EnumMixin is not a pydantic field, so set directly
    schema.enum = ["a", "b", "c"]
    assert schema.enum == ["a", "b", "c"]
    schema.update_enum(["x", "y"])
    assert schema.enum == ["x", "y"]
    with pytest.raises(TypeError):
        schema.update_enum(123.45)  # type: ignore # Pass a non-list (float) to trigger TypeError


# Test IntegerSchema


def test_integer_schema():
    schema = jsonSchema.IntegerSchema(type="integer", title="IntField", minimum=0, maximum=100)
    assert schema.type == "integer"
    assert schema.minimum == 0
    assert schema.maximum == 100


# Test NumberSchema


def test_number_schema():
    schema = jsonSchema.NumberSchema(type="number", title="NumField", minimum=0.5, maximum=2.5)
    assert schema.type == "number"
    assert schema.minimum == 0.5
    assert schema.maximum == 2.5


# Test BooleanSchema


def test_boolean_schema():
    schema = jsonSchema.BooleanSchema(type="boolean", title="BoolField")
    assert schema.type == "boolean"


# Test NullSchema


def test_null_schema():
    schema = jsonSchema.NullSchema(type="null", title="NullField")
    assert schema.type == "null"


# Test ObjectSchema and recursion


def test_object_schema():
    prop = jsonSchema.StringSchema(type="string", title="Test")
    obj = jsonSchema.ObjectSchema(type="object", title="ObjField", properties={"field": prop}, required=["field"])
    assert obj.type == "object"
    assert "field" in obj.properties
    assert obj.required == ["field"]


def test_object_schema_properties_and_required():
    prop1 = jsonSchema.StringSchema(type="string", title="Name")
    prop2 = jsonSchema.IntegerSchema(type="integer", title="Age")
    obj = jsonSchema.ObjectSchema(
        type="object", title="Person", properties={"name": prop1, "age": prop2}, required=["name"]
    )
    assert obj.type == "object"
    assert obj.title == "Person"
    assert set(obj.properties.keys()) == {"name", "age"}
    assert obj.required == ["name"]
    assert isinstance(obj.properties["name"], jsonSchema.StringSchema)
    assert isinstance(obj.properties["age"], jsonSchema.IntegerSchema)


def test_object_schema_combinators():
    s1 = jsonSchema.StringSchema(type="string", title="A")
    s2 = jsonSchema.StringSchema(type="string", title="B")
    obj = jsonSchema.ObjectSchema(type="object", title="Combo", properties={}, anyOf=[s1, s2], oneOf=[s1], allOf=[s2])
    assert obj.anyOf == [s1, s2]
    assert obj.oneOf == [s1]
    assert obj.allOf == [s2]


# Test ArraySchema


def test_array_schema():
    item_schema = jsonSchema.IntegerSchema(type="integer", title="ArrItem")
    arr = jsonSchema.ArraySchema(type="array", title="ArrField", items=item_schema, minItems=1, maxItems=5)
    assert arr.type == "array"
    assert arr.minItems == 1
    assert arr.maxItems == 5
    assert arr.items.type == "integer"


def test_array_schema_items_and_limits():
    item_schema = jsonSchema.StringSchema(type="string", title="Item")
    arr = jsonSchema.ArraySchema(
        type="array", title="StringArray", items=item_schema, minItems=2, maxItems=5, uniqueItems=True
    )
    assert arr.type == "array"
    assert arr.title == "StringArray"
    assert arr.items == item_schema
    assert arr.minItems == 2
    assert arr.maxItems == 5
    assert arr.uniqueItems is True


def test_array_schema_nested():
    inner = jsonSchema.IntegerSchema(type="integer", title="Inner")
    arr = jsonSchema.ArraySchema(type="array", title="Outer", items=inner)
    assert arr.items == inner
    # Nested array
    nested = jsonSchema.ArraySchema(type="array", title="Nested", items=arr)
    assert nested.items == arr


# Test FieldSchema Union


def test_field_schema_union():
    s = jsonSchema.StringSchema(type="string", title="S")
    i = jsonSchema.IntegerSchema(type="integer", title="I")
    n = jsonSchema.NumberSchema(type="number", title="N")
    b = jsonSchema.BooleanSchema(type="boolean", title="B")
    o = jsonSchema.ObjectSchema(type="object", title="O", properties={})
    a = jsonSchema.ArraySchema(type="array", title="A", items=s)
    for val in [s, i, n, b, o, a]:
        assert isinstance(val, jsonSchema.FieldSchema.__args__)
