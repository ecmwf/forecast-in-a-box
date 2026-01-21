# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

from cascade.low.func import Either
from fiab_core.fable import (
    BlockFactoryCatalogue,
    BlockFactoryId,
    BlockInstance,
    BlockInstanceId,
    BlockInstanceOutput,
    DataPartitionLookup,
)
from fiab_core.plugin import Error, Plugin
from fiab_plugin_ecmwf.blocks import dummySink, ekdSource, ensembleStatistics

catalogue = BlockFactoryCatalogue(
    factories={
        "ekdSource": ekdSource,
        "ensembleStatistics": ensembleStatistics,
        "dummySink": dummySink,  # TODO: remove this once we have real sinks
    },
)


def validator(block: BlockInstance, inputs: dict[str, BlockInstanceOutput]) -> Either[BlockInstanceOutput, Error]:  # type: ignore[invalid-argument] # semigroup
    factory = catalogue.factories[block.factory_id.factory]
    return factory.validate(block, inputs)


def expander(block: BlockInstanceOutput) -> list[BlockFactoryId]:
    if len(block.variables) == 0:
        return []
    expansions: list[BlockFactoryId] = []
    for factory_id, factory in catalogue.factories.items():
        if factory.intersect(block):
            expansions.append(factory_id)
    return expansions


def compiler(partitions: DataPartitionLookup, block_id: BlockInstanceId, block: BlockInstance) -> Either[DataPartitionLookup, Error]:  # type: ignore[invalid-argument] # semigroup
    factory = catalogue.factories[block.factory_id.factory]
    return factory.compile(partitions, block_id, block)


plugin = Plugin(
    catalogue=catalogue,
    validator=validator,
    expander=expander,
    compiler=compiler,
)
