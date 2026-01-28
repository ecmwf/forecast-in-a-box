# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import abc

from cascade.low.func import Either

from fiab_core.fable import (
    BlockConfigurationOption,
    BlockFactory,
    BlockInstance,
    BlockInstanceId,
    BlockInstanceOutput,
    BlockKind,
    DataPartitionLookup,
)
from fiab_core.plugin import Error


class BlockBuilder(abc.ABC):
    kind: BlockKind
    title: str
    description: str
    configuration_options: dict[str, BlockConfigurationOption]
    inputs: list[str]

    def validate(self, block: BlockInstance, inputs: dict[str, BlockInstanceOutput]) -> Either[BlockInstanceOutput, Error]:  # type:ignore[invalid-argument] # semigroup
        raise NotImplementedError

    def compile(
        self,
        partitions: DataPartitionLookup,
        block_id: BlockInstanceId,
        block: BlockInstance,
    ) -> Either[DataPartitionLookup, Error]:  # type:ignore[invalid-argument] # semigroup
        raise NotImplementedError

    def intersect(self, input: BlockInstanceOutput) -> bool:
        raise NotImplementedError

    def as_catalogue(self) -> BlockFactory:
        return BlockFactory(
            kind=self.kind,
            title=self.title,
            description=self.description,
            configuration_options=self.configuration_options,
            inputs=self.inputs,
        )


class Source(BlockBuilder):
    kind: BlockKind = "source"

    def intersect(self, input: BlockInstanceOutput) -> bool:
        return False


class Product(BlockBuilder):
    kind: BlockKind = "product"


class Sink(BlockBuilder):
    kind: BlockKind = "sink"


class Transform(BlockBuilder):
    kind: BlockKind = "transform"
