# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.


from datetime import datetime
from typing import Any, cast

import pytest
from earthkit.workflows import nodetree
from earthkit.workflows.fluent import Action
from earthkit.workflows.plugins.pproc.fluent import from_source
from fiab_core.artifacts import CompositeArtifactId
from fiab_core.fable import (
    BlockFactoryId,
    BlockInstanceId,
    ConfigurationOptionId,
    QubedOutput,
)
from fiab_core.fable import (
    BlockInstance as BlockInstanceBase,
)
from fiab_core.tools.blocks import BlockInstanceRich as BlockInstance
from pytest_lazy_fixtures import lf
from qubed import Qube

from fiab_plugin_ecmwf import plugin
from fiab_plugin_ecmwf.anemoi.blocks import AnemoiSource
from fiab_plugin_ecmwf.block_utils import (
    BASE_TIME,
    CHECKPOINT,
    COMPARISON,
    ENSEMBLE,
    INPUT_SOURCE,
    LEAD_TIME,
    LEVTYPE,
    PARAM,
    QUANTILE,
    STEP,
    THRESHOLD,
    TYPE,
    _param_id_to_param_key,
)
from fiab_plugin_ecmwf.blocks import OperationalForecastSource
from fiab_plugin_ecmwf.products.blocks import (
    CustomThresholdProbability,
    EnsembleStatistics,
    PredefinedThresholdProbability,
    Quantiles,
    ThermalIndices,
    WindSpeed,
)
from fiab_plugin_ecmwf.qubed_utils import axes, collapse, contains, coxpand, datacubes, select

PRODUCT_BLOCKS = [
    BlockFactoryId("ensembleStatistics"),
    BlockFactoryId("predefinedThresholdProbability"),
    BlockFactoryId("customThresholdProbability"),
    BlockFactoryId("thermalIndices"),
    BlockFactoryId("windSpeed"),
    BlockFactoryId("quantiles"),
]


@pytest.fixture
def ensemble_statistics_output() -> QubedOutput:
    return QubedOutput(dataqube=Qube.from_datacube({PARAM: ["167", "151", "131"], STEP: [0, 6, 12], TYPE: ["em", "es"]}))


@pytest.fixture
def threshold_probability_output() -> QubedOutput:
    return QubedOutput(dataqube=Qube.from_datacube({PARAM: "167", STEP: [0, 6, 12], TYPE: ["ep"]}))


@pytest.fixture
def predefined_threshold_prob_configuration() -> BlockInstance:
    return BlockInstance.from_block(
        BlockFactoryId("predefinedThresholdProbability"),
        BlockInstanceBase(
            input_ids={"dataset": BlockInstanceId("source_output")},
            configuration_values={
                PARAM: _param_id_to_param_key("131073"),
            },
        ),
        PredefinedThresholdProbability.configuration_options,
    )


@pytest.fixture
def custom_threshold_prob_configuration() -> BlockInstance:
    return BlockInstance.from_block(
        BlockFactoryId("customThresholdProbability"),
        BlockInstanceBase(
            input_ids={"dataset": BlockInstanceId("source_output")},
            configuration_values={
                THRESHOLD: 0.5,
                COMPARISON: ">=",
            },
        ),
        CustomThresholdProbability.configuration_options,
    )


@pytest.fixture
def thermal_indices_configuration() -> BlockInstance:
    return BlockInstance.from_block(
        BlockFactoryId("thermalIndices"),
        BlockInstanceBase(
            input_ids={"dataset": BlockInstanceId("source_output")},
            configuration_values={
                PARAM: [_param_id_to_param_key(id) for id in ["261023", "260242"]],
            },
        ),
        ThermalIndices.configuration_options,
    )


@pytest.fixture
def wind_speed_configuration() -> BlockInstance:
    return BlockInstance.from_block(
        BlockFactoryId("windSpeed"),
        BlockInstanceBase(
            input_ids={"dataset": BlockInstanceId("source_output")},
            configuration_values={
                PARAM: [_param_id_to_param_key(id) for id in ["207", "228249"]],
            },
        ),
        WindSpeed.configuration_options,
    )


