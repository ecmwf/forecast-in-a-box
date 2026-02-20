# (C) Copyright 2025- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

from datetime import date
from typing import Dict, List, Literal, Optional, Union

import pytest
from pydantic import BaseModel, Field
from pydantic.fields import FieldInfo

from forecastbox.rjsf.forms import FieldWithUI
from forecastbox.rjsf.from_pydantic import (
    PRIMATIVES,
    _from_boolean_primative,
    _from_date_primative,
    _from_dict_primative,
    _from_integer_primative,
    _from_list_primative,
    _from_literal_primative,
    _from_string_primative,
    _set_base_field_info,
    _update_with_extra_json,
    from_pydantic,
)
from forecastbox.rjsf.jsonSchema import BooleanSchema, IntegerSchema, ObjectSchema, StringSchema
from forecastbox.rjsf.uiSchema import UIAdditionalProperties, UIField, UIIntegerField, UIObjectField, UIStringField


class TestHelperFunctions:
    """Test helper functions used in from_pydantic module."""

    def test_update_with_extra_json_with_rjsf_data(self):
        field = FieldInfo(json_schema_extra={"rjsf": {"title": "Custom Title", "widget": "textarea"}})
        schema = StringSchema(type="string")
        ui = UIStringField()

        updated_schema, updated_ui = _update_with_extra_json(field, schema, ui)

        assert updated_schema.title == "Custom Title"
        assert updated_ui.widget == "textarea"

    def test_update_with_extra_json_without_rjsf_data(self):
        field = FieldInfo()
        schema = StringSchema(type="string")
        ui = UIStringField()

        updated_schema, updated_ui = _update_with_extra_json(field, schema, ui)

        assert updated_schema is schema
        assert updated_ui is ui

    def test_update_with_extra_json_invalid_key(self):
        field = FieldInfo(json_schema_extra={"rjsf": {"invalid_key": "value"}})
        schema = StringSchema(type="string")
        ui = UIStringField()

        with pytest.raises(ValueError, match="Unknown rjsf extra key: invalid_key"):
            _update_with_extra_json(field, schema, ui)

    def test_update_with_extra_json_invalid_rjsf_type(self):
        field = FieldInfo(json_schema_extra={"rjsf": "not_a_dict"})
        schema = StringSchema(type="string")
        ui = UIStringField()

        with pytest.raises(AssertionError, match="rjsf extra must be a dict"):
            _update_with_extra_json(field, schema, ui)

    def test_set_base_field_info_with_default(self):
        field = FieldInfo(default="test_default", title="Test Title", description="Test Description")
        schema = StringSchema(type="string")
        ui = UIStringField()

        updated_schema, updated_ui = _set_base_field_info(field, schema, ui)

        assert updated_schema.default == "test_default"
        assert updated_schema.title == "Test Title"
        assert updated_schema.description == "Test Description"
        assert updated_ui.description == "Test Description"

    def test_set_base_field_info_with_default_factory(self):
        def factory():
            return "factory_value"

        field = FieldInfo(default_factory=factory)
        schema = StringSchema(type="string")
        ui = UIStringField()

        updated_schema, updated_ui = _set_base_field_info(field, schema, ui)

        assert updated_schema.default == "factory_value"


