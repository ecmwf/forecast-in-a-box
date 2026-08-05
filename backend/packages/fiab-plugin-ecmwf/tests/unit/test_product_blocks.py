# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.


from typing import cast

import numpy as np
import pytest
from earthkit.workflows import nodetree
from earthkit.workflows.fluent import Action, merge
from earthkit.workflows.plugins.pproc.fluent import from_source
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
from qubed import Qube

from fiab_plugin_ecmwf import plugin
from fiab_plugin_ecmwf.block_utils import (
    COMPARISON,
    ENSEMBLE,
    LEVTYPE,
    PARAM,
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
    ThermalIndices,
)
from fiab_plugin_ecmwf.qubed_utils import axes, collapse, contains, datacubes, select

PRODUCT_BLOCKS = [
    BlockFactoryId("ensembleStatistics"),
    BlockFactoryId("predefinedThresholdProbability"),
    BlockFactoryId("customThresholdProbability"),
    BlockFactoryId("thermalIndices"),
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
                STEP: ["12"],
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
                STEP: ["0", "6", "12"],
            },
        ),
        ThermalIndices.configuration_options,
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

    def test_from_operational_forecast_source(
        self, ensemble_statistics_configuration: BlockInstance, operational_forecast_source_output: QubedOutput
    ) -> None:
        block = EnsembleStatistics()

        assert block.intersect(other=operational_forecast_source_output)  # type: ignore[arg-type]
        output = block.validate(  # type: ignore[assignment]
            block=ensemble_statistics_configuration,
            inputs={"dataset": operational_forecast_source_output},  # type: ignore[dict-item],
            restrictions={},
        )
        assert isinstance(output, QubedOutput)
        assert output.dataqube is not None
        assert contains(output, PARAM)
        assert axes(output)[PARAM] == {"167", "151", "131"}
        assert axes(output)[TYPE] == {"em"}

    def test_compile(
        self,
        operational_forecast_source_output: QubedOutput,
        operational_forecast_source_action: Action,
        ensemble_statistics_configuration: BlockInstance,
    ) -> None:
        block = EnsembleStatistics()
        output = block.validate(
            block=ensemble_statistics_configuration, inputs={"dataset": operational_forecast_source_output}, restrictions={}
        )  # type: ignore[dict-item]
        action = block.compile(
            inputs={BlockInstanceId("source_output"): operational_forecast_source_action},
            block=ensemble_statistics_configuration,
        ).get_or_raise()
        requests = nodetree.datacubes(action.nodes)
        assert len(requests) == 2
        assert set.union(*[set(req[PARAM]) for req in requests]) == {"167", "151", "131"}
        assert set.union(*[set(req[TYPE]) for req in requests]) == {"em"}
        assert set.union(*[set(req[STEP]) for req in requests]) == {0, 6, 12}
        assert list(datacubes(output)) == requests

    def test_expansion(self, ensemble_statistics_output: QubedOutput) -> None:
        for expansion in plugin().expander(ensemble_statistics_output):
            assert expansion.factory not in PRODUCT_BLOCKS


