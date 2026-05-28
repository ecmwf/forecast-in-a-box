# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.


from datetime import date
from unittest.mock import MagicMock

import pytest
from earthkit.workflows.fluent import Action
from fiab_core.fable import (
    BlockFactoryId,
    BlockInstanceId,
    ConfigurationOptionId,
    NoOutput,
    PluginBlockFactoryId,
    PluginCompositeId,
    QubedOutput,
    RawOutput,
)
from fiab_core.fable import (
    BlockInstance as BlockInstanceBase,
)
from fiab_core.tools.blocks import BlockInstanceRich as BlockInstance
from fiab_core.tools.blocks import QubedBlockBuilder
from qubed import Qube

from fiab_plugin_ecmwf import blocks as ecmwf_block_builders
from fiab_plugin_ecmwf import plugin
from fiab_plugin_ecmwf.anemoi.utils import get_checkpoint_enum_type
from fiab_plugin_ecmwf.blocks import (
    ENSEMBLE,
    PARAM,
    STEP,
    EkdSource,
    EnsembleStatistics,
    GribSink,
    MapPlotSink,
    SelectDimension,
    TemporalStatistics,
    ZarrSink,
)
from fiab_plugin_ecmwf.qubed_utils import axes, collapse, contains


def _config(values: dict[str, object]) -> dict[ConfigurationOptionId, object]:
    return {ConfigurationOptionId(key): value for key, value in values.items()}


def _block_builder(factory_id: str) -> QubedBlockBuilder:
    return ecmwf_block_builders[BlockFactoryId(factory_id)]


def _select_parameters() -> SelectDimension:
    block = _block_builder("selectParameters")
    assert isinstance(block, SelectDimension)
    return block


def _select_steps() -> SelectDimension:
    block = _block_builder("selectSteps")
    assert isinstance(block, SelectDimension)
    return block


def _select_members() -> SelectDimension:
    block = _block_builder("selectMembers")
    assert isinstance(block, SelectDimension)
    return block


@pytest.fixture
def dummy_blockinstance() -> BlockInstance:
    return BlockInstance.from_block(
        BlockInstanceBase(
            factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory="dummy"),  # type: ignore
            input_ids={},
            configuration_values=_config(
                {
                    "source": "ecmwf-open-data",
                    "date": date(2024, 1, 1),
                    "expver": "1",
                    "param": ["2t", "msl"],
                    "step": [0, 6, 12],
                    "number": [1, 2, 3, 4, 5],
                }
            ),
        ),
        EkdSource.configuration_options,
    )


@pytest.fixture
def dummy_blockinstance_output() -> QubedOutput:
    return QubedOutput()


@pytest.fixture
def ekdsource_configuration() -> BlockInstance:
    return BlockInstance.from_block(
        BlockInstanceBase(
            factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory="EkdSource"),  # type: ignore
            input_ids={},
            configuration_values=_config(
                {
                    "source": "ecmwf-open-data",
                    "date": date(2024, 1, 1),
                    "expver": "1",
                    "step": [0, 6, 12],
                    "number": [1, 2, 3, 4, 5],
                    "param": ["2t", "msl"],
                }
            ),
        ),
        EkdSource.configuration_options,
    )


@pytest.fixture
def ekdsource_output(dummy_blockinstance: BlockInstance) -> QubedOutput:
    return EkdSource().validate(block=dummy_blockinstance, inputs={}).get_or_raise()  # type: ignore[return-value]


@pytest.fixture
def ekdsource_action(dummy_blockinstance: BlockInstance) -> Action:
    return EkdSource().compile(inputs={}, block_id=BlockInstanceId("source_output"), block=dummy_blockinstance).get_or_raise()


@pytest.fixture
def ensemble_statistics_configuration() -> BlockInstance:
    return BlockInstance.from_block(
        BlockInstanceBase(
            factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory="EnsembleStatistics"),  # type: ignore
            input_ids={"dataset": BlockInstanceId("source_output")},
            configuration_values=_config(
                {
                    "param": "2t",
                    "statistic": "mean",
                }
            ),
        ),
        EnsembleStatistics.configuration_options,
    )


@pytest.fixture
def temporal_statistics_configuration() -> BlockInstance:
    return BlockInstance.from_block(
        BlockInstanceBase(
            factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory="TemporalStatistics"),  # type: ignore
            input_ids={"dataset": BlockInstanceId("source_output")},
            configuration_values=_config(
                {
                    "param": "2t",
                    "statistic": "mean",
                }
            ),
        ),
        TemporalStatistics.configuration_options,
    )


@pytest.fixture
def select_parameters_configuration() -> BlockInstance:
    return BlockInstance.from_block(
        BlockInstanceBase(
            factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory="selectParameters"),  # type: ignore
            input_ids={"dataset": BlockInstanceId("source_output")},
            configuration_values=_config(
                {
                    "param": ["2t"],
                }
            ),
        ),
        _select_parameters().configuration_options,
    )


