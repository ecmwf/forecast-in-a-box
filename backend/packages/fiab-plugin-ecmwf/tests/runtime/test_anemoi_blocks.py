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
from fiab_core.fable import BlockFactoryId, ConfigurationOptionId, PluginBlockFactoryId, PluginCompositeId, QubedOutput
from fiab_core.fable import BlockInstance as BlockInstanceBase
from fiab_core.tools.blocks import BlockInstanceConfigurationError
from fiab_core.tools.blocks import BlockInstanceRich as BlockInstance
from qubed import Qube

from fiab_plugin_ecmwf import plugin
from fiab_plugin_ecmwf.anemoi.blocks import AnemoiInputSource, AnemoiSource, AnemoiTransform
from fiab_plugin_ecmwf.anemoi.utils import get_checkpoint_enum_type
from fiab_plugin_ecmwf.qubed_utils import axes, collapse, contains, expand

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _config(values: dict[str, object]) -> dict[ConfigurationOptionId, object]:
    return {ConfigurationOptionId(key): value for key, value in values.items()}


def _make_block(
    factory_cls: type[AnemoiSource | AnemoiInputSource | AnemoiTransform],
    config: dict,
    input_ids: dict | None = None,
) -> BlockInstance:
    """Build a *typed* BlockInstanceRich whose configuration values have already
    been converted to the correct Python types (int, datetime, …)."""
    base = BlockInstanceBase(
        factory_id=PluginBlockFactoryId(
            plugin=PluginCompositeId.from_str("ecmwf:ecmwf"),
            factory=factory_cls.__name__,  # type: ignore[arg-type]
        ),
        input_ids=input_ids or {},
        configuration_values=_config(config),
    )
    return BlockInstance.from_block(base, factory_cls.configuration_options)


def _make_raw_block(
    factory_cls: type[AnemoiSource | AnemoiInputSource | AnemoiTransform],
    config: dict,
    input_ids: dict | None = None,
) -> BlockInstance:
    """Build a BlockInstanceRich whose configuration values are *raw strings*
    (as they would arrive from the frontend before deserialisation)."""
    base = BlockInstanceBase(
        factory_id=PluginBlockFactoryId(
            plugin=PluginCompositeId.from_str("ecmwf:ecmwf"),
            factory=factory_cls.__name__,  # type: ignore[arg-type]
        ),
        input_ids=input_ids or {},
        configuration_values=_config(config),
    )
    return BlockInstance.from_block(base, factory_cls.configuration_options)


# ---------------------------------------------------------------------------
# Fixtures - block configurations
# ---------------------------------------------------------------------------


@pytest.fixture
def anemoi_source_configuration(dummy_checkpoint: str) -> BlockInstance:
    return _make_block(
        AnemoiSource,
        {
            "checkpoint": dummy_checkpoint,
            "input_source": "opendata",
            "lead_time": 24,
            "base_time": datetime(2024, 1, 1),
            "number": 1,
        },
    )


@pytest.fixture
def anemoi_source_ensemble_configuration(dummy_checkpoint: str) -> BlockInstance:
    return _make_block(
        AnemoiSource,
        {
            "checkpoint": dummy_checkpoint,
            "input_source": "opendata",
            "lead_time": 24,
            "base_time": datetime(2024, 1, 1),
            "number": 3,
        },
    )


@pytest.fixture
def anemoi_input_source_configuration(dummy_checkpoint: str) -> BlockInstance:
    return _make_block(
        AnemoiInputSource,
        {
            "checkpoint": dummy_checkpoint,
            "input_source": "opendata",
            "base_time": datetime(2024, 1, 1),
        },
    )


@pytest.fixture
def anemoi_transform_configuration(dummy_checkpoint: str) -> BlockInstance:
    return _make_block(
        AnemoiTransform,
        {"checkpoint": dummy_checkpoint, "lead_time": 24},
        input_ids={"dataset": "src"},
    )


# ---------------------------------------------------------------------------
# Fixtures - validated outputs
# ---------------------------------------------------------------------------


@pytest.fixture
def anemoi_source_output(anemoi_source_configuration: BlockInstance) -> QubedOutput:
    return AnemoiSource().validate(block=anemoi_source_configuration, inputs={}).get_or_raise()  # type: ignore[return-value]


@pytest.fixture
def anemoi_source_ensemble_output(anemoi_source_ensemble_configuration: BlockInstance) -> QubedOutput:
    return AnemoiSource().validate(block=anemoi_source_ensemble_configuration, inputs={}).get_or_raise()  # type: ignore[return-value]