@pytest.fixture
def quantiles_configuration() -> BlockInstance:
    return BlockInstance.from_block(
        BlockFactoryId("quantiles"),
        BlockInstanceBase(
            input_ids={"dataset": BlockInstanceId("source_output")},
            configuration_values={
                QUANTILE: 4,
            },
        ),
        Quantiles.configuration_options,
    )


@pytest.fixture
def full_operational_forecast_source_output(dummy_blockinstance: BlockInstance) -> QubedOutput:
    return cast(QubedOutput, OperationalForecastSource().validate(block=dummy_blockinstance, inputs={}, restrictions={}))


class TestEnsembleStatistics:
    def test_catalogue_value_type_is_canonical(self) -> None:
        assert (
            EnsembleStatistics.configuration_options[ConfigurationOptionId("statistic")].value_type.serialize()
            == "list[enumClosed[str]('mean','std')]"
        )

    @pytest.mark.parametrize(
        "forecast_output, expected_params",
        [
            (lf("operational_forecast_source_output"), {"167", "151", "131"}),
            # (lf("anemoi_source_ensemble_output"), {"167", "151"}),
        ],
    )
    def test_from_forecast_source(
        self, ensemble_statistics_configuration: BlockInstance, forecast_output: QubedOutput, expected_params: set[str]
    ) -> None:
        block = EnsembleStatistics()

        assert block.intersect(other=forecast_output)  # type: ignore[arg-type]
        output = block.validate(  # type: ignore[assignment]
            block=ensemble_statistics_configuration,
            inputs={"dataset": forecast_output},  # type: ignore[dict-item],
            restrictions={},
        )
        assert isinstance(output, QubedOutput)
        assert output.dataqube is not None
        assert contains(output, PARAM)
        assert axes(output)[PARAM] == expected_params
        assert axes(output)[TYPE] == {"em"}

    @pytest.mark.parametrize(
        "forecast_output, source_action, expected, identical_qubes",
        [
            (
                lf("operational_forecast_source_output"),
                lf("operational_forecast_source_action"),
                {PARAM: {"167", "151", "131"}, TYPE: {"em"}, STEP: {0, 6, 12}},
                True,
            ),
            # (
            #     lf("anemoi_source_ensemble_output"),
            #     lf("anemoi_source_ensemble_action"),
            #     {PARAM: {"2t", "msl"}, TYPE: {"em"}, STEP: set(range(1, 25))},
            #     False,
            # ),
        ],
    )
    def test_compile(
        self,
        ensemble_statistics_configuration: BlockInstance,
        forecast_output: QubedOutput,
        source_action: Action,
        expected: dict[str, set[Any]],
        identical_qubes: bool,
    ) -> None:
        block = EnsembleStatistics()
        output = block.validate(block=ensemble_statistics_configuration, inputs={"dataset": forecast_output}, restrictions={})  # type: ignore[dict-item]
        action = block.compile(
            inputs={BlockInstanceId("source_output"): source_action},
            block=ensemble_statistics_configuration,
        ).get_or_raise()
        requests = nodetree.datacubes(action.nodes)
        assert len(requests) == 2
        for dim, values in expected.items():
            assert set.union(*[set(req[dim]) for req in requests]) == values
        if identical_qubes:
            assert list(datacubes(output)) == requests

    def test_expansion(self, ensemble_statistics_output: QubedOutput) -> None:
        for expansion in plugin().expander(ensemble_statistics_output):
            assert expansion.factory not in PRODUCT_BLOCKS


