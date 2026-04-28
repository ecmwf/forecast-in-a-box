from cascade.low.func import Either
from earthkit.workflows.fluent import Action, Payload, from_source
from fiab_core.artifacts import ArtifactsProvider, CompositeArtifactId
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


def _get_checkpoint_enum_type() -> str:
    available = ArtifactsProvider.get_checkpoint_lookup()
    values = ", ".join(f"'{CompositeArtifactId.to_str(k)}'" for k in available.keys())
    return f"enum[{values}]"


catalogue = lambda: BlockFactoryCatalogue(
    factories={
        BlockFactoryId("source_42"): BlockFactory(
            kind="source",
            title="Source 42",
            description="Returns 42",
            configuration_options={},
            inputs=[],
        ),
        BlockFactoryId("source_text"): BlockFactory(
            kind="source",
            title="Source Text",
            description="Returns the input text",
            configuration_options={
                "text": BlockConfigurationOption(title="", description="", value_type="str"),
            },
            inputs=[],
        ),
        BlockFactoryId("source_sleep"): BlockFactory(
            kind="source",
            title="Source Sleep",
            description="Sleeps for a duration, then retuns the input text",
            configuration_options={
                "text": BlockConfigurationOption(title="", description="", value_type="str"),
                "duration": BlockConfigurationOption(title="", description="", value_type="float"),
            },
            inputs=[],
        ),
        BlockFactoryId("source_filesize"): BlockFactory(
            kind="source",
            title="File Size Source",
            description="Returns the size of the given checkpoint file as a string",
            configuration_options={
                "checkpoint": BlockConfigurationOption(
                    title="Checkpoint",
                    description="The checkpoint whose downloaded file size to report",
                    value_type=_get_checkpoint_enum_type(),
                ),
            },
            inputs=[],
        ),
        BlockFactoryId("transform_increment"): BlockFactory(
            kind="transform",
            title="Increment",
            description="Adds the amount to the input",
            configuration_options={
                "amount": BlockConfigurationOption(title="", description="", value_type="int"),
            },
            inputs=["a"],
        ),
        BlockFactoryId("product_join"): BlockFactory(
            kind="product",
            title="Join",
            description="Adds the two inputs together",
            configuration_options={},
            inputs=["a", "b"],
        ),
        BlockFactoryId("sink_file"): BlockFactory(
            kind="sink",
            title="File",
            description="Saves the input to a file",
            configuration_options={
                "fname": BlockConfigurationOption(title="", description="", value_type="str"),
            },
            inputs=["data"],
        ),
        BlockFactoryId("sink_image"): BlockFactory(
            kind="sink",
            title="Image",
            description="Generates a png image, using the input number as the grayscale",
            configuration_options={},
            inputs=["data"],
        ),
    }
)


def validator(instance: BlockInstance, inputs: dict[str, BlockInstanceOutput]) -> Either[BlockInstanceOutput, Error]:  # type:ignore[invalid-argument] # semigroup
    if instance.factory_id.factory in ("sink_file"):
        return Either.ok(RawOutput(type_fqn="str", mime_type="text/plain"))
    elif instance.factory_id.factory in ("sink_image"):
        return Either.ok(RawOutput(type_fqn="bytes", mime_type="image/png"))
    elif instance.factory_id.factory in ("source_sleep", "source_text", "source_filesize"):
        return Either.ok(RawOutput(type_fqn="str", mime_type="text/plain"))
    elif instance.factory_id.factory in ("source_42", "transform_increment", "product_join"):
        return Either.ok(RawOutput(type_fqn="int"))
    else:
        raise TypeError(f"unexpected factory {instance.factory_id.factory}")


def expander(output: BlockInstanceOutput) -> list[BlockFactoryId]:
    if isinstance(output, RawOutput):
        if output.type_fqn == "int":
            return [
                BlockFactoryId("transform_increment"),
                BlockFactoryId("product_join"),
                BlockFactoryId("sink_file"),
                BlockFactoryId("sink_image"),
            ]
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
    elif instance.factory_id.factory == "source_filesize":
        checkpoint_str = instance.configuration_values["checkpoint"]
        artifact_id = CompositeArtifactId.from_str(checkpoint_str)
        local_path = ArtifactsProvider.get_artifact_local_path(artifact_id)
        payload = Payload(
            "fiab_plugin_test.runtime.source_filesize", kwargs={"path": str(local_path)}, metadata={"artifacts": [artifact_id]}
        )
        action = from_source(payload)  # type: ignore
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
    elif instance.factory_id.factory == "sink_image":
        data = lookup[instance.input_ids["data"]]
        action = data.map(Payload("fiab_plugin_test.runtime.sink_image"))  # type: ignore
    else:
        raise TypeError(instance.factory_id.factory)
    return Either.ok(action)


plugin = lambda: Plugin(catalogue=catalogue(), validator=validator, expander=expander, compiler=compiler)