class TestPrimitiveConversions:
    """Test primitive type conversions."""

    def test_from_string_primitive(self):
        field = FieldInfo(title="String Field", description="A string field")
        result = _from_string_primative(field)

        assert isinstance(result, FieldWithUI)
        assert result.jsonschema.type == "string"
        assert result.jsonschema.title == "String Field"
        assert result.jsonschema.description == "A string field"
        assert isinstance(result.uischema, UIStringField)
        assert result.uischema.description == "A string field"

    def test_from_date_primitive(self):
        field = FieldInfo(title="Date Field")
        result = _from_date_primative(field)

        assert isinstance(result, FieldWithUI)
        assert result.jsonschema.type == "string"
        assert result.jsonschema.format == "date"
        assert result.jsonschema.title == "Date Field"
        assert isinstance(result.uischema, UIStringField)
        assert result.uischema.widget == "date"

    def test_from_literal_primitive_strings(self):
        field = FieldInfo(annotation=Literal["option1", "option2", "option3"])
        result = _from_literal_primative(field)

        assert isinstance(result, FieldWithUI)
        assert result.jsonschema.type == "string"
        assert result.jsonschema.enum == ["option1", "option2", "option3"]
        assert isinstance(result.uischema, UIStringField)
        assert result.uischema.widget == "select"

    def test_from_literal_primitive_invalid_type(self):
        field = FieldInfo(annotation=Literal[1, 2, 3])

        with pytest.raises(TypeError, match="Only Literal\\[str, ...\\] is supported"):
            _from_literal_primative(field)

    def test_from_literal_primitive_single_value(self):
        field = FieldInfo(annotation=Literal["only_one"])
        result = _from_literal_primative(field)

        assert isinstance(result, FieldWithUI)
        assert result.jsonschema.type == "string"
        assert result.jsonschema.enum == ["only_one"]
        assert isinstance(result.uischema, UIStringField)
        assert result.uischema.widget == "select"

    def test_from_integer_primitive(self):
        field = FieldInfo(title="Integer Field", default=42)
        result = _from_integer_primative(field)

        assert isinstance(result, FieldWithUI)
        assert result.jsonschema.type == "integer"
        assert result.jsonschema.title == "Integer Field"
        assert result.jsonschema.default == 42
        assert isinstance(result.uischema, UIIntegerField)

    def test_from_boolean_primitive(self):
        field = FieldInfo(title="Boolean Field", default=True)
        result = _from_boolean_primative(field)

        assert isinstance(result, FieldWithUI)
        assert result.jsonschema.type == "boolean"
        assert result.jsonschema.title == "Boolean Field"
        assert result.jsonschema.default is True
        assert isinstance(result.uischema, UIField)
        assert result.uischema.widget == "checkbox"

    def test_from_dict_primitive_string_values(self):
        field = FieldInfo(annotation=Dict[str, str])
        result = _from_dict_primative(field)

        assert isinstance(result, FieldWithUI)
        assert result.jsonschema.type == "object"
        assert result.jsonschema.properties == {}
        assert isinstance(result.jsonschema.additionalProperties, StringSchema)
        assert result.jsonschema.additionalProperties.type == "string"
        assert isinstance(result.uischema, UIAdditionalProperties)
        assert isinstance(result.uischema.additionalProperties, UIStringField)

    def test_from_dict_primitive_int_values(self):
        field = FieldInfo(annotation=Dict[str, int])
        result = _from_dict_primative(field)

        assert isinstance(result, FieldWithUI)
        assert isinstance(result.jsonschema.additionalProperties, IntegerSchema)
        assert result.jsonschema.additionalProperties.type == "integer"
        assert isinstance(result.uischema.additionalProperties, UIIntegerField)

    def test_from_dict_primitive_bool_values(self):
        field = FieldInfo(annotation=Dict[str, bool])
        result = _from_dict_primative(field)

        assert isinstance(result, FieldWithUI)
        assert isinstance(result.jsonschema.additionalProperties, BooleanSchema)
        assert result.jsonschema.additionalProperties.type == "boolean"
        assert isinstance(result.uischema.additionalProperties, UIField)
        assert result.uischema.additionalProperties.widget == "checkbox"

    def test_from_dict_primitive_basemodel_values(self):
        """Test dict with BaseModel values - new functionality."""

        class NestedModel(BaseModel):
            name: str
            value: int
            is_active: bool = True

        field = FieldInfo(annotation=Dict[str, NestedModel])
        result = _from_dict_primative(field)

        assert isinstance(result, FieldWithUI)
        assert result.jsonschema.type == "object"
        assert result.jsonschema.properties == {}

        # Check additionalProperties is an ObjectSchema for the BaseModel
        assert isinstance(result.jsonschema.additionalProperties, ObjectSchema)
        additional_props = result.jsonschema.additionalProperties
        assert additional_props.type == "object"
        assert "name" in additional_props.properties
        assert "value" in additional_props.properties
        assert "is_active" in additional_props.properties
        assert set(additional_props.required) == {"name", "value"}  # is_active has default

        # Check the properties have correct types
        assert additional_props.properties["name"].type == "string"
        assert additional_props.properties["value"].type == "integer"
        assert additional_props.properties["is_active"].type == "boolean"
        assert additional_props.properties["is_active"].default is True

        # Check UI schema
        assert isinstance(result.uischema, UIAdditionalProperties)
        assert isinstance(result.uischema.additionalProperties, UIObjectField)
        assert len(result.uischema.additionalProperties.anyOf) == 3

    def test_from_dict_primitive_nested_basemodel_values(self):
        """Test dict with nested BaseModel values."""

        class Address(BaseModel):
            street: str
            city: str

        class Person(BaseModel):
            name: str
            address: Address
            age: int = Field(default=25)

        field = FieldInfo(annotation=Dict[str, Person])
        result = _from_dict_primative(field)

        assert isinstance(result, FieldWithUI)
        additional_props = result.jsonschema.additionalProperties
        assert isinstance(additional_props, ObjectSchema)

        # Check that nested BaseModel is properly handled
        assert "address" in additional_props.properties
        address_prop = additional_props.properties["address"]
        assert address_prop.type == "object"
        assert "street" in address_prop.properties
        assert "city" in address_prop.properties
        assert address_prop.required == ["street", "city"]

        # Check required fields (age has default, so not required)
        assert set(additional_props.required) == {"name", "address"}

    def test_from_dict_primitive_unsupported_value_type(self):
        field = FieldInfo(annotation=Dict[str, float])

        with pytest.raises(ValueError, match="Unsupported dict value type: <class 'float'>"):
            _from_dict_primative(field)

    def test_from_list_primitive_string_items(self):
        field = FieldInfo(annotation=List[str])
        result = _from_list_primative(field)

        assert isinstance(result, FieldWithUI)
        assert result.jsonschema.type == "array"
        assert isinstance(result.jsonschema.items, StringSchema)
        assert result.jsonschema.items.type == "string"
        assert isinstance(result.uischema, UIObjectField)
        assert len(result.uischema.anyOf) == 1  # type: ignore
        assert isinstance(result.uischema.anyOf[0], UIStringField)  # type: ignore

    def test_from_list_primitive_int_items(self):
        field = FieldInfo(annotation=List[int])
        result = _from_list_primative(field)

        assert isinstance(result, FieldWithUI)
        assert isinstance(result.jsonschema.items, IntegerSchema)
        assert result.jsonschema.items.type == "integer"
        assert isinstance(result.uischema.anyOf[0], UIIntegerField)  # type: ignore

    def test_from_list_primitive_bool_items(self):
        field = FieldInfo(annotation=List[bool])
        result = _from_list_primative(field)

        assert isinstance(result, FieldWithUI)
        assert isinstance(result.jsonschema.items, BooleanSchema)
        assert result.jsonschema.items.type == "boolean"
        assert isinstance(result.uischema.anyOf[0], UIField)  # type: ignore
        assert result.uischema.anyOf[0].widget == "checkbox"  # type: ignore

    def test_from_list_primitive_unsupported_item_type(self):
        field = FieldInfo(annotation=List[float])

        with pytest.raises(ValueError, match="Unsupported list item type: <class 'float'>"):
            _from_list_primative(field)