class TestPredefinedThresholdProb:
    @pytest.mark.parametrize(
        "forecast_output, expected",
        [
            (lf("operational_forecast_source_output"), {"param": {"131073"}, "type": {"ep"}, "step": {12}, "levtype": {"sfc"}}),
            # (lf("anemoi_source_ensemble_output"), {"param": {"131073"}, "type": {"ep"}, "step": {12}, "levtype": {"sfc"}}),
        ],
    )
    def test_from_forecast_source(
        self, predefined_threshold_prob_configuration: BlockInstance, forecast_output: QubedOutput, expected: dict[str, set[Any]]
    ) -> None:
        block = PredefinedThresholdProbability()

        assert block.intersect(other=forecast_output)  # type: ignore[arg-type]
        output = block.validate(  # type: ignore[assignment]
            block=predefined_threshold_prob_configuration,
            inputs={"dataset": forecast_output},  # type: ignore[dict-item],
            restrictions={},
        )
        assert isinstance(output, QubedOutput)
        assert output.dataqube is not None
        assert contains(output, PARAM)
        output_axes = axes(output)
        for dim, values in expected.items():
            assert output_axes[dim] == values

    def test_intersect(self, dummy_blockinstance: BlockInstance) -> None:
        oper_output = cast(QubedOutput, OperationalForecastSource().validate(block=dummy_blockinstance, inputs={}, restrictions={}))
        block = PredefinedThresholdProbability()

        assert block.intersect(other=oper_output)  # type: ignore[arg-type]

    def test_validator_adds_parameters_restrictions(
        self, predefined_threshold_prob_configuration: BlockInstance, operational_forecast_source_output: QubedOutput
    ) -> None:
        restrictions = (
            plugin()
            .validator(
                BlockFactoryId("predefinedThresholdProbability"),
                predefined_threshold_prob_configuration.block,
                {"dataset": operational_forecast_source_output},
            )
            .restrictions
        )
        assert restrictions[PARAM].serialize() == f"enumClosed[str]('{_param_id_to_param_key('131073')}')"

    @pytest.mark.parametrize(
        "forecast_output, source_action, expected, identical_qubes",
        [
            (
                lf("operational_forecast_source_output"),
                lf("operational_forecast_source_action"),
                {PARAM: ["131073"], TYPE: ["ep"], STEP: [12], LEVTYPE: ["sfc"]},
                True,
            ),
            # (
            #     lf("anemoi_source_ensemble_output"),
            #     lf("anemoi_source_ensemble_action"),
            #     {PARAM: ["131073"], TYPE: ["ep"], STEP: [12], LEVTYPE: ["sfc"]},
            #     False,
            # ),
        ],
    )
    def test_compile(
        self,
        forecast_output: QubedOutput,
        source_action: Action,
        predefined_threshold_prob_configuration: BlockInstance,
        expected: dict[str, set[Any]],
        identical_qubes: bool,
    ) -> None:
        block = PredefinedThresholdProbability()
        output = block.validate(block=predefined_threshold_prob_configuration, inputs={"dataset": forecast_output}, restrictions={})  # type: ignore[dict-item]
        action = block.compile(
            inputs={BlockInstanceId("source_output"): source_action},
            block=predefined_threshold_prob_configuration,
        ).get_or_raise()
        requests = nodetree.datacubes(action.nodes)
        assert len(requests) == 1
        assert "class" in requests[0]
        for dim, value in expected.items():
            assert requests[0][dim] == value
        if identical_qubes:
            assert list(datacubes(output)) == requests

    def test_expansion(self, threshold_probability_output: QubedOutput) -> None:
        for expansion in plugin().expander(threshold_probability_output):
            assert expansion.factory not in PRODUCT_BLOCKS


