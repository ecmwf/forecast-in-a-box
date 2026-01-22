# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""
Types pertaining to declaring FIAB Plugins, in particular their Fable-based interface.
"""

from dataclasses import dataclass
from typing import Callable

from cascade.low.func import Either
from fiab_core.fable import (
    BlockFactoryCatalogue,
    BlockFactoryId,
    BlockInstance,
    BlockInstanceId,
    BlockInstanceOutput,
    DataPartitionLookup,
)

Error = str


@dataclass
class Plugin:
    """Base plugin with a block catalogue and default validate/expand/compile behavior.

    Override the methods in subclasses when a plugin needs custom logic that does not
    map 1:1 to the BlockFactory implementations.
    """

    catalogue: BlockFactoryCatalogue

    def validate(
        self, block: BlockInstance, inputs: dict[str, BlockInstanceOutput]
    ) -> Either[BlockInstanceOutput, Error]:  # type:ignore[invalid-argument] # semigroup
        """Given a block instance corresponding to this plugin's Factory and its inputs, either provide error or determine what it outputs"""
        factory = self.catalogue.factories[block.factory_id.factory]
        return factory.validate(block, inputs)

    def expand(self, block: BlockInstanceOutput) -> list[BlockFactoryId]:
        """Given a block instance output (including from other plugin), provide which block factories from this plugin can expand it"""
        if len(block.variables) == 0:
            return []
        expansions: list[BlockFactoryId] = []
        for factory_id, factory in self.catalogue.factories.items():
            if factory.intersect(block):
                expansions.append(factory_id)
        return expansions

    def compile(
        self,
        partitions: DataPartitionLookup,
        block_id: BlockInstanceId,
        block: BlockInstance,
    ) -> Either[DataPartitionLookup, Error]:  # type:ignore[invalid-argument] # semigroup
        """Given a cascade builder and a block instance corresponding to this plugin's Factory, either update the builder with corresponding tasks or provide error"""
        factory = self.catalogue.factories[block.factory_id.factory]
        return factory.compile(partitions, block_id, block)
