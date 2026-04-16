# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

from unittest.mock import MagicMock, patch

import pytest
from fiab_core.fable import BlockInstance, PluginBlockFactoryId, PluginCompositeId
from qubed import Qube

from fiab_plugin_ecmwf.anemoi.blocks import AnemoiSource, AnemoiTransform
from fiab_plugin_ecmwf.metadata import QubedInstanceOutput

DUMMY_CHECKPOINT = "dummy_store:dummy_ckpt"
DUMMY_QUBE = Qube.from_datacube({"step": [6, 12, 18, 24]})


def make_block(factory: str, config: dict, input_ids: dict | None = None) -> BlockInstance:
    return BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory=factory),  # type: ignore
        input_ids=input_ids or {},
        configuration_values=config,
    )


@pytest.fixture
def mock_anemoi_utils():
    """Patch get_metadata and expansion_qube so validate_anemoi_block can complete successfully."""
    with (
        patch("fiab_plugin_ecmwf.anemoi.utils.get_metadata", return_value=MagicMock()),
        patch("fiab_plugin_ecmwf.anemoi.utils.expansion_qube", return_value=DUMMY_QUBE),
    ):
        yield


class TestAnemoiSourceValidate:
    def test_invalid_lead_time_not_a_digit(self):
        block = make_block("AnemoiSource", {"checkpoint": DUMMY_CHECKPOINT, "lead_time": "abc", "base_time": "2024-01-01"})
        result = AnemoiSource().validate(block=block, inputs={})
        with pytest.raises(ValueError, match="Lead time"):
            result.get_or_raise()

    def test_invalid_lead_time_negative(self):
        block = make_block("AnemoiSource", {"checkpoint": DUMMY_CHECKPOINT, "lead_time": "-1", "base_time": "2024-01-01"})
        result = AnemoiSource().validate(block=block, inputs={})
        with pytest.raises(ValueError, match="Lead time"):
            result.get_or_raise()

    def test_invalid_ensemble_members_zero(self):
        block = make_block(
            "AnemoiSource",
            {"checkpoint": DUMMY_CHECKPOINT, "lead_time": "24", "base_time": "2024-01-01", "ensemble_members": "0"},
        )
        result = AnemoiSource().validate(block=block, inputs={})
        with pytest.raises(ValueError, match="Ensemble members"):
            result.get_or_raise()

    def test_invalid_ensemble_members_not_a_digit(self):
        block = make_block(
            "AnemoiSource",
            {"checkpoint": DUMMY_CHECKPOINT, "lead_time": "24", "base_time": "2024-01-01", "ensemble_members": "two"},
        )
        result = AnemoiSource().validate(block=block, inputs={})
        with pytest.raises(ValueError, match="Ensemble members"):
            result.get_or_raise()

    def test_unknown_checkpoint(self, registered_provider):
        block = make_block("AnemoiSource", {"checkpoint": "dummy_store:unknown", "lead_time": "24", "base_time": "2024-01-01"})
        result = AnemoiSource().validate(block=block, inputs={})
        with pytest.raises(ValueError, match="Unknown checkpoint"):
            result.get_or_raise()

    def test_invalid_checkpoint_format(self):
        block = make_block("AnemoiSource", {"checkpoint": "not-a-valid-id", "lead_time": "24", "base_time": "2024-01-01"})
        result = AnemoiSource().validate(block=block, inputs={})
        with pytest.raises(ValueError, match="valid checkpoint identifier"):
            result.get_or_raise()

    def test_valid_config_default_ensemble(self, mock_anemoi_utils):
        block = make_block("AnemoiSource", {"checkpoint": DUMMY_CHECKPOINT, "lead_time": "24", "base_time": "2024-01-01"})
        output: QubedInstanceOutput = AnemoiSource().validate(block=block, inputs={}).get_or_raise()  # type: ignore[assignment]
        assert "number" in output
        assert set(output.axes()["number"]) == {1}

    def test_valid_config_with_ensemble_members(self, mock_anemoi_utils):
        block = make_block(
            "AnemoiSource",
            {"checkpoint": DUMMY_CHECKPOINT, "lead_time": "24", "base_time": "2024-01-01", "ensemble_members": "3"},
        )
        output: QubedInstanceOutput = AnemoiSource().validate(block=block, inputs={}).get_or_raise()  # type: ignore[assignment]
        assert "number" in output
        assert set(output.axes()["number"]) == {1, 2, 3}