class TestCustomThresholdProb:
    def test_catalogue_value_type_is_canonical(self) -> None:
        assert CustomThresholdProbability.configuration_options[COMPARISON].value_type.serialize() == "enumClosed[str]('>=','<=','>','<')"

    @pytest.mark.parametrize(
        "forecast_output",
        [
            lf("operational_forecast_source_output"),
            # lf("anemoi_source_ensemble_output"),
        ],
    )
    def test_from_forecast_source(self, forecast_output: QubedOutput, custom_threshold_prob_configuration: BlockInstance) -> None:
        block = CustomThresholdProbability()

        assert block.intersect(other=forecast_output)  # type: ignore[arg-type]
        output = block.validate(  # type: ignore[assignment]
            block=custom_threshold_prob_configuration,
            inputs={"dataset": forecast_output},  # type: ignore[dict-item],
            restrictions={},
        )
        assert isinstance(output, QubedOutput)
        assert output.dataqube is not None
        assert contains(output, PARAM)
        output_axes = axes(output)
        assert len(output_axes[PARAM]) == 3
        assert output_axes[TYPE] == {"ep"}
        assert len(output_axes[STEP]) > 0

    @pytest.mark.parametrize(
        "forecast_output, source_action, expected_params, identical_qubes",
        [
            (
                lf("operational_forecast_source_output"),
                lf("operational_forecast_source_action"),
                {"167", "151", "131"},
                True,
            ),
            # (
            #     lf("anemoi_source_ensemble_output"),
            #     lf("anemoi_source_ensemble_action"),
            #     {"2t", "msl"},
            #     False,
            # )
        ],
    )
    def test_compile(
        self,
        forecast_output: QubedOutput,
        source_action: Action,
        custom_threshold_prob_configuration: BlockInstance,
        expected_params: set[str],
        identical_qubes: bool,
    ) -> None:
        block = CustomThresholdProbability()
        output = block.validate(block=custom_threshold_prob_configuration, inputs={"dataset": forecast_output}, restrictions={})  # type: ignore[dict-item]
        action = block.compile(
            inputs={BlockInstanceId("source_output"): source_action},
            block=custom_threshold_prob_configuration,
        ).get_or_raise()
        requests = nodetree.datacubes(action.nodes)
        assert len(requests) == 2
        for request in requests:
            assert THRESHOLD not in request
            assert COMPARISON not in request
            assert request[TYPE] == ["ep"]
            assert set.isdisjoint(set(request[PARAM]), expected_params) is False
        if identical_qubes:
            assert list(datacubes(output)) == requests

    def test_expansion(self, threshold_probability_output: QubedOutput) -> None:
        for expansion in plugin().expander(threshold_probability_output):
            assert expansion.factory not in PRODUCT_BLOCKS


