# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

from datetime import datetime
from unittest.mock import MagicMock

import pytest
from fiab_core.fable import BlockInstance as BlockInstanceBase
from fiab_core.fable import ConfigurationOptionId, PluginBlockFactoryId, PluginCompositeId, QubedOutput
from fiab_core.tools.blocks import BlockInstanceConfigurationError
from fiab_core.tools.blocks import BlockInstanceRich as BlockInstance
from qubed import Qube

from fiab_plugin_ecmwf.anemoi.blocks import AnemoiSource, AnemoiTransform
from fiab_plugin_ecmwf.qubed_utils import axes, contains, expand


def _config(values: dict[str, object]) -> dict[ConfigurationOptionId, object]:
    return {ConfigurationOptionId(key): value for key, value in values.items()}


def make_block(factory: str, config: dict, input_ids: dict | None = None) -> BlockInstance:
    converted = dict(config)
    if factory == "AnemoiSource":
        if "lead_time" in converted:
            converted["lead_time"] = int(converted["lead_time"])
        if "number" in converted:
            converted["number"] = int(converted["number"])
        if "base_time" in converted:
            converted["base_time"] = datetime.fromisoformat(str(converted["base_time"]))
    elif factory == "AnemoiTransform":
        if "lead_time" in converted:
            converted["lead_time"] = int(converted["lead_time"])
    factory_obj = AnemoiSource if factory == "AnemoiSource" else AnemoiTransform
    base_block = BlockInstanceBase(
        factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory=factory),  # type: ignore
        input_ids=input_ids or {},
        configuration_values=_config(converted),
    )
    return BlockInstance.from_block(base_block, factory_obj.configuration_options)


def make_raw_block(factory: str, config: dict, input_ids: dict | None = None) -> BlockInstance:
    factory_obj = AnemoiSource if factory == "AnemoiSource" else AnemoiTransform
    base_block = BlockInstanceBase(
        factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory=factory),  # type: ignore
        input_ids=input_ids or {},
        configuration_values=_config(config),
    )
    return BlockInstance.from_block(base_block, factory_obj.configuration_options)


class TestAnemoiSourceValidate:
    def test_invalid_lead_time_not_a_digit(self, dummy_checkpoint: str) -> None:
        block = make_raw_block(
            "AnemoiSource",
            {"checkpoint": dummy_checkpoint, "lead_time": "abc", "base_time": "2024-01-01", "number": "1"},
        )
        with pytest.raises(BlockInstanceConfigurationError, match="expected int"):
            AnemoiSource().validate(block=block, inputs={})

    def test_invalid_lead_time_negative(self, dummy_checkpoint: str) -> None:
        block = make_block(
            "AnemoiSource",
            {"checkpoint": dummy_checkpoint, "lead_time": "-1", "base_time": "2024-01-01", "number": "1"},
        )
        with pytest.raises(Exception, match="expected positive int"):
            result = AnemoiSource().validate(block=block, inputs={})
            result.get_or_raise()

    def test_invalid_number_zero(self, dummy_checkpoint: str) -> None:
        block = make_block(
            "AnemoiSource",
            {"checkpoint": dummy_checkpoint, "lead_time": "24", "base_time": "2024-01-01", "number": "0"},
        )
        with pytest.raises(Exception, match="expected positive int"):
            result = AnemoiSource().validate(block=block, inputs={})

    def test_invalid_number_not_a_digit(self, dummy_checkpoint: str) -> None:
        block = make_raw_block(
            "AnemoiSource",
            {"checkpoint": dummy_checkpoint, "lead_time": "24", "base_time": "2024-01-01", "number": "two"},
        )
        with pytest.raises(BlockInstanceConfigurationError, match="expected int"):
            AnemoiSource().validate(block=block, inputs={})

    def test_unknown_checkpoint(self, registered_provider: None) -> None:
        block = make_block(
            "AnemoiSource",
            {"checkpoint": "dummy_store:unknown", "lead_time": "24", "base_time": "2024-01-01", "number": "1"},
        )
        with pytest.raises(Exception, match="Unknown checkpoint artifact *"):
            result = AnemoiSource().validate(block=block, inputs={})
            result.get_or_raise()

    def test_invalid_checkpoint_format(self) -> None:
        block = make_block(
            "AnemoiSource",
            {"checkpoint": "not-a-valid-id", "lead_time": "24", "base_time": "2024-01-01", "number": "1"},
        )
        with pytest.raises(ValueError, match="must be of the form *"):
            result = AnemoiSource().validate(block=block, inputs={})
            result.get_or_raise()

    def test_valid_config_default_ensemble(self, dummy_checkpoint: str) -> None:
        block = make_block(
            "AnemoiSource",
            {"checkpoint": dummy_checkpoint, "lead_time": "24", "base_time": "2024-01-01", "number": "1"},
        )
        output: QubedOutput = AnemoiSource().validate(block=block, inputs={}).get_or_raise()  # type: ignore[assignment]
        assert not contains(output, "number")

    def test_valid_config_with_number(self, dummy_checkpoint: str) -> None:
        block = make_block(
            "AnemoiSource",
            {"checkpoint": dummy_checkpoint, "lead_time": "24", "base_time": "2024-01-01", "number": "3"},
        )
        output: QubedOutput = AnemoiSource().validate(block=block, inputs={}).get_or_raise()  # type: ignore[assignment]
        assert contains(output, "number")
        assert set(axes(output)["number"]) == {1, 2, 3}