@pytest.fixture
def anemoi_input_source_output(anemoi_input_source_configuration: BlockInstance) -> QubedOutput:
    return AnemoiInputSource().validate(block=anemoi_input_source_configuration, inputs={}).get_or_raise()  # type: ignore[return-value]


# ===================================================================
# AnemoiSource
# ===================================================================


class TestAnemoiSourceValidate:
    """Validate method - happy paths and error paths."""

    def test_valid_deterministic(self, anemoi_source_configuration: BlockInstance) -> None:
        output = AnemoiSource().validate(block=anemoi_source_configuration, inputs={}).get_or_raise()
        assert isinstance(output, QubedOutput)
        assert output.dataqube is not None

    def test_deterministic_has_no_number_axis(self, anemoi_source_output: QubedOutput) -> None:
        assert not contains(anemoi_source_output, "number")

    def test_deterministic_has_param_axis(self, anemoi_source_output: QubedOutput) -> None:
        assert contains(anemoi_source_output, "param")

    def test_deterministic_has_step_axis(self, anemoi_source_output: QubedOutput) -> None:
        assert contains(anemoi_source_output, "step")

    def test_ensemble_has_number_axis(self, anemoi_source_ensemble_output: QubedOutput) -> None:
        assert contains(anemoi_source_ensemble_output, "number")
        assert set(axes(anemoi_source_ensemble_output)["number"]) == {1, 2, 3}

    def test_ensemble_preserves_param_axis(self, anemoi_source_ensemble_output: QubedOutput) -> None:
        assert contains(anemoi_source_ensemble_output, "param")

    def test_invalid_lead_time_not_a_digit(self, dummy_checkpoint: str) -> None:
        block = _make_raw_block(
            AnemoiSource,
            {"checkpoint": dummy_checkpoint, "lead_time": "abc", "base_time": "2024-01-01", "number": "1"},
        )
        with pytest.raises(BlockInstanceConfigurationError, match="expected int"):
            AnemoiSource().validate(block=block, inputs={})

    def test_invalid_lead_time_negative(self, dummy_checkpoint: str) -> None:
        block = _make_block(
            AnemoiSource,
            {"checkpoint": dummy_checkpoint, "lead_time": -1, "base_time": datetime(2024, 1, 1), "number": 1},
        )
        with pytest.raises(BlockInstanceConfigurationError, match="must be positive"):
            AnemoiSource().validate(block=block, inputs={})

    def test_invalid_lead_time_equal_to_timestep(self, dummy_checkpoint: str) -> None:
        block = _make_block(
            AnemoiSource,
            {"checkpoint": dummy_checkpoint, "lead_time": 1, "base_time": datetime(2024, 1, 1), "number": 1},
        )
        result = AnemoiSource().validate(block=block, inputs={})
        with pytest.raises(Exception, match="must be greater than checkpoint timestep"):
            result.get_or_raise()

    def test_invalid_lead_time_not_a_timestep_multiple(self, six_hour_dummy_checkpoint: str) -> None:
        block = _make_block(
            AnemoiSource,
            {"checkpoint": six_hour_dummy_checkpoint, "lead_time": 7, "base_time": datetime(2024, 1, 1), "number": 1},
        )
        result = AnemoiSource().validate(block=block, inputs={})
        with pytest.raises(Exception, match="must be a multiple of checkpoint timestep"):
            result.get_or_raise()

    def test_invalid_number_zero(self, dummy_checkpoint: str) -> None:
        block = _make_block(
            AnemoiSource,
            {"checkpoint": dummy_checkpoint, "lead_time": 24, "base_time": datetime(2024, 1, 1), "number": 0},
        )
        with pytest.raises(BlockInstanceConfigurationError, match="must be positive"):
            AnemoiSource().validate(block=block, inputs={})

    def test_invalid_number_not_a_digit(self, dummy_checkpoint: str) -> None:
        block = _make_raw_block(
            AnemoiSource,
            {"checkpoint": dummy_checkpoint, "lead_time": "24", "base_time": "2024-01-01", "number": "two"},
        )
        with pytest.raises(BlockInstanceConfigurationError, match="expected int"):
            AnemoiSource().validate(block=block, inputs={})

    def test_unknown_checkpoint(self, registered_provider: None) -> None:
        block = _make_block(
            AnemoiSource,
            {"checkpoint": "dummy_store:unknown", "lead_time": 24, "base_time": datetime(2024, 1, 1), "number": 1},
        )
        with pytest.raises(Exception):
            AnemoiSource().validate(block=block, inputs={}).get_or_raise()

    def test_invalid_checkpoint_format(self) -> None:
        block = _make_block(
            AnemoiSource,
            {"checkpoint": "not-a-valid-id", "lead_time": 24, "base_time": datetime(2024, 1, 1), "number": 1},
        )
        with pytest.raises(ValueError, match="must be of the form"):
            AnemoiSource().validate(block=block, inputs={}).get_or_raise()