class TestPredefinedThresholdProb:
    def test_from_operational_forecast_source(
        self, predefined_threshold_prob_configuration: BlockInstance, operational_forecast_source_output: QubedOutput
    ) -> None:
        block = PredefinedThresholdProbability()

        assert block.intersect(other=operational_forecast_source_output)  # type: ignore[arg-type]
        output = block.validate(  # type: ignore[assignment]
            block=predefined_threshold_prob_configuration,
            inputs={"dataset": operational_forecast_source_output},  # type: ignore[dict-item],
            restrictions={},
        )
        assert isinstance(output, QubedOutput)
        assert output.dataqube is not None
        assert contains(output, PARAM)
        output_axes = axes(output)
        assert output_axes[PARAM] == {"131073"}
        assert output_axes[TYPE] == {"ep"}
        assert output_axes[STEP] == {12}
        assert output_axes[LEVTYPE] == {"sfc"}

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

    def test_validator_adds_step_restrictions(
        self, predefined_threshold_prob_configuration: BlockInstance, operational_forecast_source_output: QubedOutput
    ) -> None:
        config = predefined_threshold_prob_configuration.with_configuration_values({PARAM: _param_id_to_param_key("131073")})
        restrictions = (
            plugin()
            .validator(BlockFactoryId("predefinedThresholdProbability"), config.block, {"dataset": operational_forecast_source_output})
            .restrictions
        )
        assert restrictions[STEP].serialize() == "list[enumClosed[str]('12')]"

    def test_compile(
        self,
        operational_forecast_source_output: QubedOutput,
        operational_forecast_source_action: Action,
        predefined_threshold_prob_configuration: BlockInstance,
    ) -> None:
        block = PredefinedThresholdProbability()
        output = block.validate(
            block=predefined_threshold_prob_configuration, inputs={"dataset": operational_forecast_source_output}, restrictions={}
        )  # type: ignore[dict-item]
        action = block.compile(
            inputs={BlockInstanceId("source_output"): operational_forecast_source_action},
            block=predefined_threshold_prob_configuration,
        ).get_or_raise()
        requests = nodetree.datacubes(action.nodes)
        assert len(requests) == 1
        assert "class" in requests[0]
        for dim, value in {PARAM: ["131073"], TYPE: ["ep"], STEP: [12]}.items():
            assert requests[0][dim] == value
        assert list(datacubes(output)) == requests

    def test_expansion(self, threshold_probability_output: QubedOutput) -> None:
        for expansion in plugin().expander(threshold_probability_output):
            assert expansion.factory not in PRODUCT_BLOCKS


class TestCustomThresholdProb:
    def test_catalogue_value_type_is_canonical(self) -> None:
        assert CustomThresholdProbability.configuration_options[COMPARISON].value_type.serialize() == "enumClosed[str]('>=','<=','>','<')"

    def test_from_operational_forecast_source(
        self, custom_threshold_prob_configuration: BlockInstance, operational_forecast_source_output: QubedOutput
    ) -> None:
        block = CustomThresholdProbability()

        assert block.intersect(other=operational_forecast_source_output)  # type: ignore[arg-type]
        output = block.validate(  # type: ignore[assignment]
            block=custom_threshold_prob_configuration,
            inputs={"dataset": operational_forecast_source_output},  # type: ignore[dict-item],
            restrictions={},
        )
        assert isinstance(output, QubedOutput)
        assert output.dataqube is not None
        assert contains(output, PARAM)
        output_axes = axes(output)
        assert len(output_axes[PARAM]) == 3
        assert output_axes[TYPE] == {"ep"}
        assert len(output_axes[STEP]) > 0

    def test_compile(
        self,
        operational_forecast_source_output: QubedOutput,
        operational_forecast_source_action: Action,
        custom_threshold_prob_configuration: BlockInstance,
    ) -> None:
        block = CustomThresholdProbability()
        output = block.validate(
            block=custom_threshold_prob_configuration, inputs={"dataset": operational_forecast_source_output}, restrictions={}
        )  # type: ignore[dict-item]
        action = block.compile(
            inputs={BlockInstanceId("source_output"): operational_forecast_source_action},
            block=custom_threshold_prob_configuration,
        ).get_or_raise()
        requests = nodetree.datacubes(action.nodes)
        assert len(requests) == 2
        for request in requests:
            assert THRESHOLD not in request
            assert COMPARISON not in request
            assert request[TYPE] == ["ep"]
            assert set.isdisjoint(set(request[PARAM]), {"131", "151", "167"}) is False
        assert list(datacubes(output)) == requests

    def test_expansion(self, threshold_probability_output: QubedOutput) -> None:
        for expansion in plugin().expander(threshold_probability_output):
            assert expansion.factory not in PRODUCT_BLOCKS


class TestThermalIndices:
    @pytest.mark.parametrize(
        "oper_selection",
        [
            {ENSEMBLE: [0], STEP: [0, 6, 12]},
            {ENSEMBLE: [0, 1, 2], STEP: [0, 6, 12]},
        ],
        ids=["single", "ensemble"],
    )
    def test_from_operational_forecast_source(
        self,
        full_operational_forecast_source_output: QubedOutput,
        thermal_indices_configuration: BlockInstance,
        oper_selection: dict[str, list[int | str]],
    ) -> None:
        block = ThermalIndices()
        source_output = select(full_operational_forecast_source_output, oper_selection)
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
    def test_compile(
        self,
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