@pytest.fixture
def select_steps_configuration() -> BlockInstance:
    return BlockInstance.from_block(
        BlockInstanceBase(
            factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory="selectSteps"),  # type: ignore
            input_ids={"dataset": BlockInstanceId("source_output")},
            configuration_values=_config(
                {
                    "step": [0],
                }
            ),
        ),
        _select_steps().configuration_options,
    )


@pytest.fixture
def select_members_configuration() -> BlockInstance:
    return BlockInstance.from_block(
        BlockInstanceBase(
            factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory="selectMembers"),  # type: ignore
            input_ids={"dataset": BlockInstanceId("source_output")},
            configuration_values=_config(
                {
                    "number": [1],
                }
            ),
        ),
        _select_members().configuration_options,
    )


@pytest.fixture
def zarr_sink_configuration() -> BlockInstance:
    return BlockInstance.from_block(
        BlockInstanceBase(
            factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory="ZarrSink"),  # type: ignore
            input_ids={"dataset": BlockInstanceId("source_output")},
            configuration_values=_config(
                {
                    "path": "/path/to/output.zarr",
                }
            ),
        ),
        ZarrSink.configuration_options,
    )


@pytest.fixture
def grib_sink_configuration() -> BlockInstance:
    return BlockInstance.from_block(
        BlockInstanceBase(
            factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory="GribSink"),  # type: ignore
            input_ids={"dataset": BlockInstanceId("source_output")},
            configuration_values=_config(
                {
                    "path": "/path/to/output.grib2",
                }
            ),
        ),
        GribSink.configuration_options,
    )


@pytest.fixture
def map_plot_sink_configuration() -> BlockInstance:
    return BlockInstance.from_block(
        BlockInstanceBase(
            factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory="MapPlotSink"),  # type: ignore
            input_ids={"dataset": BlockInstanceId("source_output")},
            configuration_values=_config(
                {
                    "param": ["2t"],
                    "domain": "global",
                    "format": "png",
                    "groupby": "step",
                    "splitby": [],
                }
            ),
        ),
        MapPlotSink.configuration_options,
    )


class TestEkdSource:
    def test_creation(self, dummy_blockinstance: BlockInstance, dummy_blockinstance_output: QubedOutput) -> None:
        block = EkdSource()

        assert not block.intersect(other=dummy_blockinstance_output)  # type: ignore[arg-type]
        output = block.validate(block=dummy_blockinstance, inputs={}).get_or_raise()  # type: ignore[assignment]
        assert isinstance(output, QubedOutput)
        assert output.dataqube is not None
        assert contains(output, "param")

    def test_catalogue_value_types_are_canonical(self) -> None:
        assert EkdSource.configuration_options[ConfigurationOptionId("source")].value_type == "enumClosed['mars', 'ecmwf-open-data']"
        assert EkdSource.configuration_options[ConfigurationOptionId("date")].value_type == "date"


class TestEnsembleStatistics:
    def test_catalogue_value_type_is_canonical(self) -> None:
        assert EnsembleStatistics.configuration_options[ConfigurationOptionId("statistic")].value_type == "enumClosed['mean', 'std']"

    def test_from_ekdsource(self, ensemble_statistics_configuration: BlockInstance, ekdsource_output: QubedOutput) -> None:
        block = EnsembleStatistics()

        assert block.intersect(other=ekdsource_output)  # type: ignore[arg-type]
        output = block.validate(  # type: ignore[assignment]
            block=ensemble_statistics_configuration,
            inputs={"dataset": ekdsource_output},  # type: ignore[dict-item]
        ).get_or_raise()
        assert isinstance(output, QubedOutput)
        assert output.dataqube is not None
        assert contains(output, "param")
        assert axes(output)["param"] == {"2t"}

    def test_from_temporal_statistics(
        self,
        ensemble_statistics_configuration: BlockInstance,
        temporal_statistics_configuration: BlockInstance,
        ekdsource_output: QubedOutput,
    ) -> None:
        temporal_block = TemporalStatistics()
        temporal_output = temporal_block.validate(  # type: ignore[assignment]
            block=temporal_statistics_configuration,
            inputs={"dataset": ekdsource_output},  # type: ignore[dict-item]
        ).get_or_raise()

        block = EnsembleStatistics()

        assert block.intersect(other=temporal_output)  # type: ignore[arg-type]
        output = block.validate(  # type: ignore[assignment]
            block=ensemble_statistics_configuration,
            inputs={"dataset": temporal_output},  # type: ignore[dict-item]
        ).get_or_raise()
        assert isinstance(output, QubedOutput)
        assert output.dataqube is not None
        assert contains(output, "param")
        assert axes(output)["param"] == {"2t"}

    def test_missing_param(self, ensemble_statistics_configuration: BlockInstance, ekdsource_output: QubedOutput) -> None:
        block = EnsembleStatistics()

        modified_output = collapse(ekdsource_output, "param")

        assert not block.intersect(other=modified_output)  # type: ignore[arg-type]
        result = block.validate(block=ensemble_statistics_configuration, inputs={"dataset": modified_output})  # type: ignore[dict-item]
        with pytest.raises(Exception, match="param 2t is not in the input parameters"):
            assert result.get_or_raise()