class TestAnemoiSourceIntersect:
    """Sources always reject intersection - they are roots."""

    def test_rejects_qubed_output(self, anemoi_source_output: QubedOutput) -> None:
        assert not AnemoiSource().intersect(other=anemoi_source_output)  # type: ignore[arg-type]

    def test_rejects_empty_qubed_output(self) -> None:
        assert not AnemoiSource().intersect(other=QubedOutput())  # type: ignore[arg-type]

    def test_rejects_mock(self) -> None:
        assert not AnemoiSource().intersect(other=MagicMock())  # type: ignore[arg-type]


# ===================================================================
# AnemoiInputSource
# ===================================================================


class TestAnemoiInputSourceValidate:
    def test_valid_config(self, anemoi_input_source_configuration: BlockInstance) -> None:
        output = AnemoiInputSource().validate(block=anemoi_input_source_configuration, inputs={}).get_or_raise()
        assert isinstance(output, QubedOutput)
        assert output.dataqube is not None

    def test_output_has_param_axis(self, anemoi_input_source_output: QubedOutput) -> None:
        assert contains(anemoi_input_source_output, "param")

    def test_output_has_no_step_axis(self, anemoi_input_source_output: QubedOutput) -> None:
        """Input source returns initial conditions - no step dimension."""
        assert not contains(anemoi_input_source_output, "step")

    def test_output_has_no_number_axis(self, anemoi_input_source_output: QubedOutput) -> None:
        assert not contains(anemoi_input_source_output, "number")


class TestAnemoiInputSourceIntersect:
    """Sources always reject intersection - they are roots."""

    def test_rejects_qubed_output(self, anemoi_input_source_output: QubedOutput) -> None:
        assert not AnemoiInputSource().intersect(other=anemoi_input_source_output)  # type: ignore[arg-type]

    def test_rejects_empty_qubed_output(self) -> None:
        assert not AnemoiInputSource().intersect(other=QubedOutput())  # type: ignore[arg-type]


# ===================================================================
# AnemoiTransform
# ===================================================================


