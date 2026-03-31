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
from fiab_core.fable import BlockInstance, BlockInstanceOutput, PluginBlockFactoryId, PluginCompositeId

from fiab_plugin_ecmwf.blocks import (
    EkdSource,
    EnsembleStatistics,
    MapPlotSink,
    TemporalStatistics,
    ZarrSink,
)
from fiab_plugin_ecmwf.metadata import QubedInstanceOutput


@pytest.fixture
def dummy_blockinstance() -> BlockInstance:
    return BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory="dummy"),  # type: ignore
        input_ids={},
        configuration_values={},
    )


@pytest.fixture
def dummy_blockinstance_output() -> BlockInstanceOutput:
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
def ekdsource_output(dummy_blockinstance: BlockInstance) -> BlockInstanceOutput:
    return EkdSource().validate(block=dummy_blockinstance, inputs={}).get_or_raise()


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


@pytest.fixture
def map_plot_sink_configuration() -> BlockInstance:
    return BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory="MapPlotSink"),  # type: ignore
        input_ids={"dataset": "source_output"},
        configuration_values={
            "param": "2t",
            "domain": "global",
            "format": "png",
            "groupby": "valid_datetime",
            "style_schema": "inbuilt://fiab",
        },
    )


class TestEkdSource:
    def test_creation(self, dummy_blockinstance: BlockInstance, dummy_blockinstance_output: BlockInstanceOutput):
        block = EkdSource()

        assert not block.intersect(input=dummy_blockinstance_output)
        output: BlockInstanceOutput = block.validate(block=dummy_blockinstance, inputs={}).get_or_raise()
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

        ekdsource_output = cast(QubedInstanceOutput, ekdsource_output)
        modified_output = ekdsource_output.collapse("param")

        assert not block.intersect(input=modified_output)
        result = block.validate(block=ensemble_statistics_configuration, inputs={"dataset": modified_output})
        with pytest.raises(ValueError, match="param 2t is not in the input parameters"):
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

        ekdsource_output = cast(QubedInstanceOutput, ekdsource_output)
        modified_output = ekdsource_output.collapse("param")

        assert not block.intersect(input=modified_output)
        result = block.validate(block=temporal_statistics_configuration, inputs={"dataset": modified_output})
        with pytest.raises(ValueError, match="param 2t is not in the input parameters"):
            assert result.get_or_raise()


class TestZarrSink:
    def test_from_ekdsource(self, zarr_sink_configuration: BlockInstance, ekdsource_output: BlockInstanceOutput):
        block = ZarrSink()

        assert block.intersect(input=ekdsource_output)
        output: BlockInstanceOutput = block.validate(
            block=zarr_sink_configuration,
            inputs={"dataset": ekdsource_output},
        ).get_or_raise()
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
        output: BlockInstanceOutput = block.validate(
            block=zarr_sink_configuration,
            inputs={"dataset": ensemble_output},
        ).get_or_raise()
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
        output: BlockInstanceOutput = block.validate(
            block=zarr_sink_configuration,
            inputs={"dataset": temporal_output},
        ).get_or_raise()
        assert output.is_empty()


class TestMapPlotSink:
    def test_intersect_from_ekdsource(self, ekdsource_output: BlockInstanceOutput):
        block = MapPlotSink()
        assert block.intersect(input=ekdsource_output)

    def test_intersect_rejects_empty(self, dummy_blockinstance_output: BlockInstanceOutput):
        block = MapPlotSink()
        assert not block.intersect(input=dummy_blockinstance_output)

    def test_intersect_rejects_no_param(self, ekdsource_output: BlockInstanceOutput):
        block = MapPlotSink()
        collapsed = cast(QubedInstanceOutput, ekdsource_output).collapse("param")
        assert not block.intersect(input=collapsed)

    def test_validate_from_ekdsource(self, map_plot_sink_configuration: BlockInstance, ekdsource_output: BlockInstanceOutput):
        block = MapPlotSink()
        output = block.validate(block=map_plot_sink_configuration, inputs={"dataset": ekdsource_output}).get_or_raise()
        assert output.is_empty()

    def test_validate_multi_param(self, ekdsource_output: BlockInstanceOutput):
        block = MapPlotSink()
        config = BlockInstance(
            factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory="MapPlotSink"),
            input_ids={"dataset": "source_output"},
            configuration_values={
                "param": '["2t", "msl"]',
                "domain": "global",
                "format": "png",
                "groupby": "none",
                "style_schema": "inbuilt://fiab",
            },
        )
        output = block.validate(block=config, inputs={"dataset": ekdsource_output}).get_or_raise()
        assert output.is_empty()

    def test_validate_missing_param(self, ekdsource_output: BlockInstanceOutput):
        block = MapPlotSink()
        config = BlockInstance(
            factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory="MapPlotSink"),
            input_ids={"dataset": "source_output"},
            configuration_values={
                "param": "nonexistent",
                "domain": "global",
                "format": "png",
                "groupby": "none",
                "style_schema": "inbuilt://fiab",
            },
        )
        result = block.validate(block=config, inputs={"dataset": ekdsource_output})
        with pytest.raises(ValueError, match="params \\['nonexistent'\\] are not in the input parameters"):
            result.get_or_raise()

    def test_validate_partial_missing_params(self, ekdsource_output: BlockInstanceOutput):
        block = MapPlotSink()
        config = BlockInstance(
            factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory="MapPlotSink"),
            input_ids={"dataset": "source_output"},
            configuration_values={
                "param": '["2t", "nonexistent"]',
                "domain": "global",
                "format": "png",
                "groupby": "none",
                "style_schema": "inbuilt://fiab",
            },
        )
        result = block.validate(block=config, inputs={"dataset": ekdsource_output})
        with pytest.raises(ValueError, match="params \\['nonexistent'\\] are not in the input parameters"):
            result.get_or_raise()

    def test_validate_from_ensemble_statistics(
        self,
        map_plot_sink_configuration: BlockInstance,
        ensemble_statistics_configuration: BlockInstance,
        ekdsource_output: BlockInstanceOutput,
    ):
        ensemble_output = (
            EnsembleStatistics().validate(block=ensemble_statistics_configuration, inputs={"dataset": ekdsource_output}).get_or_raise()
        )

        block = MapPlotSink()
        assert block.intersect(input=ensemble_output)
        output = block.validate(block=map_plot_sink_configuration, inputs={"dataset": ensemble_output}).get_or_raise()
        assert output.is_empty()