class TestTemporalStatistics:
    def test_catalogue_value_type_is_canonical(self) -> None:
        assert (
            TemporalStatistics.configuration_options[ConfigurationOptionId("statistic")].value_type
            == "enumClosed['mean', 'std', 'min', 'max']"
        )

    def test_from_ekdsource(self, temporal_statistics_configuration: BlockInstance, ekdsource_output: QubedOutput) -> None:
        block = TemporalStatistics()

        assert block.intersect(other=ekdsource_output)  # type: ignore[arg-type]
        output = block.validate(  # type: ignore[assignment]
            block=temporal_statistics_configuration,
            inputs={"dataset": ekdsource_output},  # type: ignore[dict-item]
        ).get_or_raise()
        assert isinstance(output, QubedOutput)
        assert output.dataqube is not None
        assert contains(output, "param")
        assert axes(output)["param"] == {"2t"}

    def test_from_ensemble_statistics(
        self,
        temporal_statistics_configuration: BlockInstance,
        ensemble_statistics_configuration: BlockInstance,
        ekdsource_output: QubedOutput,
    ) -> None:
        ensemble_block = EnsembleStatistics()
        ensemble_output = ensemble_block.validate(  # type: ignore[assignment]
            block=ensemble_statistics_configuration,
            inputs={"dataset": ekdsource_output},  # type: ignore[dict-item]
        ).get_or_raise()

        block = TemporalStatistics()

        assert block.intersect(other=ensemble_output)  # type: ignore[arg-type]
        output = block.validate(  # type: ignore[assignment]
            block=temporal_statistics_configuration,
            inputs={"dataset": ensemble_output},  # type: ignore[dict-item]
        ).get_or_raise()
        assert isinstance(output, QubedOutput)
        assert output.dataqube is not None
        assert contains(output, "param")
        assert axes(output)["param"] == {"2t"}

    def test_missing_param(self, temporal_statistics_configuration: BlockInstance, ekdsource_output: QubedOutput) -> None:
        block = TemporalStatistics()

        modified_output = collapse(ekdsource_output, "param")

        assert not block.intersect(other=modified_output)  # type: ignore[arg-type]
        result = block.validate(block=temporal_statistics_configuration, inputs={"dataset": modified_output})  # type: ignore[dict-item]
        with pytest.raises(Exception, match="param 2t is not in the input parameters"):
            assert result.get_or_raise()


class TestZarrSink:
    def test_from_ekdsource(self, zarr_sink_configuration: BlockInstance, ekdsource_output: QubedOutput) -> None:
        block = ZarrSink()

        assert block.intersect(other=ekdsource_output)  # type: ignore[arg-type]
        output = block.validate(  # type: ignore[assignment]
            block=zarr_sink_configuration,
            inputs={"dataset": ekdsource_output},  # type: ignore[dict-item]
        ).get_or_raise()
        assert isinstance(output, RawOutput)

    def test_from_ensemble_statistics(
        self,
        zarr_sink_configuration: BlockInstance,
        ensemble_statistics_configuration: BlockInstance,
        ekdsource_output: QubedOutput,
    ) -> None:
        ensemble_block = EnsembleStatistics()
        ensemble_output = ensemble_block.validate(  # type: ignore[assignment]
            block=ensemble_statistics_configuration,
            inputs={"dataset": ekdsource_output},  # type: ignore[dict-item]
        ).get_or_raise()

        block = ZarrSink()

        assert block.intersect(other=ensemble_output)  # type: ignore[arg-type]
        output = block.validate(  # type: ignore[assignment]
            block=zarr_sink_configuration,
            inputs={"dataset": ensemble_output},  # type: ignore[dict-item]
        ).get_or_raise()
        assert isinstance(output, RawOutput)

    def test_from_temporal_statistics(
        self,
        zarr_sink_configuration: BlockInstance,
        temporal_statistics_configuration: BlockInstance,
        ekdsource_output: QubedOutput,
    ) -> None:
        temporal_block = TemporalStatistics()
        temporal_output = temporal_block.validate(  # type: ignore[assignment]
            block=temporal_statistics_configuration,
            inputs={"dataset": ekdsource_output},  # type: ignore[dict-item]
        ).get_or_raise()

        block = ZarrSink()

        assert block.intersect(other=temporal_output)  # type: ignore[arg-type]
        output = block.validate(  # type: ignore[assignment]
            block=zarr_sink_configuration,
            inputs={"dataset": temporal_output},  # type: ignore[dict-item]
        ).get_or_raise()
        assert isinstance(output, RawOutput)

    def test_compile(self, ekdsource_output: QubedOutput, ekdsource_action: Action, zarr_sink_configuration: BlockInstance) -> None:
        block = ZarrSink()
        block.validate(block=zarr_sink_configuration, inputs={"dataset": ekdsource_output}).get_or_raise()  # type: ignore[dict-item]
        action = block.compile(
            inputs={BlockInstanceId("source_output"): ekdsource_action}, block_id=BlockInstanceId("grib"), block=zarr_sink_configuration
        ).get_or_raise()
        assert action.nodes.dims == {}