class TestThermalIndices:
    @pytest.mark.parametrize(
        "forecast_output",
        [
            lf("full_operational_forecast_source_output"),
            # lf("anemoi_source_ensemble_output"),
        ],
    )
    @pytest.mark.parametrize(
        "oper_selection",
        [
            {ENSEMBLE: [0], STEP: [0, 6, 12]},
            {ENSEMBLE: [0, 1, 2], STEP: [0, 6, 12]},
        ],
        ids=["single", "ensemble"],
    )
    def test_from_forecast_source(
        self,
        forecast_output: QubedOutput,
        thermal_indices_configuration: BlockInstance,
        oper_selection: dict[str, list[int | str]],
    ) -> None:
        block = ThermalIndices()
        source_output = select(forecast_output, oper_selection)
        source_axes = axes(source_output)
        if len(oper_selection[ENSEMBLE]) == 1:
            source_output = collapse(source_output, ENSEMBLE)

        assert block.intersect(other=source_output)  # type: ignore[arg-type]
        output = block.validate(  # type: ignore[assignment]
            block=thermal_indices_configuration,
            inputs={"dataset": source_output},  # type: ignore[dict-item],
            restrictions={},
        )
        assert isinstance(output, QubedOutput)
        assert output.dataqube is not None
        output_axes = axes(output)
        assert len(output_axes.get(PARAM, [])) == 2
        assert len(output_axes.get(STEP, [])) > 0
        for cube in datacubes(output):
            cube.pop(PARAM, None)
            assert all(set(cube[dim]).issubset(source_axes[dim]) for dim in cube)
            assert select(source_output, cube).dataqube is not None
        if len(oper_selection[ENSEMBLE]) == 1:
            assert ENSEMBLE not in output_axes
        else:
            assert ENSEMBLE in output_axes
            assert output_axes[ENSEMBLE] == set(oper_selection[ENSEMBLE])

    @pytest.mark.parametrize(
        "oper_selection, expected",
        [
            [{ENSEMBLE: [0]}, 1],
            [{ENSEMBLE: [0, 1, 2]}, 2],
        ],
        ids=["single", "ensemble"],
    )
    def test_operational_forecast_source_compile(
        self,
        mock_forecast_preset: pytest.FixtureRequest,
        dummy_blockinstance: BlockInstance,
        full_operational_forecast_source_output: QubedOutput,
        thermal_indices_configuration: BlockInstance,
        oper_selection: dict[str, list[int | str]],
        expected: int,
    ) -> None:
        selection = {STEP: [0, 6, 12], ENSEMBLE: oper_selection[ENSEMBLE]}
        operational_forecast_source_output = select(full_operational_forecast_source_output, selection)
        if len(oper_selection[ENSEMBLE]) == 1:
            operational_forecast_source_output = collapse(operational_forecast_source_output, ENSEMBLE)
        operational_forecast_source_action = (
            OperationalForecastSource().compile(inputs={}, block=dummy_blockinstance).get_or_raise().select(selection, expand=True)
        )

        block = ThermalIndices()
        output = block.validate(
            block=thermal_indices_configuration, inputs={"dataset": operational_forecast_source_output}, restrictions={}
        )  # type: ignore[dict-item]

        if len(oper_selection[ENSEMBLE]) == 1:
            operational_forecast_source_action._squeeze_dimension(ENSEMBLE, drop=True)

        action = block.compile(
            inputs={BlockInstanceId("source_output"): operational_forecast_source_action},
            block=thermal_indices_configuration,
        ).get_or_raise()
        requests = nodetree.datacubes(action.nodes)
        assert len(requests) == expected
        assert all(req[PARAM] == ["260242", "261023"] for req in requests)
        assert list(datacubes(output)) == requests

    @pytest.mark.parametrize(
        "ensemble, expected",
        [
            [1, 1],
            # [[1, 2, 3], 2],
        ],
        ids=["single"],
    )
    def test_anemoi_source_compile(
        self,
        dummy_checkpoint: CompositeArtifactId,
        anemoi_source_ensemble_output: QubedOutput,
        thermal_indices_configuration: BlockInstance,
        ensemble: int,
        expected: int,
    ) -> None:
        block_instance = BlockInstance.from_block(
            BlockFactoryId("anemoiSource"),
            BlockInstanceBase(
                input_ids={},
                configuration_values={
                    CHECKPOINT: dummy_checkpoint,
                    INPUT_SOURCE: "opendata",
                    LEAD_TIME: 24,
                    BASE_TIME: datetime(2024, 1, 1),
                    ENSEMBLE: ensemble,
                },
            ),
            AnemoiSource.configuration_options,
        )
        source_action = AnemoiSource().compile(inputs={}, block=block_instance).get_or_raise()
        if ensemble == 1:
            anemoi_source_ensemble_output = coxpand(anemoi_source_ensemble_output, ENSEMBLE, {ENSEMBLE: [1]})

        block = ThermalIndices()
        output = block.validate(block=thermal_indices_configuration, inputs={"dataset": anemoi_source_ensemble_output}, restrictions={})  # type: ignore[dict-item]

        action = block.compile(
            inputs={BlockInstanceId("source_output"): source_action},
            block=thermal_indices_configuration,
        ).get_or_raise()
        requests = nodetree.datacubes(action.nodes)
        assert len(requests) == expected
        assert all(req[PARAM] == ["260242", "261023"] for req in requests)
        for index, cube in enumerate(datacubes(output)):
            assert all(cube[dim] == requests[index][dim] for dim in cube)

    @pytest.mark.parametrize(
        "param_config, expected_steps",
        [
            [[_param_id_to_param_key("260242")], [0, 6, 12]],
            [[_param_id_to_param_key("261001")], [6, 12]],
            [[_param_id_to_param_key("260242"), _param_id_to_param_key("261001")], [6, 12]],
        ],
        ids=["no-accum", "accum", "mixed"],
    )
    def test_output_steps(
        self,
        thermal_indices_configuration: BlockInstance,
        param_config: list[str],
        expected_steps: list[int],
    ) -> None:
        inputs = {
            "class": "od",
            "stream": "oper",
            "levtype": "sfc",
            "param": ["165", "166", "167", "168", "169", "175", "176", "177", "228021", "47"],
            "step": [0, 6, 12],
            "type": "fc",
            "date": "20240101",
            "time": "0000",
        }
        forecast_output = QubedOutput(dataqube=Qube.from_datacube(inputs))
        forecast_action = from_source(["fdb"], [inputs])

        config = thermal_indices_configuration.with_configuration_values({PARAM: param_config})
        block = ThermalIndices()
        output = block.validate(  # type: ignore[assignment]
            block=config,
            inputs={"dataset": forecast_output},  # type: ignore[dict-item]
            restrictions={},
        )
        assert sorted(axes(output)[STEP]) == expected_steps
        thermal_action = block.compile(
            inputs={BlockInstanceId("source_output"): forecast_action},
            block=config,
        ).get_or_raise()
        assert list(datacubes(output)) == nodetree.datacubes(thermal_action.nodes)

    @pytest.mark.parametrize(
        "outputs, expected, unexpected",
        [
            [
                {"class": "od", "stream": "oper", "type": "fc", "levtype": "sfc"},
                set(),
                set(PRODUCT_BLOCKS),
            ],
            [
                {"class": "od", "stream": "enfo", "type": "pf", "levtype": "sfc", ENSEMBLE: [0, 1, 2]},
                {
                    BlockFactoryId("ensembleStatistics"),
                    BlockFactoryId("customThresholdProbability"),
                },
                {
                    BlockFactoryId("predefinedThresholdProbability"),
                    BlockFactoryId("thermalIndices"),
                },
            ],
        ],
        ids=["single", "ensemble"],
    )
    def test_expansion(self, outputs: dict, expected: set[BlockFactoryId], unexpected: set[BlockFactoryId]) -> None:
        thermal_indices_output = QubedOutput(dataqube=Qube.from_datacube({PARAM: ["260242", "261001"], STEP: [6, 12], **outputs}))
        expansion_factories = [expansion.factory for expansion in plugin().expander(thermal_indices_output)]
        for expect in expected:
            assert expect in expansion_factories
        assert set(expansion_factories).intersection(unexpected) == set()

    def test_validator_adds_parameters_restrictions(
        self,
        full_operational_forecast_source_output: QubedOutput,
        thermal_indices_configuration: BlockInstance,
    ) -> None:
        selection = {STEP: [0, 6, 12], ENSEMBLE: [0, 1, 2, 4, 5]}
        operational_forecast_source_output = select(full_operational_forecast_source_output, selection)
        restrictions = (
            plugin()
            .validator(
                BlockFactoryId("thermalIndices"), thermal_indices_configuration.block, {"dataset": operational_forecast_source_output}
            )
            .restrictions
        )
        for param in ["260004", "260242", "261016", "260005", "260255", "261018", "261023"]:
            assert _param_id_to_param_key(param) in restrictions[PARAM].serialize()
        assert _param_id_to_param_key("261001") not in restrictions[PARAM].serialize()


