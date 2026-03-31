# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.


from typing import cast

import pytest
from fiab_core.fable import BlockInstance, PluginBlockFactoryId, PluginCompositeId

from fiab_plugin_ecmwf.blocks import EkdSource, EnsembleStatistics, TemporalStatistics, ZarrSink
from fiab_plugin_ecmwf.metadata import PluginNoOutput, QubedInstanceOutput


@pytest.fixture
def dummy_blockinstance() -> BlockInstance:
    return BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory="dummy"),  # type: ignore
        input_ids={},
        configuration_values={},
    )


@pytest.fixture
def dummy_blockinstance_output() -> QubedInstanceOutput:
    return QubedInstanceOutput()


@pytest.fixture
def ekdsource_configuration() -> BlockInstance:
    return BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory="EkdSource"),  # type: ignore
        input_ids={},
        configuration_values={
            "source": "ecmwf-open-data",
            "date": "2024-01-01",
            "expver": "1",
        },
    )


@pytest.fixture
def ekdsource_output(dummy_blockinstance: BlockInstance) -> QubedInstanceOutput:
    return EkdSource().validate(block=dummy_blockinstance, inputs={}).get_or_raise()  # type: ignore[return-value]


@pytest.fixture
def ensemble_statistics_configuration() -> BlockInstance:
    return BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory="EnsembleStatistics"),  # type: ignore
        input_ids={"dataset": "source_output"},
        configuration_values={
            "param": "2t",
            "statistic": "mean",
        },
    )


@pytest.fixture
def temporal_statistics_configuration() -> BlockInstance:
    return BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory="TemporalStatistics"),  # type: ignore
        input_ids={"dataset": "source_output"},
        configuration_values={
            "param": "2t",
            "statistic": "mean",
        },
    )


@pytest.fixture
def zarr_sink_configuration() -> BlockInstance:
    return BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory="ZarrSink"),  # type: ignore
        input_ids={"dataset": "source_output"},
        configuration_values={
            "path": "/path/to/output.zarr",
        },
    )


class TestEkdSource:
    def test_creation(self, dummy_blockinstance: BlockInstance, dummy_blockinstance_output: QubedInstanceOutput):
        block = EkdSource()

        assert not block.intersect(input=dummy_blockinstance_output)  # type: ignore[arg-type]
        output: QubedInstanceOutput | PluginNoOutput = block.validate(block=dummy_blockinstance, inputs={}).get_or_raise()  # type: ignore[assignment]
        assert output.dataqube is not None
        assert "param" in output


class TestEnsembleStatistics:
    def test_from_ekdsource(self, ensemble_statistics_configuration: BlockInstance, ekdsource_output: QubedInstanceOutput):
        block = EnsembleStatistics()

        assert block.intersect(input=ekdsource_output)  # type: ignore[arg-type]
        output: QubedInstanceOutput | PluginNoOutput = block.validate(  # type: ignore[assignment]
            block=ensemble_statistics_configuration,
            inputs={"dataset": ekdsource_output},  # type: ignore[dict-item]
        ).get_or_raise()
        assert output.dataqube is not None
        assert "param" in output
        assert output.axes()["param"] == {"2t"}

    def test_from_temporal_statistics(
        self,
        ensemble_statistics_configuration: BlockInstance,
        temporal_statistics_configuration: BlockInstance,
        ekdsource_output: QubedInstanceOutput,
    ):
        temporal_block = TemporalStatistics()
        temporal_output: QubedInstanceOutput | PluginNoOutput = temporal_block.validate(  # type: ignore[assignment]
            block=temporal_statistics_configuration,
            inputs={"dataset": ekdsource_output},  # type: ignore[dict-item]
        ).get_or_raise()

        block = EnsembleStatistics()

        assert block.intersect(input=temporal_output)  # type: ignore[arg-type]
        output: QubedInstanceOutput | PluginNoOutput = block.validate(  # type: ignore[assignment]
            block=ensemble_statistics_configuration,
            inputs={"dataset": temporal_output},  # type: ignore[dict-item]
        ).get_or_raise()
        assert output.dataqube is not None
        assert "param" in output
        assert output.axes()["param"] == {"2t"}

    def test_missing_param(self, ensemble_statistics_configuration: BlockInstance, ekdsource_output: QubedInstanceOutput):
        block = EnsembleStatistics()

        modified_output = ekdsource_output.collapse("param")

        assert not block.intersect(input=modified_output)  # type: ignore[arg-type]
        result = block.validate(block=ensemble_statistics_configuration, inputs={"dataset": modified_output})  # type: ignore[dict-item]
        with pytest.raises(ValueError, match="param 2t is not in the input parameters"):
            assert result.get_or_raise()