class TestSelectParameters:
    def test_catalogue_value_type_is_canonical(self) -> None:
        assert _select_parameters().configuration_options[PARAM].value_type == "list[str]"

    def test_from_ekdsource(self, select_parameters_configuration: BlockInstance, ekdsource_output: QubedOutput) -> None:
        block = _select_parameters()
        assert block.intersect(other=ekdsource_output)  # type: ignore[arg-type]
        output = block.validate(block=select_parameters_configuration, inputs={"dataset": ekdsource_output}).get_or_raise()  # type: ignore[dict-item]
        assert isinstance(output, QubedOutput)
        assert output.dataqube is not None
        assert axes(output)["param"] == {"2t"}

    def test_from_ekdsource_multiple_parameters(
        self, select_parameters_configuration: BlockInstance, ekdsource_output: QubedOutput
    ) -> None:
        block = _select_parameters()
        config = select_parameters_configuration.model_copy(update={"configuration_values": _config({"param": ["2t", "msl"]})})
        output = block.validate(block=config, inputs={"dataset": ekdsource_output}).get_or_raise()  # type: ignore[dict-item]
        assert isinstance(output, QubedOutput)
        assert axes(output)["param"] == {"2t", "msl"}

    def test_missing_parameters(self, select_parameters_configuration: BlockInstance, ekdsource_output: QubedOutput) -> None:
        block = _select_parameters()
        config = select_parameters_configuration.model_copy(update={"configuration_values": _config({"param": ["nonexistent"]})})
        result = block.validate(block=config, inputs={"dataset": ekdsource_output})  # type: ignore[dict-item]
        with pytest.raises(Exception, match="parameters \\['nonexistent'\\] are not in the input parameters"):
            result.get_or_raise()

    def test_compile_calls_select(self, select_parameters_configuration: BlockInstance) -> None:
        block = _select_parameters()
        input_action = MagicMock()
        selected_action = MagicMock()
        input_action.select.return_value = selected_action

        result = block.compile(
            inputs={BlockInstanceId("source_output"): input_action},  # type: ignore[dict-item]
            block_id=BlockInstanceId("select_parameters"),
            block=select_parameters_configuration,
        )
        assert result.t is selected_action
        input_action.select.assert_called_once_with({ConfigurationOptionId("param"): "2t"})

    def test_compile_calls_select_with_multiple_parameters(self, select_parameters_configuration: BlockInstance) -> None:
        block = _select_parameters()
        input_action = MagicMock()
        selected_action = MagicMock()
        input_action.select.return_value = selected_action
        config = select_parameters_configuration.model_copy(update={"configuration_values": _config({"param": ["2t", "msl"]})})

        result = block.compile(
            inputs={BlockInstanceId("source_output"): input_action},  # type: ignore[dict-item]
            block_id=BlockInstanceId("select_parameters"),
            block=config,
        )
        assert result.t is selected_action
        input_action.select.assert_called_once_with({ConfigurationOptionId("param"): ["2t", "msl"]})

    def test_expander_adds_parameters_restrictions(self, ekdsource_output: QubedOutput) -> None:
        expansions = plugin().expander(ekdsource_output)
        select_expansion = next(expansion for expansion in expansions if expansion.factory == BlockFactoryId("selectParameters"))
        assert select_expansion.restrictions[PARAM].serialize() == "list[enumClosed[2t,msl]]"

    def test_expander_skips_restriction_for_non_string_axes(self) -> None:
        output = QubedOutput(dataqube=Qube.from_datacube({"param": [1, 2]}))
        expansions = plugin().expander(output)
        select_expansion = next(expansion for expansion in expansions if expansion.factory == BlockFactoryId("selectParameters"))
        assert select_expansion.restrictions == {}