class TestAnemoiTransformValidate:
    def test_invalid_lead_time_not_a_digit(self):
        input_dataset = QubedInstanceOutput(dataqube=DUMMY_QUBE)
        block = make_block("AnemoiTransform", {"checkpoint": DUMMY_CHECKPOINT, "lead_time": "abc"}, input_ids={"dataset": "src"})
        result = AnemoiTransform().validate(block=block, inputs={"dataset": input_dataset})  # type: ignore[dict-item]
        with pytest.raises(ValueError, match="Lead time"):
            result.get_or_raise()

    def test_invalid_lead_time_negative(self):
        input_dataset = QubedInstanceOutput(dataqube=DUMMY_QUBE)
        block = make_block("AnemoiTransform", {"checkpoint": DUMMY_CHECKPOINT, "lead_time": "-1"}, input_ids={"dataset": "src"})
        result = AnemoiTransform().validate(block=block, inputs={"dataset": input_dataset})  # type: ignore[dict-item]
        with pytest.raises(ValueError, match="Lead time"):
            result.get_or_raise()

    def test_unknown_checkpoint(self, registered_provider):
        input_dataset = QubedInstanceOutput(dataqube=DUMMY_QUBE)
        block = make_block("AnemoiTransform", {"checkpoint": "dummy_store:unknown", "lead_time": "24"}, input_ids={"dataset": "src"})
        result = AnemoiTransform().validate(block=block, inputs={"dataset": input_dataset})  # type: ignore[dict-item]
        with pytest.raises(ValueError, match="Unknown checkpoint"):
            result.get_or_raise()

    def test_valid_config_no_number_axis(self, mock_anemoi_utils):
        input_dataset = QubedInstanceOutput(dataqube=DUMMY_QUBE)
        block = make_block("AnemoiTransform", {"checkpoint": DUMMY_CHECKPOINT, "lead_time": "24"}, input_ids={"dataset": "src"})
        output: QubedInstanceOutput = (
            AnemoiTransform()
            .validate(  # type: ignore[assignment]
                block=block,
                inputs={"dataset": input_dataset},  # type: ignore[dict-item]
            )
            .get_or_raise()
        )
        assert "number" not in output

    def test_valid_config_propagates_number_axis(self, mock_anemoi_utils):
        input_dataset = QubedInstanceOutput(dataqube=DUMMY_QUBE).expand({"number": [1, 2, 3]})
        block = make_block("AnemoiTransform", {"checkpoint": DUMMY_CHECKPOINT, "lead_time": "24"}, input_ids={"dataset": "src"})
        output: QubedInstanceOutput = (
            AnemoiTransform()
            .validate(  # type: ignore[assignment]
                block=block,
                inputs={"dataset": input_dataset},  # type: ignore[dict-item]
            )
            .get_or_raise()
        )
        assert "number" in output
        assert set(output.axes()["number"]) == {1, 2, 3}


class TestAnemoiTransformIntersect:
    def test_non_qubed_output_returns_false(self):
        assert not AnemoiTransform().intersect(input=MagicMock())  # type: ignore[arg-type]

    def test_empty_qubed_output_returns_false(self):
        assert not AnemoiTransform().intersect(input=QubedInstanceOutput())  # type: ignore[arg-type]

    def test_non_empty_qubed_output_returns_true(self):
        output = QubedInstanceOutput(dataqube=DUMMY_QUBE)
        assert AnemoiTransform().intersect(input=output)  # type: ignore[arg-type]
