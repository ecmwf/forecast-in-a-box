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
from fiab_core.fable import BlockInstance, NoOutput, PluginBlockFactoryId, PluginCompositeId, QubedOutput

from fiab_plugin_ecmwf.blocks import (
    EkdSource,
    EnsembleStatistics,
    MapPlotSink,
    TemporalStatistics,
    ZarrSink,
)
from fiab_plugin_ecmwf.qubed_utils import axes, collapse, contains


@pytest.fixture
def dummy_blockinstance() -> BlockInstance:
    return BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory="dummy"),  # type: ignore
        input_ids={},
        configuration_values={},
    )


@pytest.fixture
def dummy_blockinstance_output() -> QubedOutput:
    return QubedOutput()


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
def ekdsource_output(dummy_blockinstance: BlockInstance) -> QubedOutput:
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


@pytest.fixture
def map_plot_sink_configuration() -> BlockInstance:
    return BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=PluginCompositeId.from_str("ecmwf:ecmwf"), factory="MapPlotSink"),  # type: ignore
        input_ids={"dataset": "source_output"},
        configuration_values={
            "param": "2t",
            "domain": "global",
            "format": "png",
            "groupby": "step",
            "style_schema": "inbuilt://fiab",
        },
    )


class TestEkdSource:
    def test_creation(self, dummy_blockinstance: BlockInstance, dummy_blockinstance_output: QubedOutput):
        block = EkdSource()

        assert not block.intersect(other=dummy_blockinstance_output)  # type: ignore[arg-type]
        output = block.validate(block=dummy_blockinstance, inputs={}).get_or_raise()  # type: ignore[assignment]
        assert isinstance(output, QubedOutput)
        assert output.dataqube is not None
        assert contains(output, "param")


class TestEnsembleStatistics:
    def test_from_ekdsource(self, ensemble_statistics_configuration: BlockInstance, ekdsource_output: QubedOutput):
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
    ):
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

    def test_missing_param(self, ensemble_statistics_configuration: BlockInstance, ekdsource_output: QubedOutput):
        block = EnsembleStatistics()

        modified_output = collapse(ekdsource_output, "param")

        assert not block.intersect(other=modified_output)  # type: ignore[arg-type]
        result = block.validate(block=ensemble_statistics_configuration, inputs={"dataset": modified_output})  # type: ignore[dict-item]
        with pytest.raises(ValueError, match="param 2t is not in the input parameters"):
            assert result.get_or_raise()


class TestTemporalStatistics:
    def test_from_ekdsource(self, temporal_statistics_configuration: BlockInstance, ekdsource_output: QubedOutput):
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
    ):
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

    def test_missing_param(self, temporal_statistics_configuration: BlockInstance, ekdsource_output: QubedOutput):
        block = TemporalStatistics()

        modified_output = collapse(ekdsource_output, "param")

        assert not block.intersect(other=modified_output)  # type: ignore[arg-type]
        result = block.validate(block=temporal_statistics_configuration, inputs={"dataset": modified_output})  # type: ignore[dict-item]
        with pytest.raises(ValueError, match="param 2t is not in the input parameters"):
            assert result.get_or_raise()


class TestZarrSink:
    def test_from_ekdsource(self, zarr_sink_configuration: BlockInstance, ekdsource_output: QubedOutput):
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
    ):
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
    ):
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


class TestMapPlotSink:
    def test_intersect_from_ekdsource(self, ekdsource_output: QubedOutput):
        block = MapPlotSink()
        assert block.intersect(other=ekdsource_output)  # type: ignore[arg-type]

    def test_intersect_rejects_empty(self, dummy_blockinstance_output: QubedOutput):
        block = MapPlotSink()
        assert not block.intersect(other=dummy_blockinstance_output)  # type: ignore[arg-type]

    def test_intersect_rejects_no_param(self, ekdsource_output: QubedOutput):
        block = MapPlotSink()
        collapsed = collapse(ekdsource_output, "param")
        assert not block.intersect(other=collapsed)  # type: ignore[arg-type]

    def test_validate_from_ekdsource(self, map_plot_sink_configuration: BlockInstance, ekdsource_output: QubedOutput):
        block = MapPlotSink()
        output = block.validate(block=map_plot_sink_configuration, inputs={"dataset": ekdsource_output}).get_or_raise()  # type: ignore[dict-item]
        assert isinstance(output, NoOutput)

    def test_validate_multi_param(self, ekdsource_output: QubedOutput):
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
        output = block.validate(block=config, inputs={"dataset": ekdsource_output}).get_or_raise()  # type: ignore[dict-item]
        assert isinstance(output, NoOutput)

    def test_validate_missing_param(self, ekdsource_output: QubedOutput):
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
        result = block.validate(block=config, inputs={"dataset": ekdsource_output})  # type: ignore[dict-item]
        with pytest.raises(ValueError, match="params \\['nonexistent'\\] are not in the input parameters"):
            result.get_or_raise()

    def test_validate_partial_missing_params(self, ekdsource_output: QubedOutput):
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
        result = block.validate(block=config, inputs={"dataset": ekdsource_output})  # type: ignore[dict-item]
        with pytest.raises(ValueError, match="params \\['nonexistent'\\] are not in the input parameters"):
            result.get_or_raise()

    def test_validate_from_ensemble_statistics(
        self,
        map_plot_sink_configuration: BlockInstance,
        ensemble_statistics_configuration: BlockInstance,
        ekdsource_output: QubedOutput,
    ):
        ensemble_output = (
            EnsembleStatistics().validate(block=ensemble_statistics_configuration, inputs={"dataset": ekdsource_output}).get_or_raise()  # type: ignore[dict-item]
        )

        block = MapPlotSink()
        assert block.intersect(other=ensemble_output)  # type: ignore[arg-type]
        output = block.validate(block=map_plot_sink_configuration, inputs={"dataset": ensemble_output}).get_or_raise()  # type: ignore[dict-item]
        assert isinstance(output, NoOutput)
