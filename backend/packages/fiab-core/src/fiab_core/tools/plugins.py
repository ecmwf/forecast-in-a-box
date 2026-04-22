from typing import cast

from cascade.low.func import Either
from earthkit.workflows.fluent import Action

from fiab_core.fable import (
    ActionLookup,
    BlockFactoryCatalogue,
    BlockFactoryId,
    BlockInstance,
    BlockInstanceId,
    BlockInstanceOutput,
    QubedOutput,
)
from fiab_core.plugin import Error, Plugin
from fiab_core.tools.blocks import QubedBlockBuilder


class QubedPluginBuilder:
    def __init__(self, block_builders: dict[BlockFactoryId, QubedBlockBuilder]):
        self.block_builders = block_builders

    def validate(self, block: BlockInstance, inputs: dict[str, QubedOutput]) -> Either[BlockInstanceOutput, Error]:  # type:ignore[invalid-argument] # semigroup
        """Given a block instance corresponding to this plugin's Factory and its inputs, either provide error or determine what it outputs"""
        factory = self.block_builders[block.factory_id.factory]
        return factory.validate(block, inputs)

    def expand(self, block: QubedOutput) -> list[BlockFactoryId]:
        """Given a block instance output (including from other plugin), provide which block factories from this plugin can expand it"""
        expansions: list[BlockFactoryId] = []
        for factory_id, factory in self.block_builders.items():
            if factory.intersect(block):
                expansions.append(factory_id)
        return expansions

    def compile(
        self,
        inputs: ActionLookup,
        block_id: BlockInstanceId,
        block: BlockInstance,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        """Given a cascade builder and a block instance corresponding to this plugin's Factory, either update the builder with corresponding tasks or provide error"""
        factory = self.block_builders[block.factory_id.factory]
        return factory.compile(inputs, block_id, block)

    def as_plugin(self) -> Plugin:
        def _generic_expand(block: BlockInstanceOutput) -> list[BlockFactoryId]:
            if block.is_empty():
                return []
            if isinstance(block, QubedOutput):
                return self.expand(block)
            else:
                return []

        def _generic_validate(block: BlockInstance, inputs: dict[str, BlockInstanceOutput]) -> Either[BlockInstanceOutput, Error]:  # type:ignore[invalid-argument] # semigroup
            invalid = [f"{key}->{value.__class__.__name__}" for key, value in inputs.items() if not isinstance(value, QubedOutput)]
            if any(invalid):
                return Either.error(f"Expected only QubedOutputs in inputs, gotten {','.join(invalid)}")
            else:
                inputs_validated = cast(dict[str, QubedOutput], inputs)
                return self.validate(block, inputs_validated)

        return Plugin(
            catalogue=BlockFactoryCatalogue(
                factories={factory_id: factory.as_catalogue() for factory_id, factory in self.block_builders.items()}
            ),
            validator=_generic_validate,
            expander=_generic_expand,
            compiler=self.compile,
        )