class TestAnemoiTransformValidate:
    def test_valid_no_number_axis(self, anemoi_transform_configuration: BlockInstance, anemoi_input_source_output: QubedOutput) -> None:
        output = (
            AnemoiTransform()
            .validate(
                block=anemoi_transform_configuration,
                inputs={"dataset": anemoi_input_source_output},
            )
            .get_or_raise()
        )
        assert isinstance(output, QubedOutput)
        assert not contains(output, "number")

    def test_valid_propagates_number_axis(
        self, anemoi_transform_configuration: BlockInstance, anemoi_input_source_output: QubedOutput
    ) -> None:
        input_with_number = expand(anemoi_input_source_output, {"number": [1, 2, 3]})
        output = (
            AnemoiTransform()
            .validate(
                block=anemoi_transform_configuration,
                inputs={"dataset": input_with_number},
            )
            .get_or_raise()
        )
        assert isinstance(output, QubedOutput)
        assert contains(output, "number")
        assert set(axes(output)["number"]) == {1, 2, 3}

    def test_output_has_step_axis(self, anemoi_transform_configuration: BlockInstance, anemoi_input_source_output: QubedOutput) -> None:
        output: QubedOutput = (
            AnemoiTransform()
            .validate(
                block=anemoi_transform_configuration,
                inputs={"dataset": anemoi_input_source_output},
            )
            .get_or_raise()
        )  # type: ignore[assignment]
        assert contains(output, "step")

    def test_output_has_param_axis(self, anemoi_transform_configuration: BlockInstance, anemoi_input_source_output: QubedOutput) -> None:
        output: QubedOutput = (
            AnemoiTransform()
            .validate(
                block=anemoi_transform_configuration,
                inputs={"dataset": anemoi_input_source_output},
            )
            .get_or_raise()
        )  # type: ignore[assignment]
        assert contains(output, "param")

    def test_invalid_lead_time_not_a_digit(self, dummy_checkpoint: str, dummy_qube: Qube) -> None:
        input_dataset = QubedOutput(dataqube=dummy_qube)
        block = _make_raw_block(
            AnemoiTransform,
            {"checkpoint": dummy_checkpoint, "lead_time": "abc"},
            input_ids={"dataset": "src"},
        )
        with pytest.raises(BlockInstanceConfigurationError, match="expected int"):
            AnemoiTransform().validate(block=block, inputs={"dataset": input_dataset})

    def test_invalid_lead_time_negative(self, dummy_checkpoint: str, dummy_qube: Qube) -> None:
        input_dataset = QubedOutput(dataqube=dummy_qube)
        block = _make_block(
            AnemoiTransform,
            {"checkpoint": dummy_checkpoint, "lead_time": -1},
            input_ids={"dataset": "src"},
        )
        with pytest.raises(BlockInstanceConfigurationError, match="must be positive"):
            AnemoiTransform().validate(block=block, inputs={"dataset": input_dataset})

    def test_invalid_lead_time_not_a_timestep_multiple(self, six_hour_dummy_checkpoint: str, dummy_qube: Qube) -> None:
        input_dataset = QubedOutput(dataqube=dummy_qube)
        block = _make_block(
            AnemoiTransform,
            {"checkpoint": six_hour_dummy_checkpoint, "lead_time": 7},
            input_ids={"dataset": "src"},
        )
        result = AnemoiTransform().validate(block=block, inputs={"dataset": input_dataset})
        with pytest.raises(Exception, match="must be a multiple of checkpoint timestep"):
            result.get_or_raise()

    def test_unknown_checkpoint(self, registered_provider: None, dummy_qube: Qube) -> None:
        input_dataset = QubedOutput(dataqube=dummy_qube)
        block = _make_block(
            AnemoiTransform,
            {"checkpoint": "dummy_store:unknown", "lead_time": 24},
            input_ids={"dataset": "src"},
        )
        with pytest.raises(Exception):
            AnemoiTransform().validate(block=block, inputs={"dataset": input_dataset}).get_or_raise()

    def test_incompatible_input_dataset(self, dummy_checkpoint: str) -> None:
        """If the input dataset does not contain the model's required input params, validate should error."""
        incompatible = QubedOutput(dataqube=Qube.from_datacube({"param": ["nonexistent"]}))
        block = _make_block(
            AnemoiTransform,
            {"checkpoint": dummy_checkpoint, "lead_time": 24},
            input_ids={"dataset": "src"},
        )
        result = AnemoiTransform().validate(block=block, inputs={"dataset": incompatible})
        with pytest.raises(Exception, match="not compatible"):
            result.get_or_raise()


class TestAnemoiTransformIntersect:
    def test_accepts_output_with_param(self, anemoi_source_output: QubedOutput) -> None:
        assert AnemoiTransform().intersect(other=anemoi_source_output)  # type: ignore[arg-type]

    def test_rejects_output_without_param(self, anemoi_source_output: QubedOutput) -> None:
        no_param = collapse(anemoi_source_output, "param")
        assert not AnemoiTransform().intersect(other=no_param)  # type: ignore[arg-type]

    def test_rejects_empty_qubed_output(self) -> None:
        assert not AnemoiTransform().intersect(other=QubedOutput())  # type: ignore[arg-type]

    def test_rejects_non_qubed_output(self) -> None:
        assert not AnemoiTransform().intersect(other=MagicMock())  # type: ignore[arg-type]


# ===================================================================
# Flows - stacking blocks together
# ===================================================================


class TestFlowAnemoiSourceToTransform:
    """AnemoiSource → AnemoiTransform (chained inference)."""

    def test_source_output_feeds_transform(
        self,
        anemoi_source_output: QubedOutput,
        anemoi_transform_configuration: BlockInstance,
    ) -> None:
        """The deterministic source output should be a valid input for the transform."""
        output = (
            AnemoiTransform()
            .validate(
                block=anemoi_transform_configuration,
                inputs={"dataset": anemoi_source_output},
            )
            .get_or_raise()
        )
        assert isinstance(output, QubedOutput)
        assert contains(output, "param")
        assert contains(output, "step")

    def test_ensemble_source_propagates_number_through_transform(
        self,
        anemoi_source_ensemble_output: QubedOutput,
        anemoi_transform_configuration: BlockInstance,
    ) -> None:
        output: QubedOutput = (
            AnemoiTransform()
            .validate(
                block=anemoi_transform_configuration,
                inputs={"dataset": anemoi_source_ensemble_output},
            )
            .get_or_raise()
        )  # type: ignore[assignment]
        assert contains(output, "number")
        assert set(axes(output)["number"]) == {1, 2, 3}


