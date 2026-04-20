from cascade.low.func import Either
from earthkit.workflows.fluent import Action, Payload, from_source
from fiab_core.fable import (
    ActionLookup,
    BlockConfigurationOption,
    BlockFactory,
    BlockFactoryCatalogue,
    BlockFactoryId,
    BlockInstance,
    BlockInstanceId,
    BlockInstanceOutput,
    NoOutput,
    RawOutput,
)
from fiab_core.plugin import Error, Plugin

catalogue = BlockFactoryCatalogue(
    factories={
        BlockFactoryId("source_42"): BlockFactory(
            kind="source",
            title="",
            description="",
            configuration_options={},
            inputs=[],
        ),
        BlockFactoryId("source_text"): BlockFactory(
            kind="source",
            title="",
            description="",
            configuration_options={
                "text": BlockConfigurationOption(title="", description="", value_type="str"),
            },
            inputs=[],
        ),
        BlockFactoryId("source_sleep"): BlockFactory(
            kind="source",
            title="",
            description="",
            configuration_options={
                "text": BlockConfigurationOption(title="", description="", value_type="str"),
                "duration": BlockConfigurationOption(title="", description="", value_type="float"),
            },
            inputs=[],
        ),
        BlockFactoryId("transform_increment"): BlockFactory(
            kind="transform",
            title="",
            description="",
            configuration_options={
                "amount": BlockConfigurationOption(title="", description="", value_type="int"),
            },
            inputs=["a"],
        ),
        BlockFactoryId("product_join"): BlockFactory(
            kind="product",
            title="",
            description="",
            configuration_options={},
            inputs=["a", "b"],
        ),
        BlockFactoryId("sink_file"): BlockFactory(
            kind="sink",
            title="",
            description="",
            configuration_options={
                "fname": BlockConfigurationOption(title="", description="", value_type="str"),
            },
            inputs=["data"],
        ),
    }
)


def validator(instance: BlockInstance, inputs: dict[str, BlockInstanceOutput]) -> Either[BlockInstanceOutput, Error]:  # type:ignore[invalid-argument] # semigroup
    if instance.factory_id.factory == "sink_file":
        return Either.ok(NoOutput)
    elif instance.factory_id.factory in ("source_sleep", "source_text"):
        return Either.ok(RawOutput(type_fqn="str"))
    else:
        return Either.ok(RawOutput(type_fqn="int"))


def expander(output: BlockInstanceOutput) -> list[BlockFactoryId]:
    if isinstance(output, RawOutput):
        if output.type_fqn == "int":
            return [BlockFactoryId("transform_increment"), BlockFactoryId("product_join"), BlockFactoryId("sink_file")]
        if output.type_fqn == "str":
            return [BlockFactoryId("sink_file")]
    return []


def compiler(lookup: ActionLookup, bid: BlockInstanceId, instance: BlockInstance) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
    if instance.factory_id.factory == "source_42":
        action = from_source(Payload("fiab_plugin_test.runtime.source_42"))  # type: ignore
    elif instance.factory_id.factory == "source_text":
        text = instance.configuration_values["text"]
        action = from_source(Payload("fiab_plugin_test.runtime.source_text", kwargs={"text": text}))  # type: ignore
    elif instance.factory_id.factory == "source_sleep":
        text = instance.configuration_values["text"]
        duration = float(instance.configuration_values["duration"])
        action = from_source(Payload("fiab_plugin_test.runtime.source_sleep", kwargs={"text": text, "duration": duration}))  # type: ignore
    elif instance.factory_id.factory == "transform_increment":
        a = lookup[instance.input_ids["a"]]
        amount = instance.configuration_values["amount"]
        action = a.map(Payload("fiab_plugin_test.runtime.transform_increment", kwargs={"amount": int(amount)}))  # type: ignore
    elif instance.factory_id.factory == "product_join":
        a = lookup[instance.input_ids["a"]]
        b = lookup[instance.input_ids["b"]]
        action = a.join(b, dim="inputs").reduce(Payload("fiab_plugin_test.runtime.product_join"))  # type: ignore
    elif instance.factory_id.factory == "sink_file":
        data = lookup[instance.input_ids["data"]]
        fname = instance.configuration_values["fname"]
        action = data.map(Payload("fiab_plugin_test.runtime.sink_file", kwargs={"fname": fname}))  # type: ignore
    else:
        raise TypeError(instance.factory_id.factory)
    return Either.ok(action)


plugin = Plugin(catalogue=catalogue, validator=validator, expander=expander, compiler=compiler)