class TestSelectSteps:
    def test_catalogue_value_type_is_canonical(self) -> None:
        assert _select_steps().configuration_options[STEP].value_type == "list[int]"

    def test_from_ekdsource(self, select_steps_configuration: BlockInstance, ekdsource_output: QubedOutput) -> None:
        block = _select_steps()
        assert block.intersect(other=ekdsource_output)  # type: ignore[arg-type]
        output = block.validate(block=select_steps_configuration, inputs={"dataset": ekdsource_output}).get_or_raise()  # type: ignore[dict-item]
        assert isinstance(output, QubedOutput)
        assert output.dataqube is not None
        assert axes(output)[STEP] == {0}

    def test_from_ekdsource_multiple_steps(self, select_steps_configuration: BlockInstance, ekdsource_output: QubedOutput) -> None:
        block = _select_steps()
        config = select_steps_configuration.model_copy(update={"configuration_values": _config({"step": [0, 6]})})
        output = block.validate(block=config, inputs={"dataset": ekdsource_output}).get_or_raise()  # type: ignore[dict-item]
        assert isinstance(output, QubedOutput)
        assert axes(output)[STEP] == {0, 6}

    def test_missing_steps(self, select_steps_configuration: BlockInstance, ekdsource_output: QubedOutput) -> None:
        block = _select_steps()
        config = select_steps_configuration.model_copy(update={"configuration_values": _config({"step": [999]})})
        result = block.validate(block=config, inputs={"dataset": ekdsource_output})  # type: ignore[dict-item]
        with pytest.raises(Exception, match="steps \\[999\\] are not in the input steps"):
            result.get_or_raise()

    def test_compile_calls_select(self, select_steps_configuration: BlockInstance) -> None:
        block = _select_steps()
        input_action = MagicMock()
        selected_action = MagicMock()
        input_action.select.return_value = selected_action

        result = block.compile(
            inputs={BlockInstanceId("source_output"): input_action},  # type: ignore[dict-item]
            block_id=BlockInstanceId("select_steps"),
            block=select_steps_configuration,
        )
        assert result.t is selected_action
        input_action.select.assert_called_once_with({STEP: 0})

    def test_compile_calls_select_with_multiple_steps(self, select_steps_configuration: BlockInstance) -> None:
        block = _select_steps()
        input_action = MagicMock()
        selected_action = MagicMock()
        input_action.select.return_value = selected_action
        config = select_steps_configuration.model_copy(update={"configuration_values": _config({"step": [0, 6]})})

        result = block.compile(
            inputs={BlockInstanceId("source_output"): input_action},  # type: ignore[dict-item]
            block_id=BlockInstanceId("select_steps"),
            block=config,
        )
        assert result.t is selected_action
        input_action.select.assert_called_once_with({STEP: [0, 6]})

    def test_expander_adds_step_restrictions(self, ekdsource_output: QubedOutput) -> None:
        expansions = plugin().expander(ekdsource_output)
        select_expansion = next(expansion for expansion in expansions if expansion.factory == BlockFactoryId("selectSteps"))
        assert select_expansion.restrictions[STEP].serialize() == "list[enumClosed[0,6,12]]"

    def test_expander_skips_restriction_for_non_int_axes(self) -> None:
        output = QubedOutput(dataqube=Qube.from_datacube({STEP: ["0", "6"]}))
        expansions = plugin().expander(output)
        select_expansion = next(expansion for expansion in expansions if expansion.factory == BlockFactoryId("selectSteps"))
        assert select_expansion.restrictions == {}


class TestSelectMembers:
    def test_catalogue_value_type_is_canonical(self) -> None:
        assert _select_members().configuration_options[ENSEMBLE].value_type == "list[int]"

    def test_from_ekdsource(self, select_members_configuration: BlockInstance, ekdsource_output: QubedOutput) -> None:
        block = _select_members()
        assert block.intersect(other=ekdsource_output)  # type: ignore[arg-type]
        output = block.validate(block=select_members_configuration, inputs={"dataset": ekdsource_output}).get_or_raise()  # type: ignore[dict-item]
        assert isinstance(output, QubedOutput)
        assert output.dataqube is not None
        assert axes(output)[ENSEMBLE] == {1}

    def test_from_ekdsource_multiple_members(self, select_members_configuration: BlockInstance, ekdsource_output: QubedOutput) -> None:
        block = _select_members()
        config = select_members_configuration.model_copy(update={"configuration_values": _config({"number": [1, 2]})})
        output = block.validate(block=config, inputs={"dataset": ekdsource_output}).get_or_raise()  # type: ignore[dict-item]
        assert isinstance(output, QubedOutput)
        assert axes(output)[ENSEMBLE] == {1, 2}

    def test_missing_members(self, select_members_configuration: BlockInstance, ekdsource_output: QubedOutput) -> None:
        block = _select_members()
        config = select_members_configuration.model_copy(update={"configuration_values": _config({"number": [999]})})
        result = block.validate(block=config, inputs={"dataset": ekdsource_output})  # type: ignore[dict-item]
        with pytest.raises(Exception, match="members \\[999\\] are not in the input members"):
            result.get_or_raise()

    def test_compile_calls_select(self, select_members_configuration: BlockInstance) -> None:
        block = _select_members()
        input_action = MagicMock()
        selected_action = MagicMock()
        input_action.select.return_value = selected_action

        result = block.compile(
            inputs={BlockInstanceId("source_output"): input_action},  # type: ignore[dict-item]
            block_id=BlockInstanceId("select_members"),
            block=select_members_configuration,
        )
        assert result.t is selected_action
        input_action.select.assert_called_once_with({ENSEMBLE: 1})

    def test_compile_calls_select_with_multiple_members(self, select_members_configuration: BlockInstance) -> None:
        block = _select_members()
        input_action = MagicMock()
        selected_action = MagicMock()
        input_action.select.return_value = selected_action
        config = select_members_configuration.model_copy(update={"configuration_values": _config({"number": [1, 2]})})

        result = block.compile(
            inputs={BlockInstanceId("source_output"): input_action},  # type: ignore[dict-item]
            block_id=BlockInstanceId("select_members"),
            block=config,
        )
        assert result.t is selected_action
        input_action.select.assert_called_once_with({ENSEMBLE: [1, 2]})

    def test_expander_adds_member_restrictions(self, ekdsource_output: QubedOutput) -> None:
        expansions = plugin().expander(ekdsource_output)
        select_expansion = next(expansion for expansion in expansions if expansion.factory == BlockFactoryId("selectMembers"))
        assert select_expansion.restrictions[ENSEMBLE].serialize() == "list[enumClosed[1,2,3,4,5]]"

    def test_expander_skips_restriction_for_non_int_axes(self) -> None:
        output = QubedOutput(dataqube=Qube.from_datacube({ENSEMBLE: ["1", "2"]}))
        expansions = plugin().expander(output)
        select_expansion = next(expansion for expansion in expansions if expansion.factory == BlockFactoryId("selectMembers"))
        assert select_expansion.restrictions == {}