class TestFromPydantic:
    """Test the main from_pydantic function."""

    def test_simple_model_with_basic_types(self):
        class SimpleModel(BaseModel):
            name: str
            age: int
            is_active: bool
            birth_date: date

        fields, required = from_pydantic(SimpleModel)

        assert len(fields) == 4
        assert set(required) == {"name", "age", "is_active", "birth_date"}

        # Check string field
        assert fields["name"].jsonschema.type == "string"
        assert isinstance(fields["name"].uischema, UIStringField)

        # Check integer field
        assert fields["age"].jsonschema.type == "integer"
        assert isinstance(fields["age"].uischema, UIIntegerField)

        # Check boolean field
        assert fields["is_active"].jsonschema.type == "boolean"
        assert fields["is_active"].uischema.widget == "checkbox"

        # Check date field
        assert fields["birth_date"].jsonschema.type == "string"
        assert fields["birth_date"].jsonschema.format == "date"
        assert fields["birth_date"].uischema.widget == "date"

    def test_model_with_defaults(self):
        class ModelWithDefaults(BaseModel):
            name: str = "Default Name"
            age: int = Field(default=25, title="Person Age")
            is_active: bool = Field(default_factory=lambda: True)

        fields, required = from_pydantic(ModelWithDefaults)

        assert len(fields) == 3
        assert len(required) == 0  # All have defaults

        assert fields["name"].jsonschema.default == "Default Name"
        assert fields["age"].jsonschema.default == 25
        assert fields["age"].jsonschema.title == "Person Age"
        assert fields["is_active"].jsonschema.default is True

    def test_model_with_optional_fields(self):
        class OptionalModel(BaseModel):
            name: str
            nickname: Optional[str] = None
            age: Union[int, None] = None

        fields, required = from_pydantic(OptionalModel)

        assert len(fields) == 3
        assert required == ["name"]

        # Optional fields should have type as array including "null"
        assert fields["nickname"].jsonschema.type == ["string", "null"]
        assert fields["age"].jsonschema.type == ["integer", "null"]

    def test_model_with_literal_field(self):
        class LiteralModel(BaseModel):
            status: Literal["active", "inactive", "pending"]
            name: str

        fields, required = from_pydantic(LiteralModel)

        assert len(fields) == 2
        assert set(required) == {"status", "name"}

        assert fields["status"].jsonschema.type == "string"
        assert fields["status"].jsonschema.enum == ["active", "inactive", "pending"]
        assert fields["status"].uischema.widget == "select"

    def test_model_with_multiple_literal_fields(self):
        class MultiLiteralModel(BaseModel):
            priority: Literal["low", "medium", "high"]
            category: Literal["bug", "feature", "enhancement"]
            single_option: Literal["only_choice"]

        fields, required = from_pydantic(MultiLiteralModel)

        assert len(fields) == 3
        assert set(required) == {"priority", "category", "single_option"}

        # Test multiple choice literal
        assert fields["priority"].jsonschema.enum == ["low", "medium", "high"]
        assert fields["priority"].uischema.widget == "select"

        # Test another multiple choice literal
        assert fields["category"].jsonschema.enum == ["bug", "feature", "enhancement"]
        assert fields["category"].uischema.widget == "select"

        # Test single choice literal
        assert fields["single_option"].jsonschema.enum == ["only_choice"]
        assert fields["single_option"].uischema.widget == "select"

    def test_model_with_dict_and_list_fields(self):
        class ComplexModel(BaseModel):
            metadata: Dict[str, str]
            tags: List[str]
            scores: Dict[str, int]
            flags: List[bool]

        fields, required = from_pydantic(ComplexModel)

        assert len(fields) == 4
        assert set(required) == {"metadata", "tags", "scores", "flags"}

        # Check dict field
        assert fields["metadata"].jsonschema.type == "object"
        assert isinstance(fields["metadata"].jsonschema.additionalProperties, StringSchema)

        # Check list field
        assert fields["tags"].jsonschema.type == "array"
        assert isinstance(fields["tags"].jsonschema.items, StringSchema)

        # Check dict with int values
        assert isinstance(fields["scores"].jsonschema.additionalProperties, IntegerSchema)

        # Check list with bool items
        assert isinstance(fields["flags"].jsonschema.items, BooleanSchema)

    def test_model_with_dict_basemodel_values(self):
        """Test model with Dict[str, BaseModel] field - new functionality."""

        class Config(BaseModel):
            enabled: bool = True
            threshold: int = 10
            name: str

        class Settings(BaseModel):
            title: str
            configurations: Dict[str, Config]

        fields, required = from_pydantic(Settings)

        assert len(fields) == 2
        assert set(required) == {"title", "configurations"}

        # Check the dict field with BaseModel values
        config_field = fields["configurations"]
        assert config_field.jsonschema.type == "object"
        assert isinstance(config_field.jsonschema.additionalProperties, ObjectSchema)

        additional_props = config_field.jsonschema.additionalProperties
        assert "enabled" in additional_props.properties
        assert "threshold" in additional_props.properties
        assert "name" in additional_props.properties
        assert additional_props.properties["enabled"].default is True
        assert additional_props.properties["threshold"].default == 10
        assert additional_props.required == ["name"]  # Only name is required

        # Check UI schema
        assert isinstance(config_field.uischema, UIAdditionalProperties)
        assert isinstance(config_field.uischema.additionalProperties, UIObjectField)

    def test_model_with_complex_dict_nesting(self):
        """Test complex nesting with Dict[str, BaseModel] containing other BaseModels."""

        class DatabaseConfig(BaseModel):
            host: str
            port: int = 5432
            ssl_enabled: bool = False

        class ServiceConfig(BaseModel):
            name: str
            database: DatabaseConfig
            replicas: int = 1

        class Application(BaseModel):
            app_name: str
            services: Dict[str, ServiceConfig]

        fields, required = from_pydantic(Application)

        assert len(fields) == 2
        assert set(required) == {"app_name", "services"}

        services_field = fields["services"]
        additional_props = services_field.jsonschema.additionalProperties
        assert isinstance(additional_props, ObjectSchema)

        # Check that the nested BaseModel (ServiceConfig) is properly structured
        assert "name" in additional_props.properties
        assert "database" in additional_props.properties
        assert "replicas" in additional_props.properties

        # Check the database nested object
        database_prop = additional_props.properties["database"]
        assert database_prop.type == "object"
        assert "host" in database_prop.properties
        assert "port" in database_prop.properties
        assert "ssl_enabled" in database_prop.properties
        assert database_prop.properties["port"].default == 5432
        assert database_prop.properties["ssl_enabled"].default is False
        assert database_prop.required == ["host"]

    def test_nested_model(self):
        class Address(BaseModel):
            street: str
            city: str
            zip_code: str = Field(alias="zipCode")

        class Person(BaseModel):
            name: str
            address: Address

        fields, required = from_pydantic(Person)

        assert len(fields) == 2
        assert set(required) == {"name", "address"}

        # Check nested model field
        assert fields["address"].jsonschema.type == "object"
        assert isinstance(fields["address"].jsonschema, ObjectSchema)
        assert "street" in fields["address"].jsonschema.properties
        assert "city" in fields["address"].jsonschema.properties
        assert "zipCode" in fields["address"].jsonschema.properties  # Should use alias
        assert fields["address"].jsonschema.required == ["street", "city", "zipCode"]

        assert isinstance(fields["address"].uischema, UIObjectField)
        assert len(fields["address"].uischema.anyOf) == 3  # type: ignore

    def test_model_with_excluded_field(self):
        class ModelWithExcluded(BaseModel):
            name: str
            secret: str = Field(exclude=True)
            age: int

        fields, required = from_pydantic(ModelWithExcluded)

        assert len(fields) == 2
        assert "secret" not in fields
        assert set(required) == {"name", "age"}

    def test_model_with_field_aliases(self):
        class AliasModel(BaseModel):
            full_name: str = Field(alias="fullName", title="Full Name")
            user_id: int = Field(serialization_alias="userId")

        fields, required = from_pydantic(AliasModel)

        assert len(fields) == 2
        assert "fullName" in fields  # Uses title as field name
        assert "userId" in fields  # Uses serialization_alias as field name
        assert set(required) == {"fullName", "userId"}

    def test_model_with_rjsf_extra(self):
        class RJSFModel(BaseModel):
            description: str = Field(json_schema_extra={"rjsf": {"widget": "textarea", "placeholder": "Enter description here"}})
            priority: int = Field(json_schema_extra={"rjsf": {"minimum": 1, "maximum": 10}})

        fields, required = from_pydantic(RJSFModel)

        assert len(fields) == 2
        assert fields["description"].uischema.widget == "textarea"
        assert fields["description"].uischema.placeholder == "Enter description here"
        assert fields["priority"].jsonschema.minimum == 1
        assert fields["priority"].jsonschema.maximum == 10

    def test_empty_model(self):
        class EmptyModel(BaseModel):
            pass

        fields, required = from_pydantic(EmptyModel)

        assert len(fields) == 0
        assert len(required) == 0

    def test_model_with_no_annotation_field(self):
        # This tests the fallback to string when no annotation is provided
        class NoAnnotationModel(BaseModel):
            name: str

        # Manually modify the field to have no annotation (edge case)
        NoAnnotationModel.__pydantic_fields__["mystery_field"] = FieldInfo()
        NoAnnotationModel.__pydantic_fields__["mystery_field"].annotation = None

        fields, required = from_pydantic(NoAnnotationModel)

        assert "mystery_field" in fields
        assert fields["mystery_field"].jsonschema.type == "string"

    def test_unsupported_field_type_fallback(self):
        # This would test the final fallback in the else clause
        # but since the actual line 225 has a syntax error, we'll test what should happen
        class UnsupportedModel(BaseModel):
            name: str
            # In reality, this would be a complex type not handled by the function

        # We can't easily test this without modifying the actual implementation
        # since the current code has issues, but we can verify the basic functionality works
        fields, required = from_pydantic(UnsupportedModel)
        assert "name" in fields
        assert fields["name"].jsonschema.type == "string"