class TestTemporalStatistics:
    def test_from_ekdsource(self, temporal_statistics_configuration: BlockInstance, ekdsource_output: QubedInstanceOutput):
        block = TemporalStatistics()

        assert block.intersect(input=ekdsource_output)  # type: ignore[arg-type]
        output: QubedInstanceOutput | PluginNoOutput = block.validate(  # type: ignore[assignment]
            block=temporal_statistics_configuration,
            inputs={"dataset": ekdsource_output},  # type: ignore[dict-item]
        ).get_or_raise()
        assert output.dataqube is not None
        assert "param" in output
        assert output.axes()["param"] == {"2t"}

    def test_from_ensemble_statistics(
        self,
        temporal_statistics_configuration: BlockInstance,
        ensemble_statistics_configuration: BlockInstance,
        ekdsource_output: QubedInstanceOutput,
    ):
        ensemble_block = EnsembleStatistics()
        ensemble_output: QubedInstanceOutput | PluginNoOutput = ensemble_block.validate(  # type: ignore[assignment]
            block=ensemble_statistics_configuration,
            inputs={"dataset": ekdsource_output},  # type: ignore[dict-item]
        ).get_or_raise()

        block = TemporalStatistics()

        assert block.intersect(input=ensemble_output)  # type: ignore[arg-type]
        output: QubedInstanceOutput | PluginNoOutput = block.validate(  # type: ignore[assignment]
            block=temporal_statistics_configuration,
            inputs={"dataset": ensemble_output},  # type: ignore[dict-item]
        ).get_or_raise()
        assert output.dataqube is not None
        assert "param" in output
        assert output.axes()["param"] == {"2t"}

    def test_missing_param(self, temporal_statistics_configuration: BlockInstance, ekdsource_output: QubedInstanceOutput):
        block = TemporalStatistics()

        modified_output = ekdsource_output.collapse("param")

        assert not block.intersect(input=modified_output)  # type: ignore[arg-type]
        result = block.validate(block=temporal_statistics_configuration, inputs={"dataset": modified_output})  # type: ignore[dict-item]
        with pytest.raises(ValueError, match="param 2t is not in the input parameters"):
            assert result.get_or_raise()


class TestZarrSink:
    def test_from_ekdsource(self, zarr_sink_configuration: BlockInstance, ekdsource_output: QubedInstanceOutput):
        block = ZarrSink()

        assert block.intersect(input=ekdsource_output)  # type: ignore[arg-type]
        output: QubedInstanceOutput | PluginNoOutput = block.validate(  # type: ignore[assignment]
            block=zarr_sink_configuration,
            inputs={"dataset": ekdsource_output},  # type: ignore[dict-item]
        ).get_or_raise()
        assert output.is_empty()

    def test_from_ensemble_statistics(
        self,
        zarr_sink_configuration: BlockInstance,
        ensemble_statistics_configuration: BlockInstance,
        ekdsource_output: QubedInstanceOutput,
    ):
        ensemble_block = EnsembleStatistics()
        ensemble_output: QubedInstanceOutput | PluginNoOutput = ensemble_block.validate(  # type: ignore[assignment]
            block=ensemble_statistics_configuration,
            inputs={"dataset": ekdsource_output},  # type: ignore[dict-item]
        ).get_or_raise()

        block = ZarrSink()

        assert block.intersect(input=ensemble_output)  # type: ignore[arg-type]
        output: QubedInstanceOutput | PluginNoOutput = block.validate(  # type: ignore[assignment]
            block=zarr_sink_configuration,
            inputs={"dataset": ensemble_output},  # type: ignore[dict-item]
        ).get_or_raise()
        assert output.is_empty()

    def test_from_temporal_statistics(
        self,
        zarr_sink_configuration: BlockInstance,
        temporal_statistics_configuration: BlockInstance,
        ekdsource_output: QubedInstanceOutput,
    ):
        temporal_block = TemporalStatistics()
        temporal_output: QubedInstanceOutput | PluginNoOutput = temporal_block.validate(  # type: ignore[assignment]
            block=temporal_statistics_configuration,
            inputs={"dataset": ekdsource_output},  # type: ignore[dict-item]
        ).get_or_raise()

        block = ZarrSink()

        assert block.intersect(input=temporal_output)  # type: ignore[arg-type]
        output: QubedInstanceOutput | PluginNoOutput = block.validate(  # type: ignore[assignment]
            block=zarr_sink_configuration,
            inputs={"dataset": temporal_output},  # type: ignore[dict-item]
        ).get_or_raise()
        assert output.is_empty()