def test_anemoi_catalogue_value_types_are_canonical(registered_provider: None) -> None:
    assert get_checkpoint_enum_type() == "enumClosed['dummy_store:dummy_ckpt']"


class TestGribSink:
    def test_from_ekdsource(self, grib_sink_configuration: BlockInstance, ekdsource_output: QubedOutput) -> None:
        block = GribSink()

        assert block.intersect(other=ekdsource_output)  # type: ignore[arg-type]
        output = block.validate(  # type: ignore[assignment]
            block=grib_sink_configuration,
            inputs={"dataset": ekdsource_output},  # type: ignore[dict-item]
        ).get_or_raise()
        assert isinstance(output, RawOutput)

    def test_from_ensemble_statistics(
        self,
        grib_sink_configuration: BlockInstance,
        ensemble_statistics_configuration: BlockInstance,
        ekdsource_output: QubedOutput,
    ) -> None:
        ensemble_block = EnsembleStatistics()
        ensemble_output = ensemble_block.validate(  # type: ignore[assignment]
            block=ensemble_statistics_configuration,
            inputs={"dataset": ekdsource_output},  # type: ignore[dict-item]
        ).get_or_raise()

        block = GribSink()

        assert block.intersect(other=ensemble_output)  # type: ignore[arg-type]
        output = block.validate(  # type: ignore[assignment]
            block=grib_sink_configuration,
            inputs={"dataset": ensemble_output},  # type: ignore[dict-item]
        ).get_or_raise()
        assert isinstance(output, RawOutput)

    def test_from_temporal_statistics(
        self,
        grib_sink_configuration: BlockInstance,
        temporal_statistics_configuration: BlockInstance,
        ekdsource_output: QubedOutput,
    ) -> None:
        temporal_block = TemporalStatistics()
        temporal_output = temporal_block.validate(  # type: ignore[assignment]
            block=temporal_statistics_configuration,
            inputs={"dataset": ekdsource_output},  # type: ignore[dict-item]
        ).get_or_raise()

        block = GribSink()

        assert block.intersect(other=temporal_output)  # type: ignore[arg-type]
        output = block.validate(  # type: ignore[assignment]
            block=grib_sink_configuration,
            inputs={"dataset": temporal_output},  # type: ignore[dict-item]
        ).get_or_raise()
        assert isinstance(output, RawOutput)

    @pytest.mark.parametrize(
        "filepath",
        [
            "/path/to/output.grib",
            "/path/to/{param}.grib",
            "/path/to/{shortName}.grib",
            "/path/to/{param}_{shortName}_{step}.grib",
        ],
    )
    def test_validate_template_values(self, ekdsource_output: QubedOutput, filepath: str) -> None:
        block = GribSink()
        config = BlockInstance.from_block(
            BlockInstanceBase(
                factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory="GribSink"),  # type: ignore
                input_ids={"dataset": BlockInstanceId("source_output")},
                configuration_values=_config(
                    {
                        "path": filepath,
                    }
                ),
            ),
            GribSink.configuration_options,
        )
        output = block.validate(  # type: ignore[assignment]
            block=config,
            inputs={"dataset": ekdsource_output},  # type: ignore[dict-item]
        ).get_or_raise()
        assert isinstance(output, RawOutput)

    def test_invalid_path(self, ekdsource_output: QubedOutput) -> None:
        block = GribSink()
        config = BlockInstance.from_block(
            BlockInstanceBase(
                factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory="GribSink"),  # type: ignore
                input_ids={"dataset": BlockInstanceId("source_output")},
                configuration_values=_config(
                    {
                        "path": "/path/to/[param]/[step].grib",
                    }
                ),
            ),
            GribSink.configuration_options,
        )
        output = block.validate(  # type: ignore[assignment]
            block=config,
            inputs={"dataset": ekdsource_output},  # type: ignore[dict-item]
        )
        with pytest.raises(Exception, match="Invalid filepath: directory path can not contain template values"):
            output.get_or_raise()

    @pytest.mark.parametrize(
        "filepath, dims",
        [
            ["/path/to/output.grib", {}],
            ["/path/to/[param].grib", {"param": 2}],
            ["/path/to/[param]_[shortName]_[step].grib", {"param": 2, "step": 3}],
            ["/path/to/[stepRange]_[number]_[non_dim].grib", {"step": 3, "number": 5}],
        ],
    )
    def test_compile(self, ekdsource_output: QubedOutput, ekdsource_action: Action, filepath: str, dims: dict[str, int]) -> None:
        block = GribSink()
        config = BlockInstance.from_block(
            BlockInstanceBase(
                factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory="GribSink"),  # type: ignore
                input_ids={"dataset": BlockInstanceId("source_output")},
                configuration_values=_config(
                    {
                        "path": filepath,
                    }
                ),
            ),
            GribSink.configuration_options,
        )
        block.validate(block=config, inputs={"dataset": ekdsource_output}).get_or_raise()  # type: ignore[dict-item]
        action = block.compile(
            inputs={BlockInstanceId("source_output"): ekdsource_action}, block_id=BlockInstanceId("grib"), block=config
        ).get_or_raise()
        assert action.nodes.dims == dims