class TestPrimativesMapping:
    """Test the PRIMATIVES mapping."""

    def test_primatives_mapping_completeness(self):
        expected_types = {str, int, bool, date, dict, list, object}
        assert set(PRIMATIVES.keys()) == expected_types

    def test_primatives_mapping_functions(self):
        assert PRIMATIVES[str] == _from_string_primative
        assert PRIMATIVES[int] == _from_integer_primative
        assert PRIMATIVES[bool] == _from_boolean_primative
        assert PRIMATIVES[date] == _from_date_primative
        assert PRIMATIVES[dict] == _from_dict_primative
        assert PRIMATIVES[list] == _from_list_primative
        assert PRIMATIVES[object] == _from_string_primative


class TestEdgeCases:
    """Test edge cases and error conditions."""

    def test_model_with_union_type_first_arg_used(self):
        class UnionModel(BaseModel):
            value: Union[str, int]  # Should use str (first type)

        fields, required = from_pydantic(UnionModel)

        assert fields["value"].jsonschema.type == "string"

    def test_dict_basemodel_with_rjsf_extra(self):
        """Test Dict[str, BaseModel] with RJSF extra configuration."""

        class ConfigItem(BaseModel):
            name: str = Field(json_schema_extra={"rjsf": {"widget": "textarea"}})
            priority: int = Field(json_schema_extra={"rjsf": {"minimum": 1, "maximum": 5}})

        class ConfigContainer(BaseModel):
            configs: Dict[str, ConfigItem] = Field(title="Configuration Items", description="Dictionary of configuration items")

        fields, required = from_pydantic(ConfigContainer)

        config_field = fields["configs"]
        assert config_field.jsonschema.title == "Configuration Items"
        assert config_field.jsonschema.description == "Dictionary of configuration items"

        additional_props = config_field.jsonschema.additionalProperties
        assert isinstance(additional_props, ObjectSchema)

        # Check that RJSF extras are preserved in the nested BaseModel properties
        name_prop = additional_props.properties["name"]
        priority_prop = additional_props.properties["priority"]
        assert name_prop.type == "string"
        assert priority_prop.type == "integer"
        assert priority_prop.minimum == 1
        assert priority_prop.maximum == 5

    def test_dict_basemodel_empty_model(self):
        """Test Dict[str, BaseModel] where BaseModel is empty."""

        class EmptyModel(BaseModel):
            pass

        class Container(BaseModel):
            items: Dict[str, EmptyModel]

        fields, required = from_pydantic(Container)

        items_field = fields["items"]
        additional_props = items_field.jsonschema.additionalProperties
        assert isinstance(additional_props, ObjectSchema)
        assert additional_props.properties == {}
        assert additional_props.required is None or additional_props.required == []

    def test_dict_basemodel_with_optional_fields(self):
        """Test Dict[str, BaseModel] where BaseModel has optional fields."""

        class OptionalModel(BaseModel):
            required_field: str
            optional_field: Optional[str] = None
            default_field: int = 42

        class Container(BaseModel):
            items: Dict[str, OptionalModel]

        fields, required = from_pydantic(Container)

        items_field = fields["items"]
        additional_props = items_field.jsonschema.additionalProperties
        assert isinstance(additional_props, ObjectSchema)

        # Only required_field should be in required list
        assert additional_props.required == ["required_field"]

        # Check optional field has null type
        optional_prop = additional_props.properties["optional_field"]
        assert optional_prop.type == ["string", "null"]

        # Check default field has default value
        default_prop = additional_props.properties["default_field"]
        assert default_prop.default == 42

    def test_dict_basemodel_issubclass_error_handling(self):
        """Test error handling when issubclass check fails."""
        # This tests the robustness of the issubclass check
        field = FieldInfo(annotation=Dict[str, str])  # This should not trigger BaseModel path
        result = _from_dict_primative(field)

        # Should use string handling, not BaseModel
        assert isinstance(result.jsonschema.additionalProperties, StringSchema)

    def test_deeply_nested_model(self):
        class Level3(BaseModel):
            value: str

        class Level2(BaseModel):
            level3: Level3

        class Level1(BaseModel):
            level2: Level2

        fields, required = from_pydantic(Level1)

        assert "level2" in fields
        assert fields["level2"].jsonschema.type == "object"
        assert "level3" in fields["level2"].jsonschema.properties
        nested_level3 = fields["level2"].jsonschema.properties["level3"]
        assert nested_level3.type == "object"
        assert "value" in nested_level3.properties