class TestAnemoiTransformValidate:
    def test_invalid_lead_time_not_a_digit(self, dummy_checkpoint: str, dummy_qube: Qube) -> None:
        input_dataset = QubedOutput(dataqube=dummy_qube)
        block = make_raw_block("AnemoiTransform", {"checkpoint": dummy_checkpoint, "lead_time": "abc"}, input_ids={"dataset": "src"})
        with pytest.raises(BlockInstanceConfigurationError, match="expected int"):
            AnemoiTransform().validate(block=block, inputs={"dataset": input_dataset})

    def test_invalid_lead_time_negative(self, dummy_checkpoint: str, dummy_qube: Qube) -> None:
        input_dataset = QubedOutput(dataqube=dummy_qube)
        block = make_block("AnemoiTransform", {"checkpoint": dummy_checkpoint, "lead_time": "-1"}, input_ids={"dataset": "src"})
        with pytest.raises(Exception, match="expected positive int"):
            result = AnemoiTransform().validate(block=block, inputs={"dataset": input_dataset})

    def test_unknown_checkpoint(self, registered_provider: None, dummy_qube: Qube) -> None:
        input_dataset = QubedOutput(dataqube=dummy_qube)
        block = make_block("AnemoiTransform", {"checkpoint": "dummy_store:unknown", "lead_time": "24"}, input_ids={"dataset": "src"})
        with pytest.raises(Exception, match="Unknown checkpoint artifact *"):
            result = AnemoiTransform().validate(block=block, inputs={"dataset": input_dataset})

    def test_valid_config_no_number_axis(self, dummy_checkpoint: str, dummy_qube: Qube) -> None:
        input_dataset = QubedOutput(dataqube=dummy_qube)
        block = make_block("AnemoiTransform", {"checkpoint": dummy_checkpoint, "lead_time": "24"}, input_ids={"dataset": "src"})
        output = AnemoiTransform().validate(block=block, inputs={"dataset": input_dataset}).get_or_raise()
        assert isinstance(output, QubedOutput)
        assert not contains(output, "number")

    def test_valid_config_propagates_number_axis(self, dummy_checkpoint: str, dummy_qube: Qube) -> None:
        input_dataset = expand(QubedOutput(dataqube=dummy_qube), {"number": [1, 2, 3]})
        block = make_block("AnemoiTransform", {"checkpoint": dummy_checkpoint, "lead_time": "24"}, input_ids={"dataset": "src"})
        output = AnemoiTransform().validate(block=block, inputs={"dataset": input_dataset}).get_or_raise()
        assert isinstance(output, QubedOutput)
        assert contains(output, "number")
        assert set(axes(output)["number"]) == {1, 2, 3}


class TestAnemoiTransformIntersect:
    def test_non_qubed_output_returns_false(self) -> None:
        assert not AnemoiTransform().intersect(other=MagicMock())  # type: ignore[arg-type]

    def test_empty_qubed_output_returns_false(self) -> None:
        assert not AnemoiTransform().intersect(other=QubedOutput())  # type: ignore[arg-type]
