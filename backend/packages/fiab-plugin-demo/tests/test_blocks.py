# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import pytest
from fiab_core.fable import BlockFactoryId, BlockInstance, BlockInstanceId, NoOutput, QubedOutput
from fiab_core.tools.blocks import BlockInstanceRich, QubedBlockBuilder

from fiab_plugin_demo import plugin
from fiab_plugin_demo.blocks import (
    EnsembleProbabilityTransform,
    ExtremeIndexProduct,
    FilterParam,
    GRIBOutputSink,
    InterpolationTransform,
    MonthlyMeanTransform,
    NetCDFOutputSink,
    TropicalCycloneProduct,
    WeeklyMeanTransform,
)

EXPECTED_FACTORY_IDS = {
    BlockFactoryId("netcdfOutput"),
    BlockFactoryId("gribOutput"),
    BlockFactoryId("interpolation"),
    BlockFactoryId("weeklyMean"),
    BlockFactoryId("monthlyMean"),
    BlockFactoryId("ensembleProbability"),
    BlockFactoryId("extremeIndex"),
    BlockFactoryId("tropicalCyclone"),
    BlockFactoryId("filterParam"),
}


def _block(factory_id: BlockFactoryId) -> BlockInstance:
    return BlockInstance(
        input_ids={"dataset": BlockInstanceId("source_output")},
        configuration_values={},
    )


def _rich_block(factory_id: BlockFactoryId, builder: QubedBlockBuilder) -> BlockInstanceRich:
    return BlockInstanceRich.from_block(factory_id, _block(factory_id), builder.configuration_options)


@pytest.fixture
def dummy_output() -> QubedOutput:
    return QubedOutput()


def test_plugin_catalogue_contains_all_demo_blocks() -> None:
    assert set(plugin().catalogue.factories.keys()) == EXPECTED_FACTORY_IDS


def test_plugin_expands_qubed_output_to_all_demo_blocks(dummy_output: QubedOutput) -> None:
    assert set(expansion.factory for expansion in plugin().expander(dummy_output)) == EXPECTED_FACTORY_IDS


@pytest.mark.parametrize(
    ("factory_id", "builder"),
    [
        (BlockFactoryId("interpolation"), InterpolationTransform()),
        (BlockFactoryId("weeklyMean"), WeeklyMeanTransform()),
        (BlockFactoryId("monthlyMean"), MonthlyMeanTransform()),
        (BlockFactoryId("ensembleProbability"), EnsembleProbabilityTransform()),
        (BlockFactoryId("filterParam"), FilterParam()),
        (BlockFactoryId("extremeIndex"), ExtremeIndexProduct()),
        (BlockFactoryId("tropicalCyclone"), TropicalCycloneProduct()),
    ],
)
def test_demo_blocks_pass_through_dataset(
    factory_id: BlockFactoryId,
    builder: QubedBlockBuilder,
    dummy_output: QubedOutput,
) -> None:
    block = _rich_block(factory_id, builder)
    validated = builder.validate(block=block, inputs={"dataset": dummy_output}, restrictions={})
    assert validated is dummy_output


@pytest.mark.parametrize(
    ("factory_id", "builder"),
    [
        (BlockFactoryId("netcdfOutput"), NetCDFOutputSink()),
        (BlockFactoryId("gribOutput"), GRIBOutputSink()),
    ],
)
def test_demo_sinks_return_no_output(factory_id: BlockFactoryId, builder: QubedBlockBuilder, dummy_output: QubedOutput) -> None:
    block = _rich_block(factory_id, builder)
    validated = builder.validate(block=block, inputs={"dataset": dummy_output}, restrictions={})
    assert isinstance(validated, NoOutput)


@pytest.mark.parametrize(
    ("factory_id", "builder"),
    [
        (BlockFactoryId("netcdfOutput"), NetCDFOutputSink()),
        (BlockFactoryId("gribOutput"), GRIBOutputSink()),
        (BlockFactoryId("interpolation"), InterpolationTransform()),
        (BlockFactoryId("weeklyMean"), WeeklyMeanTransform()),
        (BlockFactoryId("monthlyMean"), MonthlyMeanTransform()),
        (BlockFactoryId("ensembleProbability"), EnsembleProbabilityTransform()),
        (BlockFactoryId("filterParam"), FilterParam()),
        (BlockFactoryId("extremeIndex"), ExtremeIndexProduct()),
        (BlockFactoryId("tropicalCyclone"), TropicalCycloneProduct()),
    ],
)
def test_demo_blocks_require_dataset(factory_id: BlockFactoryId, builder: QubedBlockBuilder) -> None:
    block = _rich_block(factory_id, builder)
    with pytest.raises(Exception, match="Missing input 'dataset'"):
        builder.validate(block=block, inputs={}, restrictions={})