class TestWindSpeed:
    @pytest.mark.parametrize(
        "forecast_output",
        [
            lf("full_operational_forecast_source_output"),
            # lf("anemoi_source_ensemble_output"),
        ],
    )
    @pytest.mark.parametrize(
        "oper_selection",
        [
            {ENSEMBLE: [0], STEP: [0, 6, 12]},
            {ENSEMBLE: [0, 1, 2], STEP: [0, 6, 12]},
        ],
        ids=["single", "ensemble"],
    )
    def test_from_forecast_source(
        self,
        forecast_output: QubedOutput,
        wind_speed_configuration: BlockInstance,
        oper_selection: dict[str, list[int | str]],
    ) -> None:
        block = WindSpeed()
        source_output = select(forecast_output, oper_selection)
        source_axes = axes(source_output)
        if len(oper_selection[ENSEMBLE]) == 1:
            source_output = collapse(source_output, ENSEMBLE)

        assert block.intersect(other=source_output)  # type: ignore[arg-type]
        output = block.validate(  # type: ignore[assignment]
            block=wind_speed_configuration,
            inputs={"dataset": source_output},  # type: ignore[dict-item],
            restrictions={},
        )
        assert isinstance(output, QubedOutput)
        assert output.dataqube is not None
        output_axes = axes(output)
        assert len(output_axes.get(PARAM, [])) == 2
        assert len(output_axes.get(STEP, [])) > 0
        for cube in datacubes(output):
            cube.pop(PARAM, None)
            assert all(set(cube[dim]).issubset(source_axes[dim]) for dim in cube)
            assert select(source_output, cube).dataqube is not None
        if len(oper_selection[ENSEMBLE]) == 1:
            assert ENSEMBLE not in output_axes
        else:
            assert ENSEMBLE in output_axes
            assert output_axes[ENSEMBLE] == set(oper_selection[ENSEMBLE])

    @pytest.mark.parametrize(
        "oper_selection, expected",
        [
            [{ENSEMBLE: [0]}, 1],
            [{ENSEMBLE: [0, 1, 2]}, 2],
        ],
        ids=["single", "ensemble"],
    )
    def test_operational_forecast_source_compile(
        self,
        mock_forecast_preset: pytest.FixtureRequest,
        dummy_blockinstance: BlockInstance,
        full_operational_forecast_source_output: QubedOutput,
        wind_speed_configuration: BlockInstance,
        oper_selection: dict[str, list[int | str]],
        expected: int,
    ) -> None:
        selection = {STEP: [0, 6, 12], ENSEMBLE: oper_selection[ENSEMBLE]}
        operational_forecast_source_output = select(full_operational_forecast_source_output, selection)
        if len(oper_selection[ENSEMBLE]) == 1:
            operational_forecast_source_output = collapse(operational_forecast_source_output, ENSEMBLE)
        operational_forecast_source_action = (
            OperationalForecastSource().compile(inputs={}, block=dummy_blockinstance).get_or_raise().select(selection, expand=True)
        )

        block = WindSpeed()
        output = block.validate(block=wind_speed_configuration, inputs={"dataset": operational_forecast_source_output}, restrictions={})  # type: ignore[dict-item]

        if len(oper_selection[ENSEMBLE]) == 1:
            operational_forecast_source_action._squeeze_dimension(ENSEMBLE, drop=True)

        action = block.compile(
            inputs={BlockInstanceId("source_output"): operational_forecast_source_action},
            block=wind_speed_configuration,
        ).get_or_raise()
        requests = nodetree.datacubes(action.nodes)
        assert len(requests) == expected
        assert all(req[PARAM] == ["207", "228249"] for req in requests)
        assert list(datacubes(output)) == requests

    @pytest.mark.parametrize(
        "ensemble, expected",
        [
            [1, 1],
            # [[1, 2, 3], 2],
        ],
        ids=["single"],
    )
    def test_anemoi_source_compile(
        self,
        dummy_checkpoint: CompositeArtifactId,
        anemoi_source_ensemble_output: QubedOutput,
        wind_speed_configuration: BlockInstance,
        ensemble: int,
        expected: int,
    ) -> None:
        block_instance = BlockInstance.from_block(
            BlockFactoryId("anemoiSource"),
            BlockInstanceBase(
                input_ids={},
                configuration_values={
                    CHECKPOINT: dummy_checkpoint,
                    INPUT_SOURCE: "opendata",
                    LEAD_TIME: 24,
                    BASE_TIME: datetime(2024, 1, 1),
                    ENSEMBLE: ensemble,
                },
            ),
            AnemoiSource.configuration_options,
        )
        source_action = AnemoiSource().compile(inputs={}, block=block_instance).get_or_raise()
        if ensemble == 1:
            anemoi_source_ensemble_output = coxpand(anemoi_source_ensemble_output, ENSEMBLE, {ENSEMBLE: [1]})

        block = WindSpeed()
        output = block.validate(block=wind_speed_configuration, inputs={"dataset": anemoi_source_ensemble_output}, restrictions={})  # type: ignore[dict-item]

        action = block.compile(
            inputs={BlockInstanceId("source_output"): source_action},
            block=wind_speed_configuration,
        ).get_or_raise()
        requests = nodetree.datacubes(action.nodes)
        assert len(requests) == expected
        assert all(req[PARAM] == ["207", "228249"] for req in requests)
        for index, cube in enumerate(datacubes(output)):
            assert all(cube[dim] == requests[index][dim] for dim in cube)