class TestFlowAnemoiInputSourceToTransform:
    """AnemoiInputSource → AnemoiTransform (initial conditions → inference)."""

    def test_input_source_feeds_transform(
        self,
        anemoi_input_source_output: QubedOutput,
        anemoi_transform_configuration: BlockInstance,
    ) -> None:
        output = (
            AnemoiTransform()
            .validate(
                block=anemoi_transform_configuration,
                inputs={"dataset": anemoi_input_source_output},
            )
            .get_or_raise()
        )
        assert isinstance(output, QubedOutput)
        assert contains(output, "param")
        assert contains(output, "step")
        assert not contains(output, "number")


class TestFlowChainedTransforms:
    """AnemoiInputSource → AnemoiTransform → AnemoiTransform (two inference steps)."""

    def test_chained_transforms(
        self,
        dummy_checkpoint: str,
        anemoi_input_source_output: QubedOutput,
        anemoi_transform_configuration: BlockInstance,
    ) -> None:
        first_output: QubedOutput = (
            AnemoiTransform()
            .validate(
                block=anemoi_transform_configuration,
                inputs={"dataset": anemoi_input_source_output},
            )
            .get_or_raise()
        )  # type: ignore[assignment]

        second_config = _make_block(
            AnemoiTransform,
            {"checkpoint": dummy_checkpoint, "lead_time": 48},
            input_ids={"dataset": "first_transform"},
        )
        second_output: QubedOutput = (
            AnemoiTransform()
            .validate(
                block=second_config,
                inputs={"dataset": first_output},
            )
            .get_or_raise()
        )  # type: ignore[assignment]

        assert isinstance(second_output, QubedOutput)
        assert contains(second_output, "param")
        assert contains(second_output, "step")

    def test_chained_transforms_propagate_ensemble(
        self,
        dummy_checkpoint: str,
        anemoi_input_source_output: QubedOutput,
        anemoi_transform_configuration: BlockInstance,
    ) -> None:
        input_with_number = expand(anemoi_input_source_output, {"number": [1, 2]})

        first_output: QubedOutput = (
            AnemoiTransform()
            .validate(
                block=anemoi_transform_configuration,
                inputs={"dataset": input_with_number},
            )
            .get_or_raise()
        )  # type: ignore[assignment]
        assert contains(first_output, "number")

        second_config = _make_block(
            AnemoiTransform,
            {"checkpoint": dummy_checkpoint, "lead_time": 48},
            input_ids={"dataset": "first_transform"},
        )
        second_output: QubedOutput = (
            AnemoiTransform()
            .validate(
                block=second_config,
                inputs={"dataset": first_output},
            )
            .get_or_raise()
        )  # type: ignore[assignment]

        assert contains(second_output, "number")
        assert set(axes(second_output)["number"]) == {1, 2}


# ===================================================================
# Plugin-level integration
# ===================================================================


class TestAnemoiCatalogueIntegration:
    """Verify catalogue / enum types at the plugin registration level."""

    def test_checkpoint_enum_type_matches_registered_provider(self, registered_provider: None) -> None:
        assert get_checkpoint_enum_type() == "enumClosed['dummy_store:dummy_ckpt']"

    def test_plugin_expander_includes_anemoi_transform(self, anemoi_source_output: QubedOutput) -> None:
        """AnemoiTransform should appear in expansions for a QubedOutput that has 'param'."""
        expansions = plugin().expander(anemoi_source_output)
        factory_ids = {e.factory for e in expansions}
        assert BlockFactoryId("anemoiTransform") in factory_ids

    def test_plugin_expander_excludes_anemoi_transform_for_no_param(self) -> None:
        """AnemoiTransform should NOT appear when the output has no 'param' axis."""
        output = QubedOutput(dataqube=Qube.from_datacube({"step": [0, 6, 12]}))
        expansions = plugin().expander(output)
        factory_ids = {e.factory for e in expansions}
        assert BlockFactoryId("anemoiTransform") not in factory_ids

    def test_plugin_expander_excludes_sources_from_expansion(self, anemoi_source_output: QubedOutput) -> None:
        """Source blocks should never appear as expansions (they are roots)."""
        expansions = plugin().expander(anemoi_source_output)
        factory_ids = {e.factory for e in expansions}
        assert BlockFactoryId("anemoiSource") not in factory_ids
        assert BlockFactoryId("anemoiInputSource") not in factory_ids
