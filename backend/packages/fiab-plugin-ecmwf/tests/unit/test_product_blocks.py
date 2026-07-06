# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.


import pytest
from earthkit.workflows.fluent import Action
from earthkit.workflows.nodetree import datacubes
from fiab_core.fable import (
    BlockInstanceId,
    ConfigurationOptionId,
    PluginBlockFactoryId,
    PluginCompositeId,
    QubedOutput,
)
from fiab_core.fable import (
    BlockInstance as BlockInstanceBase,
)
from fiab_core.tools.blocks import BlockInstanceRich as BlockInstance

from fiab_plugin_ecmwf.block_utils import (
    PARAM,
    STEP,
    TYPE,
    THRESHOLD,
    COMPARISON,
    _create_param_key,
)
from fiab_plugin_ecmwf.qubed_utils import axes, contains
from fiab_plugin_ecmwf.products.blocks import (
    EnsembleStatistics,
    PrescribedThresholdProbability,
    CustomThresholdProbability,
)

@pytest.fixture
def prescribed_threshold_prob_configuration() -> BlockInstance:
    return BlockInstance.from_block(
        BlockInstanceBase(
            factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory="PrescribedThresholdProbability"),  # type: ignore
            input_ids={"dataset": BlockInstanceId("source_output")},
            configuration_values={
                PARAM: _create_param_key("131073"),
                STEP: ["12"],
            },
        ),
        PrescribedThresholdProbability.configuration_options,
    )


@pytest.fixture
def custom_threshold_prob_configuration() -> BlockInstance:
    return BlockInstance.from_block(
        BlockInstanceBase(
            factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory="CustomThresholdProbability"),  # type: ignore
            input_ids={"dataset": BlockInstanceId("source_output")},
            configuration_values={
                THRESHOLD: 0.5,
                COMPARISON: ">=",
            },
        ),
        CustomThresholdProbability.configuration_options,
    )


class TestEnsembleStatistics:
    def test_catalogue_value_type_is_canonical(self) -> None:
        assert EnsembleStatistics.configuration_options[ConfigurationOptionId("statistic")].value_type == "list[enumClosed['mean', 'std']]"

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
        block.validate(block=ensemble_statistics_configuration, inputs={"dataset": operational_forecast_source_output}, restrictions={})  # type: ignore[dict-item]
        action = block.compile(
            inputs={BlockInstanceId("source_output"): operational_forecast_source_action},
            block=ensemble_statistics_configuration,
        ).get_or_raise()
        requests = datacubes(action.nodes) 
        assert len(requests) == 2
        expected = [{PARAM: ["131"], TYPE: ["em"], STEP: ["0", "6", "12"]}, {PARAM: ["167", "151"], TYPE: ["em"], STEP: ["0", "6", "12"]}]
        for index, request in enumerate(requests):
            for dim, value in expected[index].items():
                assert request[dim] == sorted(value)


class TestPrescribedThresholdProb:
    def test_from_operational_forecast_source(
        self, prescribed_threshold_prob_configuration: BlockInstance, operational_forecast_source_output: QubedOutput
    ) -> None:
        block = PrescribedThresholdProbability()

        assert block.intersect(other=operational_forecast_source_output)  # type: ignore[arg-type]
        output = block.validate(  # type: ignore[assignment]
            block=prescribed_threshold_prob_configuration,
            inputs={"dataset": operational_forecast_source_output},  # type: ignore[dict-item],
            restrictions={},
        )
        assert isinstance(output, QubedOutput)
        assert output.dataqube is not None
        assert contains(output, PARAM)
        output_axes = axes(output)
        assert output_axes[PARAM] == {"131073"}
        assert output_axes[TYPE] == {"ep"}
        assert len(output_axes[STEP]) > 0

    def test_compile(
        self,
        operational_forecast_source_output: QubedOutput,
        operational_forecast_source_action: Action,
        prescribed_threshold_prob_configuration: BlockInstance,
    ) -> None:
        block = PrescribedThresholdProbability()
        block.validate(
            block=prescribed_threshold_prob_configuration, inputs={"dataset": operational_forecast_source_output}, restrictions={}
        )  # type: ignore[dict-item]
        action = block.compile(
            inputs={BlockInstanceId("source_output"): operational_forecast_source_action},
            block=prescribed_threshold_prob_configuration,
        ).get_or_raise()
        requests = datacubes(action.nodes) 
        assert len(requests) == 1
        assert "class" in requests[0]
        for dim, value in {PARAM: ["131073"], TYPE: ["ep"], STEP: ["12"]}.items():
            assert requests[0][dim] == value

class TestCustomThresholdProb:
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
        block.validate(
            block=custom_threshold_prob_configuration, inputs={"dataset": operational_forecast_source_output}, restrictions={}
        )  # type: ignore[dict-item]
        action = block.compile(
            inputs={BlockInstanceId("source_output"): operational_forecast_source_action},
            block=custom_threshold_prob_configuration,
        ).get_or_raise()
        requests = datacubes(action.nodes) 
        assert len(requests) == 2
        for request in requests:
            assert THRESHOLD not in request
            assert COMPARISON not in request
            assert request[TYPE] == ["ep"]
            assert set.isdisjoint(set(request[PARAM]), {"131", "151", "167"}) is False
