# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.


import pytest
from fiab_core.fable import BlockInstance, BlockInstanceOutput, PluginBlockFactoryId, PluginCompositeId

from fiab_plugin_ecmwf.blocks import EkdSource, EnsembleStatistics, TemporalStatistics, ZarrSink


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
def ekdsource_output() -> BlockInstanceOutput:
    return EkdSource().validate(block=None, inputs={}).get_or_raise()


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
    def test_creation(self):
        block = EkdSource()

        assert not block.intersect(input=None)
        output: BlockInstanceOutput = block.validate(block=None, inputs={}).get_or_raise()
        assert output.dataqube is not None
        assert "param" in output


class TestEnsembleStatistics:
    def test_from_ekdsource(self, ensemble_statistics_configuration: BlockInstance, ekdsource_output: BlockInstanceOutput):
        block = EnsembleStatistics()

        assert block.intersect(input=ekdsource_output)
        output: BlockInstanceOutput = block.validate(
            block=ensemble_statistics_configuration, inputs={"dataset": ekdsource_output}
        ).get_or_raise()
        assert output.dataqube is not None
        assert "param" in output
        assert output.axes()["param"] == {"2t"}

    def test_from_temporal_statistics(
        self,
        ensemble_statistics_configuration: BlockInstance,
        temporal_statistics_configuration: BlockInstance,
        ekdsource_output: BlockInstanceOutput,
    ):
        temporal_block = TemporalStatistics()
        temporal_output: BlockInstanceOutput = temporal_block.validate(
            block=temporal_statistics_configuration, inputs={"dataset": ekdsource_output}
        ).get_or_raise()

        block = EnsembleStatistics()

        assert block.intersect(input=temporal_output)
        output: BlockInstanceOutput = block.validate(
            block=ensemble_statistics_configuration, inputs={"dataset": temporal_output}
        ).get_or_raise()
        assert output.dataqube is not None
        assert "param" in output
        assert output.axes()["param"] == {"2t"}

    def test_missing_param(self, ensemble_statistics_configuration: BlockInstance, ekdsource_output: BlockInstanceOutput):
        block = EnsembleStatistics()

        modified_output = ekdsource_output.collapse("param")

        assert not block.intersect(input=modified_output)
        result = block.validate(block=ensemble_statistics_configuration, inputs={"dataset": modified_output})
        with pytest.raises(ValueError, match="param 2t is not in the input variables"):
            assert result.get_or_raise()


class TestTemporalStatistics:
    def test_from_ekdsource(self, temporal_statistics_configuration: BlockInstance, ekdsource_output: BlockInstanceOutput):
        block = TemporalStatistics()

        assert block.intersect(input=ekdsource_output)
        output: BlockInstanceOutput = block.validate(
            block=temporal_statistics_configuration, inputs={"dataset": ekdsource_output}
        ).get_or_raise()
        assert output.dataqube is not None
        assert "param" in output
        assert output.axes()["param"] == {"2t"}

    def test_from_ensemble_statistics(
        self,
        temporal_statistics_configuration: BlockInstance,
        ensemble_statistics_configuration: BlockInstance,
        ekdsource_output: BlockInstanceOutput,
    ):
        ensemble_block = EnsembleStatistics()
        ensemble_output: BlockInstanceOutput = ensemble_block.validate(
            block=ensemble_statistics_configuration, inputs={"dataset": ekdsource_output}
        ).get_or_raise()

        block = TemporalStatistics()

        assert block.intersect(input=ensemble_output)
        output: BlockInstanceOutput = block.validate(
            block=temporal_statistics_configuration, inputs={"dataset": ensemble_output}
        ).get_or_raise()
        assert output.dataqube is not None
        assert "param" in output
        assert output.axes()["param"] == {"2t"}

    def test_missing_param(self, temporal_statistics_configuration: BlockInstance, ekdsource_output: BlockInstanceOutput):
        block = TemporalStatistics()

        modified_output = ekdsource_output.collapse("param")

        assert not block.intersect(input=modified_output)
        result = block.validate(block=temporal_statistics_configuration, inputs={"dataset": modified_output})
        with pytest.raises(ValueError, match="param 2t is not in the input variables"):
            assert result.get_or_raise()


class TestZarrSink:
    def test_from_ekdsource(self, zarr_sink_configuration: BlockInstance, ekdsource_output: BlockInstanceOutput):
        block = ZarrSink()

        assert block.intersect(input=ekdsource_output)
        output: BlockInstanceOutput = block.validate(block=zarr_sink_configuration, inputs={"dataset": ekdsource_output}).get_or_raise()
        assert output.is_empty()

    def test_from_ensemble_statistics(
        self,
        zarr_sink_configuration: BlockInstance,
        ensemble_statistics_configuration: BlockInstance,
        ekdsource_output: BlockInstanceOutput,
    ):
        ensemble_block = EnsembleStatistics()
        ensemble_output: BlockInstanceOutput = ensemble_block.validate(
            block=ensemble_statistics_configuration, inputs={"dataset": ekdsource_output}
        ).get_or_raise()

        block = ZarrSink()

        assert block.intersect(input=ensemble_output)
        output: BlockInstanceOutput = block.validate(block=zarr_sink_configuration, inputs={"dataset": ensemble_output}).get_or_raise()
        assert output.is_empty()

    def test_from_temporal_statistics(
        self,
        zarr_sink_configuration: BlockInstance,
        temporal_statistics_configuration: BlockInstance,
        ekdsource_output: BlockInstanceOutput,
    ):
        temporal_block = TemporalStatistics()
        temporal_output: BlockInstanceOutput = temporal_block.validate(
            block=temporal_statistics_configuration, inputs={"dataset": ekdsource_output}
        ).get_or_raise()

        block = ZarrSink()

        assert block.intersect(input=temporal_output)
        output: BlockInstanceOutput = block.validate(block=zarr_sink_configuration, inputs={"dataset": temporal_output}).get_or_raise()
        assert output.is_empty()
