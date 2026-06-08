import importlib.metadata
import json
import os
from typing import Callable, cast

from cascade.low.func import Either
from earthkit.workflows.fluent import Action, PayloadBuildingContext

from fiab_core.fable import (
    ActionLookup,
    BlockExpansion,
    BlockFactoryCatalogue,
    BlockFactoryId,
    BlockInstance,
    BlockInstanceId,
    BlockInstanceOutput,
    ConfigurationOptionRestriction,
    QubedOutput,
)
from fiab_core.plugin import Error, Plugin
from fiab_core.tools.blocks import BlockInstanceConfigurationError, BlockInstanceRich, QubedBlockBuilder


def _detect_editable_install(distname: str) -> str:
    """If the distname's install is detected to be editable,
     we propagate it as editable command, otherwise we return
    unchanged"""
    # NOTE: This block is for 3.14+
    distribution = importlib.metadata.distribution(distname)
    if hasattr(distribution, "origin"):
        origin = distribution.origin
        if hasattr(origin, "url") and isinstance(origin.url, str) and origin.url.startswith("file://"):
            # NOTE this doesnt work well for non-std layout but again we can restrict to only that
            return "-e " + origin.url[len("file://") :]

    # NOTE: pre 3.14, eventually remove
    direct_url_text = distribution.read_text("direct_url.json")
    if direct_url_text:
        info = json.loads(direct_url_text)
        if not info.get("dir_info", {}).get("editable"):
            return distname

        url = info.get("url", "")
        if not url.startswith("file://"):
            return distname
        return "-e " + url[len("file://") :]

    return distname


class QubedPluginBuilder:
    def __init__(self, block_builders: dict[BlockFactoryId, QubedBlockBuilder], base_environment: list[str]) -> None:
        self.block_builders = block_builders
        self.base_environment = [_detect_editable_install(e) for e in base_environment]

    def validate(self, block: BlockInstance, inputs: dict[str, QubedOutput]) -> Either[BlockInstanceOutput, Error]:  # type:ignore[invalid-argument] # semigroup
        """Given a block instance corresponding to this plugin's Factory and its inputs, either provide error or determine what it outputs"""
        factory = self.block_builders[block.factory_id.factory]
        rich_block = BlockInstanceRich.from_block(block, factory.configuration_options)
        try:
            return factory.validate(rich_block, inputs)
        except BlockInstanceConfigurationError as exc:
            return Either.error(str(exc))

    def expand(self, output: QubedOutput) -> list[BlockExpansion]:
        """Given a block instance output (including from other plugin), provide which block factories from this plugin can expand it"""
        expansions: list[BlockExpansion] = []
        for factory_id, factory in self.block_builders.items():
            if factory.intersect(output):
                expansions.append(BlockExpansion(factory=factory_id))
        return expansions

    def restrict(self, block: BlockInstance, inputs: dict[str, QubedOutput]) -> ConfigurationOptionRestriction:
        """Provide restrictions for a block's own configuration options."""
        factory = self.block_builders.get(block.factory_id.factory)
        if factory is None:
            return {}
        rich_block = BlockInstanceRich.from_block(block, factory.configuration_options)
        try:
            return factory.restrictions(rich_block, inputs)
        except BlockInstanceConfigurationError:
            return {}

    def compile(
        self,
        inputs: ActionLookup,
        block_id: BlockInstanceId,
        block: BlockInstance,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        """Given a cascade builder and a block instance corresponding to this plugin's Factory, either update the builder with corresponding tasks or provide error"""
        with PayloadBuildingContext(environment=self.base_environment):
            factory = self.block_builders[block.factory_id.factory]
            rich_block = BlockInstanceRich.from_block(block, factory.configuration_options)
            try:
                return factory.compile(inputs, block_id, rich_block)
            except BlockInstanceConfigurationError as exc:
                return Either.error(str(exc))

    def as_plugin(self) -> Callable[[], Plugin]:
        def _generic_expand(block: BlockInstanceOutput) -> list[BlockExpansion]:
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

        def _generic_restrict(block: BlockInstance, inputs: dict[str, BlockInstanceOutput]) -> ConfigurationOptionRestriction:
            invalid = [f"{key}->{value.__class__.__name__}" for key, value in inputs.items() if not isinstance(value, QubedOutput)]
            if any(invalid):
                return {}
            inputs_validated = cast(dict[str, QubedOutput], inputs)
            return self.restrict(block, inputs_validated)

        return lambda: Plugin(
            catalogue=BlockFactoryCatalogue(
                factories={factory_id: factory.as_catalogue() for factory_id, factory in self.block_builders.items()}
            ),
            validator=_generic_validate,
            expander=_generic_expand,
            compiler=self.compile,
            restrictor=_generic_restrict,
        )
