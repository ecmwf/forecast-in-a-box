from cascade.low.func import Either
from earthkit.workflows.fluent import Action, Payload, from_source
from fiab_core.fable import (
    ActionLookup,
    BlockFactory,
    BlockFactoryCatalogue,
    BlockFactoryId,
    BlockInstance,
    BlockInstanceId,
    BlockInstanceOutput,
    RawOutput,
)
from fiab_core.plugin import Error, Plugin

catalogue = BlockFactoryCatalogue(
    factories={
        "source_42": BlockFactory(
            kind="source",
            title="",
            description="",
            configuration_options={},
            inputs=[],
        ),
    }
)


def validator(instance: BlockInstance, inputs: dict[str, BlockInstanceOutput]) -> Either[BlockInstanceOutput, Error]:  # type:ignore[invalid-argument] # semigroup
    return Either.ok(RawOutput(type_fqn="int"))


def expander(output: BlockInstanceOutput) -> list[BlockFactoryId]:
    return []


def compiler(lookup: ActionLookup, bid: BlockInstanceId, instance: BlockInstance) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
    if instance.factory_id.factory == "source_42":
        action = from_source(Payload("fiab_plugin_test.runtime.source_42"))  # type: ignore
    else:
        raise TypeError(instance.factory_id.factory)
    return Either.ok(action)


plugin = Plugin(catalogue=catalogue, validator=validator, expander=expander, compiler=compiler)
