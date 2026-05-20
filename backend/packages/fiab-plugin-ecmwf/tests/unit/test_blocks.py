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
from qubed import Qube

from fiab_plugin_ecmwf import plugin
from fiab_plugin_ecmwf.anemoi.utils import get_checkpoint_enum_type
from fiab_plugin_ecmwf.blocks import (
    ENSEMBLE,
    PARAM,
    STEP,
    EkdSource,
    EnsembleStatistics,
    MapPlotSink,
    SelectMembers,
    SelectParameters,
    SelectSteps,
    TemporalStatistics,
    ZarrSink,
)
from fiab_plugin_ecmwf.qubed_utils import axes, collapse, contains


def _config(values: dict[str, object]) -> dict[ConfigurationOptionId, object]:
    return {ConfigurationOptionId(key): value for key, value in values.items()}


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
            factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory="SelectParameters"),  # type: ignore
            input_ids={"dataset": BlockInstanceId("source_output")},
            configuration_values=_config(
                {
                    "param": ["2t"],
                }
            ),
        ),
        SelectParameters.configuration_options,
    )


@pytest.fixture
def select_steps_configuration() -> BlockInstance:
    return BlockInstance.from_block(
        BlockInstanceBase(
            factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory="SelectSteps"),  # type: ignore
            input_ids={"dataset": BlockInstanceId("source_output")},
            configuration_values=_config(
                {
                    "step": [0],
                }
            ),
        ),
        SelectSteps.configuration_options,
    )


@pytest.fixture
def select_members_configuration() -> BlockInstance:
    return BlockInstance.from_block(
        BlockInstanceBase(
            factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory="SelectMembers"),  # type: ignore
            input_ids={"dataset": BlockInstanceId("source_output")},
            configuration_values=_config(
                {
                    "number": [1],
                }
            ),
        ),
        SelectMembers.configuration_options,
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
                    "style_schema": "inbuilt://fiab",
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
        assert isinstance(output, NoOutput)

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
        assert isinstance(output, NoOutput)

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
        assert isinstance(output, NoOutput)


class TestSelectParameters:
    def test_catalogue_value_type_is_canonical(self) -> None:
        assert SelectParameters.configuration_options[PARAM].value_type == "list[str]"

    def test_from_ekdsource(self, select_parameters_configuration: BlockInstance, ekdsource_output: QubedOutput) -> None:
        block = SelectParameters()
        assert block.intersect(other=ekdsource_output)  # type: ignore[arg-type]
        output = block.validate(block=select_parameters_configuration, inputs={"dataset": ekdsource_output}).get_or_raise()  # type: ignore[dict-item]
        assert isinstance(output, QubedOutput)
        assert output.dataqube is not None
        assert axes(output)["param"] == {"2t"}

    def test_from_ekdsource_multiple_parameters(
        self, select_parameters_configuration: BlockInstance, ekdsource_output: QubedOutput
    ) -> None:
        block = SelectParameters()
        config = select_parameters_configuration.model_copy(update={"configuration_values": _config({"param": ["2t", "msl"]})})
        output = block.validate(block=config, inputs={"dataset": ekdsource_output}).get_or_raise()  # type: ignore[dict-item]
        assert axes(output)["param"] == {"2t", "msl"}

    def test_missing_parameters(self, select_parameters_configuration: BlockInstance, ekdsource_output: QubedOutput) -> None:
        block = SelectParameters()
        config = select_parameters_configuration.model_copy(update={"configuration_values": _config({"param": ["nonexistent"]})})
        result = block.validate(block=config, inputs={"dataset": ekdsource_output})  # type: ignore[dict-item]
        with pytest.raises(Exception, match="parameters \\['nonexistent'\\] are not in the input parameters"):
            result.get_or_raise()

    def test_compile_calls_select(self, select_parameters_configuration: BlockInstance) -> None:
        block = SelectParameters()
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
        block = SelectParameters()
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
        assert SelectSteps.configuration_options[STEP].value_type == "list[int]"

    def test_from_ekdsource(self, select_steps_configuration: BlockInstance, ekdsource_output: QubedOutput) -> None:
        block = SelectSteps()
        assert block.intersect(other=ekdsource_output)  # type: ignore[arg-type]
        output = block.validate(block=select_steps_configuration, inputs={"dataset": ekdsource_output}).get_or_raise()  # type: ignore[dict-item]
        assert isinstance(output, QubedOutput)
        assert output.dataqube is not None
        assert axes(output)[STEP] == {0}

    def test_from_ekdsource_multiple_steps(self, select_steps_configuration: BlockInstance, ekdsource_output: QubedOutput) -> None:
        block = SelectSteps()
        config = select_steps_configuration.model_copy(update={"configuration_values": _config({"step": [0, 6]})})
        output = block.validate(block=config, inputs={"dataset": ekdsource_output}).get_or_raise()  # type: ignore[dict-item]
        assert axes(output)[STEP] == {0, 6}

    def test_missing_steps(self, select_steps_configuration: BlockInstance, ekdsource_output: QubedOutput) -> None:
        block = SelectSteps()
        config = select_steps_configuration.model_copy(update={"configuration_values": _config({"step": [999]})})
        result = block.validate(block=config, inputs={"dataset": ekdsource_output})  # type: ignore[dict-item]
        with pytest.raises(Exception, match="steps \\[999\\] are not in the input steps"):
            result.get_or_raise()

    def test_compile_calls_select(self, select_steps_configuration: BlockInstance) -> None:
        block = SelectSteps()
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
        block = SelectSteps()
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
        assert SelectMembers.configuration_options[ENSEMBLE].value_type == "list[int]"

    def test_from_ekdsource(self, select_members_configuration: BlockInstance, ekdsource_output: QubedOutput) -> None:
        block = SelectMembers()
        assert block.intersect(other=ekdsource_output)  # type: ignore[arg-type]
        output = block.validate(block=select_members_configuration, inputs={"dataset": ekdsource_output}).get_or_raise()  # type: ignore[dict-item]
        assert isinstance(output, QubedOutput)
        assert output.dataqube is not None
        assert axes(output)[ENSEMBLE] == {1}

    def test_from_ekdsource_multiple_members(self, select_members_configuration: BlockInstance, ekdsource_output: QubedOutput) -> None:
        block = SelectMembers()
        config = select_members_configuration.model_copy(update={"configuration_values": _config({"number": [1, 2]})})
        output = block.validate(block=config, inputs={"dataset": ekdsource_output}).get_or_raise()  # type: ignore[dict-item]
        assert axes(output)[ENSEMBLE] == {1, 2}

    def test_missing_members(self, select_members_configuration: BlockInstance, ekdsource_output: QubedOutput) -> None:
        block = SelectMembers()
        config = select_members_configuration.model_copy(update={"configuration_values": _config({"number": [999]})})
        result = block.validate(block=config, inputs={"dataset": ekdsource_output})  # type: ignore[dict-item]
        with pytest.raises(Exception, match="members \\[999\\] are not in the input members"):
            result.get_or_raise()

    def test_compile_calls_select(self, select_members_configuration: BlockInstance) -> None:
        block = SelectMembers()
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
        block = SelectMembers()
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
        assert map_plot_expansion.restrictions == {}

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
                        "style_schema": "inbuilt://fiab",
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
                        "style_schema": "inbuilt://fiab",
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
                        "style_schema": "inbuilt://fiab",
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