class TestMapPlotSink:
    def test_intersect_from_ekdsource(self, ekdsource_output: QubedOutput) -> None:
        block = MapPlotSink()
        assert block.intersect(other=ekdsource_output)  # type: ignore[arg-type]

    def test_intersect_rejects_empty(self, dummy_blockinstance_output: QubedOutput) -> None:
        block = MapPlotSink()
        assert not block.intersect(other=dummy_blockinstance_output)  # type: ignore[arg-type]

    def test_intersect_rejects_no_param(self, ekdsource_output: QubedOutput) -> None:
        block = MapPlotSink()
        collapsed = collapse(ekdsource_output, "param")
        assert not block.intersect(other=collapsed)  # type: ignore[arg-type]

    def test_expander_adds_parameters_restrictions(self, ekdsource_output: QubedOutput) -> None:
        expansions = plugin().expander(ekdsource_output)
        map_plot_expansion = next(expansion for expansion in expansions if expansion.factory == BlockFactoryId("mapPlotSink"))
        assert map_plot_expansion.restrictions[PARAM].serialize() == "list[enumClosed[2t,msl]]"

    def test_expander_skips_restriction_for_non_string_axes(self) -> None:
        output = QubedOutput(dataqube=Qube.from_datacube({"param": [1, 2]}))
        expansions = plugin().expander(output)
        map_plot_expansion = next(expansion for expansion in expansions if expansion.factory == BlockFactoryId("mapPlotSink"))
        assert PARAM not in map_plot_expansion.restrictions

    def test_validate_from_ekdsource(self, map_plot_sink_configuration: BlockInstance, ekdsource_output: QubedOutput) -> None:
        block = MapPlotSink()
        output = block.validate(block=map_plot_sink_configuration, inputs={"dataset": ekdsource_output}).get_or_raise()  # type: ignore[dict-item]
        assert isinstance(output, RawOutput)
        assert output.type_fqn == "bytes"
        assert output.mime_type == "image/png"

    @pytest.mark.parametrize(
        ("fmt", "expected_mime"),
        [
            ("png", "image/png"),
            ("pdf", "application/pdf"),
            ("svg", "image/svg+xml"),
        ],
    )
    def test_validate_sets_mime_from_format(self, fmt: str, expected_mime: str, ekdsource_output: QubedOutput) -> None:
        block = MapPlotSink()
        config = BlockInstance.from_block(
            BlockInstanceBase(
                factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory=BlockFactoryId("MapPlotSink")),  # type: ignore
                input_ids={"dataset": BlockInstanceId("source_output")},
                configuration_values=_config(
                    {
                        "param": ["2t"],
                        "domain": "global",
                        "format": fmt,
                        "groupby": "none",
                        "splitby": [],
                    }
                ),
            ),
            MapPlotSink.configuration_options,
        )
        output = block.validate(block=config, inputs={"dataset": ekdsource_output}).get_or_raise()  # type: ignore[dict-item]
        assert isinstance(output, RawOutput)
        assert output.type_fqn == "bytes"
        assert output.mime_type == expected_mime

    def test_validate_multi_param(self, ekdsource_output: QubedOutput) -> None:
        block = MapPlotSink()
        config = BlockInstance.from_block(
            BlockInstanceBase(
                factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory=BlockFactoryId("MapPlotSink")),  # type: ignore
                input_ids={"dataset": BlockInstanceId("source_output")},
                configuration_values=_config(
                    {
                        "param": ["2t", "msl"],
                        "domain": "global",
                        "format": "png",
                        "groupby": "none",
                        "splitby": [],
                    }
                ),
            ),
            MapPlotSink.configuration_options,
        )
        output = block.validate(block=config, inputs={"dataset": ekdsource_output}).get_or_raise()  # type: ignore[dict-item]
        assert isinstance(output, RawOutput)

    def test_validate_missing_param(self, ekdsource_output: QubedOutput) -> None:
        block = MapPlotSink()
        config = BlockInstance.from_block(
            BlockInstanceBase(
                factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory=BlockFactoryId("MapPlotSink")),  # type: ignore
                input_ids={"dataset": BlockInstanceId("source_output")},
                configuration_values=_config(
                    {
                        "param": ["nonexistent"],
                        "domain": "global",
                        "format": "png",
                        "groupby": "none",
                        "splitby": [],
                    }
                ),
            ),
            MapPlotSink.configuration_options,
        )
        result = block.validate(block=config, inputs={"dataset": ekdsource_output})  # type: ignore[dict-item]
        with pytest.raises(Exception, match="params \\['nonexistent'\\] are not in the input parameters"):
            result.get_or_raise()

    def test_validate_partial_missing_params(self, ekdsource_output: QubedOutput) -> None:
        block = MapPlotSink()
        config = BlockInstance.from_block(
            BlockInstanceBase(
                factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory=BlockFactoryId("MapPlotSink")),  # type: ignore
                input_ids={"dataset": BlockInstanceId("source_output")},
                configuration_values=_config(
                    {
                        "param": ["2t", "nonexistent"],
                        "domain": "global",
                        "format": "png",
                        "groupby": "none",
                        "splitby": [],
                    }
                ),
            ),
            MapPlotSink.configuration_options,
        )
        result = block.validate(block=config, inputs={"dataset": ekdsource_output})  # type: ignore[dict-item]
        with pytest.raises(Exception, match="params \\['nonexistent'\\] are not in the input parameters"):
            result.get_or_raise()

    def test_validate_from_ensemble_statistics(
        self,
        map_plot_sink_configuration: BlockInstance,
        ensemble_statistics_configuration: BlockInstance,
        ekdsource_output: QubedOutput,
    ) -> None:
        ensemble_output = (
            EnsembleStatistics().validate(block=ensemble_statistics_configuration, inputs={"dataset": ekdsource_output}).get_or_raise()  # type: ignore[dict-item]
        )

        block = MapPlotSink()
        assert block.intersect(other=ensemble_output)  # type: ignore[arg-type]
        output = block.validate(block=map_plot_sink_configuration, inputs={"dataset": ensemble_output}).get_or_raise()  # type: ignore[dict-item]
        assert isinstance(output, RawOutput)

    @pytest.mark.parametrize("groupby", ["none", "number"])
    def test_compile_groupby(self, ekdsource_output: QubedOutput, ekdsource_action: Action, groupby: str) -> None:
        block = MapPlotSink()
        config = BlockInstance.from_block(
            BlockInstanceBase(
                factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory=BlockFactoryId("MapPlotSink")),  # type: ignore
                input_ids={"dataset": BlockInstanceId("source_output")},
                configuration_values=_config(
                    {
                        "param": ["2t", "msl"],
                        "domain": "global",
                        "format": "png",
                        "groupby": groupby,
                        "splitby": [],
                    }
                ),
            ),
            MapPlotSink.configuration_options,
        )
        block.validate(block=config, inputs={"dataset": ekdsource_output}).get_or_raise()  # type: ignore[dict-item]
        action = block.compile(
            inputs={BlockInstanceId("source_output"): ekdsource_action}, block_id=BlockInstanceId("plot"), block=config
        ).get_or_raise()
        assert action.nodes.dims == {}

    def test_validate_splitby(self, ekdsource_output: QubedOutput) -> None:
        block = MapPlotSink()
        config = BlockInstance.from_block(
            BlockInstanceBase(
                factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory=BlockFactoryId("MapPlotSink")),  # type: ignore
                input_ids={"dataset": BlockInstanceId("source_output")},
                configuration_values=_config(
                    {
                        "param": ["2t", "msl"],
                        "domain": "global",
                        "format": "png",
                        "groupby": "none",
                        "splitby": ["none", "param"],
                    }
                ),
            ),
            MapPlotSink.configuration_options,
        )
        with pytest.raises(Exception, match="Invalid splitby value: if none is selected, no other dimensions can be present"):
            block.validate(block=config, inputs={"dataset": ekdsource_output}).get_or_raise()  # type: ignore[dict-item]

    @pytest.mark.parametrize(
        "splitby, dims", [[[], {}], [["none"], {}], [["number"], {"number": 5}], [["number", "step"], {"number": 5, "step": 3}]]
    )
    def test_compile_splitby(self, ekdsource_output: QubedOutput, ekdsource_action: Action, splitby: str, dims: dict[str, int]) -> None:
        block = MapPlotSink()
        config = BlockInstance.from_block(
            BlockInstanceBase(
                factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory=BlockFactoryId("MapPlotSink")),  # type: ignore
                input_ids={"dataset": BlockInstanceId("source_output")},
                configuration_values=_config(
                    {
                        "param": ["2t", "msl"],
                        "domain": "global",
                        "format": "png",
                        "groupby": "none",
                        "splitby": splitby,
                    }
                ),
            ),
            MapPlotSink.configuration_options,
        )
        block.validate(block=config, inputs={"dataset": ekdsource_output}).get_or_raise()  # type: ignore[dict-item]
        action = block.compile(
            inputs={BlockInstanceId("source_output"): ekdsource_action}, block_id=BlockInstanceId("plot"), block=config
        ).get_or_raise()
        assert action.nodes.dims == dims