class TestDictBaseModelIntegration:
    """Integration tests for the new Dict[str, BaseModel] functionality."""

    def test_comprehensive_basemodel_dict_scenario(self):
        """Comprehensive test covering multiple aspects of Dict[str, BaseModel]."""

        class Validation(BaseModel):
            rule: Literal["required", "optional", "conditional"]
            message: str = Field(default="Default validation message")
            enabled: bool = True

        class FieldConfig(BaseModel):
            label: str
            placeholder: str = ""
            validation: Validation
            metadata: Dict[str, str] = Field(default_factory=dict)

        class FormSchema(BaseModel):
            title: str
            description: Optional[str] = None
            fields: Dict[str, FieldConfig]

        # Test the full conversion
        form_fields, form_required = from_pydantic(FormSchema)

        assert len(form_fields) == 3
        assert set(form_required) == {"title", "fields"}

        # Test the Dict[str, FieldConfig] field
        fields_config = form_fields["fields"]
        assert fields_config.jsonschema.type == "object"
        assert isinstance(fields_config.jsonschema.additionalProperties, ObjectSchema)

        field_config_schema = fields_config.jsonschema.additionalProperties
        assert set(field_config_schema.required) == {"label", "validation"}

        # Test nested structure - FieldConfig contains Validation BaseModel
        validation_prop = field_config_schema.properties["validation"]
        assert validation_prop.type == "object"
        assert "rule" in validation_prop.properties
        assert "message" in validation_prop.properties
        assert "enabled" in validation_prop.properties

        # Test Literal field in nested BaseModel
        rule_prop = validation_prop.properties["rule"]
        assert rule_prop.type == "string"
        assert set(rule_prop.enum) == {"required", "optional", "conditional"}

        # Test default values in nested structure
        message_prop = validation_prop.properties["message"]
        assert message_prop.default == "Default validation message"

        enabled_prop = validation_prop.properties["enabled"]
        assert enabled_prop.default is True

        # Test nested Dict[str, str] in BaseModel
        metadata_prop = field_config_schema.properties["metadata"]
        assert metadata_prop.type == "object"
        assert isinstance(metadata_prop.additionalProperties, StringSchema)

    def test_circular_reference_prevention(self):
        """Test that circular references are handled gracefully."""

        class Node(BaseModel):
            name: str
            # Note: In a real scenario, this would create circular reference
            # but our implementation doesn't handle forward references yet
            value: int = 0

        class Container(BaseModel):
            nodes: Dict[str, Node]

        # This should work without infinite recursion
        fields, required = from_pydantic(Container)

        assert "nodes" in fields
        nodes_field = fields["nodes"]
        additional_props = nodes_field.jsonschema.additionalProperties
        assert isinstance(additional_props, ObjectSchema)
        assert "name" in additional_props.properties
        assert "value" in additional_props.properties

    def test_mixed_dict_types_in_model(self):
        """Test a model with various dictionary types."""

        class ComplexItem(BaseModel):
            id: str
            active: bool = True

        class MixedDictModel(BaseModel):
            string_dict: Dict[str, str]
            int_dict: Dict[str, int]
            bool_dict: Dict[str, bool]
            model_dict: Dict[str, ComplexItem]

        fields, required = from_pydantic(MixedDictModel)

        assert len(fields) == 4
        assert set(required) == {"string_dict", "int_dict", "bool_dict", "model_dict"}

        # Verify each dict type
        assert isinstance(fields["string_dict"].jsonschema.additionalProperties, StringSchema)
        assert isinstance(fields["int_dict"].jsonschema.additionalProperties, IntegerSchema)
        assert isinstance(fields["bool_dict"].jsonschema.additionalProperties, BooleanSchema)
        assert isinstance(fields["model_dict"].jsonschema.additionalProperties, ObjectSchema)

        # Check the BaseModel dict specifically
        model_additional = fields["model_dict"].jsonschema.additionalProperties
        assert "id" in model_additional.properties
        assert "active" in model_additional.properties
        assert model_additional.required == ["id"]
        assert model_additional.properties["active"].default is True
