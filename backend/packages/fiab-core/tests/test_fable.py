# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import pytest
from pydantic import ValidationError

from fiab_core.fable import (
    BlockConfigurationOption,
    BlockFactoryId,
    BlockInstance,
    BlockInstanceId,
    BlueprintTemplate,
    BlueprintTemplateEnvironment,
    ConfigurationOptionId,
    LocalBlock,
    PluginCompositeId,
    PluginId,
    PluginStoreId,
)
from fiab_core.types import FableType, StringType


def test_block_configuration_option_caches_parsed_value_type() -> None:
    option = BlockConfigurationOption(title="Title", description="Description", value_type="str")

    assert isinstance(option.parsed_value_type, StringType)
    assert isinstance(option._value_type, FableType)


def test_block_configuration_option_excludes_cached_value_type_from_serialization() -> None:
    option = BlockConfigurationOption(title="Title", description="Description", value_type="str")

    dumped = option.model_dump()
    dumped_json = option.model_dump_json()

    assert "_value_type" not in dumped
    assert "_value_type" not in dumped_json
    assert dumped["value_type"] == "str"


def test_block_configuration_option_rejects_invalid_value_type() -> None:
    with pytest.raises(ValidationError, match="Invalid type expression"):
        BlockConfigurationOption(title="Title", description="Description", value_type="not-a-fable-type")


# ---------------------------------------------------------------------------
# BlueprintTemplate
# ---------------------------------------------------------------------------

_PLUGIN_ID = PluginCompositeId(store=PluginStoreId("s"), local=PluginId("p"))
_BLOCK_ID = BlockInstanceId("b1")
_TEXT = ConfigurationOptionId("text")


def _make_block() -> LocalBlock:
    return LocalBlock(
        factory_id=BlockFactoryId("source_text"),
        instance=BlockInstance(configuration_values={_TEXT: "hello"}, input_ids={}),
    )


def _make_template(**overrides: object) -> BlueprintTemplate:
    defaults: dict = dict(
        display_name="myTemplate",
        display_description="A template",
        blocks={_BLOCK_ID: _make_block()},
    )
    defaults.update(overrides)
    return BlueprintTemplate(**defaults)  # type: ignore[arg-type]


def test_blueprint_template_constructs() -> None:
    tmpl = _make_template()

    assert tmpl.display_name == "myTemplate"
    assert tmpl.display_description == "A template"
    assert _BLOCK_ID in tmpl.blocks
    assert tmpl.environment is None
    assert tmpl.local_glyphs == {}
    assert tmpl.example_values == {}
    assert tmpl.example_glyphs == {}


def test_blueprint_template_rejects_unknown_field() -> None:
    with pytest.raises(ValidationError):
        _make_template(unknown_field="oops")


def test_blueprint_template_round_trips_model_dump() -> None:
    tmpl = _make_template(
        environment=BlueprintTemplateEnvironment(environment_variables={"K": "V"}),
        local_glyphs={"g": "v"},
        example_values={_BLOCK_ID: {_TEXT: "world"}},
        example_glyphs={"g": "world"},
    )

    dumped = tmpl.model_dump()
    restored = BlueprintTemplate.model_validate(dumped)

    assert restored.display_name == tmpl.display_name
    assert restored.environment is not None
    assert restored.environment.environment_variables == {"K": "V"}
    assert restored.local_glyphs == {"g": "v"}
    assert restored.example_values == {_BLOCK_ID: {_TEXT: "world"}}
    assert restored.example_glyphs == {"g": "world"}


def test_blueprint_template_environment_rejects_unknown_field() -> None:
    with pytest.raises(ValidationError):
        BlueprintTemplateEnvironment(environment_variables={}, unexpected="x")  # type: ignore[call-arg]
