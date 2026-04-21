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
from earthkit.workflows.fluent import Action

from fiab_core.fable import (
    ActionLookup,
    BlockConfigurationOption,
    BlockFactory,
    BlockInstance,
    BlockInstanceId,
    BlockInstanceOutput,
    BlockKind,
    QubedOutput,
)
from fiab_core.plugin import Error


class QubedBlockBuilder(abc.ABC):
    kind: BlockKind
    title: str
    description: str
    configuration_options: dict[str, BlockConfigurationOption]
    inputs: list[str]

    def validate(self, block: BlockInstance, inputs: dict[str, QubedOutput]) -> Either[BlockInstanceOutput, Error]:  # type:ignore[invalid-argument] # semigroup
        raise NotImplementedError

    def compile(
        self,
        inputs: ActionLookup,
        block_id: BlockInstanceId,
        block: BlockInstance,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        raise NotImplementedError

    def intersect(self, other: QubedOutput) -> bool:
        raise NotImplementedError

    def as_catalogue(self) -> BlockFactory:
        return BlockFactory(
            kind=self.kind,
            title=self.title,
            description=self.description,
            configuration_options=self.configuration_options,
            inputs=self.inputs,
        )


class Source(QubedBlockBuilder):
    kind: BlockKind = "source"

    def intersect(self, other: QubedOutput) -> bool:
        return False


class Product(QubedBlockBuilder):
    kind: BlockKind = "product"


class Sink(QubedBlockBuilder):
    kind: BlockKind = "sink"


class Transform(QubedBlockBuilder):
    kind: BlockKind = "transform"