class TestQuantiles:
    @pytest.mark.parametrize(
        "forecast_output, expected_params",
        [
            (lf("operational_forecast_source_output"), {"167", "151", "131"}),
            # (lf("anemoi_source_ensemble_output"), {"167", "151"}),
        ],
    )
    def test_from_forecast_source(
        self, quantiles_configuration: BlockInstance, forecast_output: QubedOutput, expected_params: set[str]
    ) -> None:
        block = Quantiles()

        assert block.intersect(other=forecast_output)  # type: ignore[arg-type]
        output = block.validate(  # type: ignore[assignment]
            block=quantiles_configuration,
            inputs={"dataset": forecast_output},  # type: ignore[dict-item],
            restrictions={},
        )
        assert isinstance(output, QubedOutput)
        assert output.dataqube is not None
        assert contains(output, PARAM)
        assert axes(output)[PARAM] == expected_params
        assert axes(output)[TYPE] == {"pb"}
        assert axes(output)[QUANTILE] == {f"{q}:4" for q in range(5)}

    @pytest.mark.parametrize(
        "forecast_output, source_action, expected, identical_qubes",
        [
            (
                lf("operational_forecast_source_output"),
                lf("operational_forecast_source_action"),
                {PARAM: {"167", "151", "131"}, TYPE: {"pb"}, STEP: {0, 6, 12}},
                True,
            ),
            # (
            #     lf("anemoi_source_ensemble_output"),
            #     lf("anemoi_source_ensemble_action"),
            #     {PARAM: {"2t", "msl"}, TYPE: {"em"}, STEP: set(range(1, 25))},
            #     False,
            # ),
        ],
    )
    def test_compile(
        self,
        quantiles_configuration: BlockInstance,
        forecast_output: QubedOutput,
        source_action: Action,
        expected: dict[str, set[Any]],
        identical_qubes: bool,
    ) -> None:
        block = Quantiles()
        output = block.validate(block=quantiles_configuration, inputs={"dataset": forecast_output}, restrictions={})  # type: ignore[dict-item]
        action = block.compile(
            inputs={BlockInstanceId("source_output"): source_action},
            block=quantiles_configuration,
        ).get_or_raise()
        requests = nodetree.datacubes(action.nodes)
        assert len(requests) == 2
        for dim, values in expected.items():
            assert set.union(*[set(req[dim]) for req in requests]) == values
        if identical_qubes:
            assert list(datacubes(output)) == requests

    def test_expansion(self, ensemble_statistics_output: QubedOutput) -> None:
        for expansion in plugin().expander(ensemble_statistics_output):
            assert expansion.factory not in PRODUCT_BLOCKS
