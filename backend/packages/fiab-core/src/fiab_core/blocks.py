# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

from typing import Literal

from fiab_core.fable import (
    BlockFactory,
    BlockInstance,
    BlockInstanceId,
    BlockInstanceOutput,
    DataPartitionLookup,
    BlockKind
)


class SourceFactory(BlockFactory):
    kind: BlockKind = "source"

    def validate(self, block: BlockInstance, inputs: dict[str, BlockInstanceOutput]):
        raise NotImplementedError

    def compile(
        self,
        partitions: DataPartitionLookup,
        block_id: BlockInstanceId,
        block: BlockInstance,
    ):
        raise NotImplementedError

    def intersect(self, input: BlockInstanceOutput | None) -> bool:
        return input is None


class ProductFactory(BlockFactory):
    kind: BlockKind = "product"

    def validate(self, block: BlockInstance, inputs: dict[str, BlockInstanceOutput]):
        raise NotImplementedError

    def compile(
        self,
        partitions: DataPartitionLookup,
        block_id: BlockInstanceId,
        block: BlockInstance,
    ):
        raise NotImplementedError

    def intersect(self, output: BlockInstanceOutput) -> bool:
        return False


class SinkFactory(BlockFactory):
    kind: BlockKind = "sink"

    def validate(self, block: BlockInstance, inputs: dict[str, BlockInstanceOutput]):
        raise NotImplementedError

    def compile(
        self,
        partitions: DataPartitionLookup,
        block_id: BlockInstanceId,
        block: BlockInstance,
    ):
        raise NotImplementedError

    def intersect(self, output: BlockInstanceOutput) -> bool:
        return False


class TransformFactory(BlockFactory):
    kind: BlockKind = "transform"

    def validate(self, block: BlockInstance, inputs: dict[str, BlockInstanceOutput]):
        raise NotImplementedError

    def compile(
        self,
        partitions: DataPartitionLookup,
        block_id: BlockInstanceId,
        block: BlockInstance,
    ):
        raise NotImplementedError

    def intersect(self, output: BlockInstanceOutput) -> bool:
        return False
