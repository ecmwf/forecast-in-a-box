from fiab_core.fable import (
    BlockFactoryCatalogue,
    BlockFactoryId,
    BlockInstance,
    BlockInstanceId,
    BlockInstanceOutput,
    DataPartitionLookup,
)
from fiab_core.plugin import Plugin
from fiab_core.tools.blocks import FableImplementation


class PluginFactory:
    def __init__(self, implementations: dict[BlockFactoryId, FableImplementation]):
        self.fable_impl = implementations

    def validate(self, block: BlockInstance, inputs: dict[str, BlockInstanceOutput]) -> Either[BlockInstanceOutput, Error]:  # type:ignore[invalid-argument] # semigroup
        """Given a block instance corresponding to this plugin's Factory and its inputs, either provide error or determine what it outputs"""
        factory = self.fable_impl[block.factory_id.factory]
        return factory.validate(block, inputs)

    def expand(self, block: BlockInstanceOutput) -> list[BlockFactoryId]:
        """Given a block instance output (including from other plugin), provide which block factories from this plugin can expand it"""
        if len(block.variables) == 0:
            return []
        expansions: list[BlockFactoryId] = []
        for factory_id, factory in self.fable_impl.items():
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
        factory = self.fable_impl[block.factory_id.factory]
        return factory.compile(partitions, block_id, block)

    def as_plugin(self) -> Plugin:
        return Plugin(
            catalogue=BlockFactoryCatalogue(
                factories={factory_id: factory.as_catalogue() for factory_id, factory in self.fable_impl.items()}
            ),
            validator=self.validate,
            expander=self.expand,
            compiler=self.compile,
        )
