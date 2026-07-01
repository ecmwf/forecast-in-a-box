import pathlib

from cascade.low.func import Either
from earthkit.workflows.fluent import Action, Payload, PayloadBuildingContext, from_source
from fiab_core.artifacts import ArtifactsProvider, CompositeArtifactId
from fiab_core.fable import (
    ActionLookup,
    BlockConfigurationOption,
    BlockExpansion,
    BlockFactory,
    BlockFactoryCatalogue,
    BlockFactoryId,
    BlockInstance,
    BlockInstanceId,
    BlockInstanceOutput,
    BlueprintTemplate,
    ConfigurationOptionId,
    ConfigurationOptionRestriction,
    NoOutput,
    PluginBlockFactoryId,
    RawOutput,
    SelfPluginId,
)
from fiab_core.plugin import BlockValidation, Error, Plugin
from fiab_core.types import FableType

TEXT = ConfigurationOptionId("text")
DURATION = ConfigurationOptionId("duration")
CHECKPOINT = ConfigurationOptionId("checkpoint")
AMOUNT = ConfigurationOptionId("amount")
FNAME = ConfigurationOptionId("fname")


def _get_checkpoint_enum_type() -> str:
    available = ArtifactsProvider.get_artifacts_lookup()
    values = ", ".join(f"'{CompositeArtifactId.to_str(k)}'" for k in available.keys())
    return f"enumClosed[{values}]"


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
            configuration_options={TEXT: BlockConfigurationOption(title="", description="", value_type="str")},
            inputs=[],
        ),
        BlockFactoryId("source_sleep"): BlockFactory(
            kind="source",
            title="Source Sleep",
            description="Sleeps for a duration, then retuns the input text",
            configuration_options={
                TEXT: BlockConfigurationOption(title="", description="", value_type="str"),
                DURATION: BlockConfigurationOption(title="", description="", value_type="float"),
            },
            inputs=[],
        ),
        BlockFactoryId("source_filesize"): BlockFactory(
            kind="source",
            title="File Size Source",
            description="Returns the size of the given checkpoint file as a string",
            configuration_options={
                CHECKPOINT: BlockConfigurationOption(
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
            configuration_options={AMOUNT: BlockConfigurationOption(title="", description="", value_type="int")},
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
            configuration_options={FNAME: BlockConfigurationOption(title="", description="", value_type="str")},
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


def validator(instance: BlockInstance, inputs: dict[str, BlockInstanceOutput]) -> BlockValidation:
    restrictions: ConfigurationOptionRestriction = {}
    if instance.factory_id.factory == BlockFactoryId("transform_increment"):
        restrictions = {AMOUNT: FableType.parse("enumClosed[1,2,3]")}
    if instance.factory_id.factory in ("sink_file",):
        return BlockValidation(Either.ok(RawOutput(type_fqn="bytes", mime_type="text/plain")), restrictions)
    elif instance.factory_id.factory in ("sink_image",):
        return BlockValidation(Either.ok(RawOutput(type_fqn="bytes", mime_type="image/png")), restrictions)
    elif instance.factory_id.factory in ("source_sleep", "source_text", "source_filesize"):
        return BlockValidation(Either.ok(RawOutput(type_fqn="str", mime_type="text/plain")), restrictions)
    elif instance.factory_id.factory in ("source_42", "transform_increment", "product_join"):
        return BlockValidation(Either.ok(RawOutput(type_fqn="int")), restrictions)
    else:
        raise TypeError(f"unexpected factory {instance.factory_id.factory}")


def expander(output: BlockInstanceOutput) -> list[BlockExpansion]:
    if isinstance(output, RawOutput):
        if output.type_fqn == "int":
            return [
                BlockExpansion(
                    factory=BlockFactoryId("transform_increment"),
                    restrictions={AMOUNT: FableType.parse("enumClosed[1,2,3]")},
                ),
                BlockExpansion(factory=BlockFactoryId("product_join")),
                BlockExpansion(factory=BlockFactoryId("sink_file")),
                BlockExpansion(factory=BlockFactoryId("sink_image")),
            ]
        if output.type_fqn in ("str", "bytes"):
            return [BlockExpansion(factory=BlockFactoryId("sink_file"))]
    return []


def compiler(lookup: ActionLookup, instance: BlockInstance) -> Either[Action, Error]:  # ty:ignore[invalid-type-arguments] # semigroup
    with PayloadBuildingContext(environment=[f"-e {pathlib.Path(__file__).parent.parent.parent}"]):
        # with PayloadBuildingContext(environment=["-e /home/dev/src/fiab-plugin-test"]): # TODO handle the ssh:// scenario intelligently
        if instance.factory_id.factory == "source_42":
            action = from_source(Payload("fiab_plugin_test.runtime.source_42"))
        elif instance.factory_id.factory == "source_text":
            text = instance.configuration_values[TEXT]
            if not isinstance(text, str):
                return Either.error(f"Invalid type for {TEXT!r}: expected str, got {type(text).__name__}")
            action = from_source(Payload("fiab_plugin_test.runtime.source_text", kwargs={"text": text}))
        elif instance.factory_id.factory == "source_sleep":
            text = instance.configuration_values[TEXT]
            duration = instance.configuration_values[DURATION]
            if not isinstance(text, str):
                return Either.error(f"Invalid type for {TEXT!r}: expected str, got {type(text).__name__}")
            if not isinstance(duration, float):
                return Either.error(f"Invalid type for {DURATION!r}: expected float, got {type(duration).__name__}")
            action = from_source(Payload("fiab_plugin_test.runtime.source_sleep", kwargs={"text": text, "duration": duration}))
        elif instance.factory_id.factory == "source_filesize":
            checkpoint_str = instance.configuration_values[CHECKPOINT]
            if not isinstance(checkpoint_str, str):
                return Either.error(f"Invalid type for {CHECKPOINT!r}: expected str, got {type(checkpoint_str).__name__}")
            artifact_id = CompositeArtifactId.from_str(checkpoint_str)
            local_path = ArtifactsProvider.get_artifact_local_path(artifact_id)
            payload = Payload(
                "fiab_plugin_test.runtime.source_filesize", kwargs={"path": str(local_path)}, metadata={"artifacts": [artifact_id]}
            )
            action = from_source(payload)
        elif instance.factory_id.factory == "transform_increment":
            a = lookup[instance.input_ids["a"]]
            amount = instance.configuration_values[AMOUNT]
            if not isinstance(amount, int):
                return Either.error(f"Invalid type for {AMOUNT!r}: expected int, got {type(amount).__name__}")
            action = a.map(Payload("fiab_plugin_test.runtime.transform_increment", kwargs={"amount": amount}))
        elif instance.factory_id.factory == "product_join":
            a = lookup[instance.input_ids["a"]]
            b = lookup[instance.input_ids["b"]]
            action = a.join(b, dim="inputs").reduce(Payload("fiab_plugin_test.runtime.product_join"))
        elif instance.factory_id.factory == "sink_file":
            data = lookup[instance.input_ids["data"]]
            fname = instance.configuration_values[FNAME]
            if not isinstance(fname, str):
                return Either.error(f"Invalid type for {FNAME!r}: expected str, got {type(fname).__name__}")
            action = data.map(Payload("fiab_plugin_test.runtime.sink_file", kwargs={"fname": fname}))
        elif instance.factory_id.factory == "sink_image":
            data = lookup[instance.input_ids["data"]]
            action = data.map(Payload("fiab_plugin_test.runtime.sink_image"))
        else:
            raise TypeError(instance.factory_id.factory)
        return Either.ok(action)


plugin = lambda: Plugin(catalogue=catalogue(), validator=validator, expander=expander, compiler=compiler)


def _make_source_text_block(text: str) -> BlockInstance:
    return BlockInstance(
        factory_id=PluginBlockFactoryId(plugin=SelfPluginId, factory=BlockFactoryId("source_text")),
        configuration_values={TEXT: text} if text else {},
        input_ids={},
    )


_BLOCK_FIXED = BlockInstanceId("text_fixed")
_BLOCK_GLYPHS = BlockInstanceId("text_glyphs")
_BLOCK_EXAMPLE = BlockInstanceId("text_example")

_testBasic = BlueprintTemplate(
    display_name="testBasic",
    display_description="A minimal test template demonstrating fixed values, glyph substitution, and example values.",
    blocks={
        # Fixed: configuration value is a literal string -- no glyphs, no example override needed.
        _BLOCK_FIXED: _make_source_text_block("fixed text"),
        # Glyphs: value references two glyphs; greeting is pinned in local_glyphs,
        # name is provided only as an example the user should override.
        _BLOCK_GLYPHS: _make_source_text_block("${greeting} ${name}"),
        # Example only: no value in configuration_values; example_values shows
        # what a user might start with.
        _BLOCK_EXAMPLE: _make_source_text_block(""),
    },
    local_glyphs={"greeting": "hello"},
    example_values={_BLOCK_EXAMPLE: {TEXT: "text from example values"}},
    example_glyphs={"name": "world"},
)

_BLOCK_EXCL = BlockInstanceId("text_excl")

_testExclusion = BlueprintTemplate(
    display_name="testExclusion",
    display_description="A minimal template used to verify admin exclusion via the settings route.",
    blocks={
        _BLOCK_EXCL: _make_source_text_block("exclusion test"),
    },
)

_BLOCK_REMAP = BlockInstanceId("text_remap")

_testRemapping = BlueprintTemplate(
    display_name="testRemapping",
    display_description="A minimal template used to verify glyph-name remapping at install time.",
    blocks={
        _BLOCK_REMAP: _make_source_text_block("${pluginGlyphOld}"),
    },
    local_glyphs={"localOld": "${pluginGlyphOld}"},
)

_BLOCK_FAIL_VAL = BlockInstanceId("fail_val_block")

_testFailValidation = BlueprintTemplate(
    display_name="testFailValidation",
    display_description="A template that references a non-existent factory and always fails validation.",
    blocks={
        _BLOCK_FAIL_VAL: BlockInstance(
            factory_id=PluginBlockFactoryId(plugin=SelfPluginId, factory=BlockFactoryId("nonexistent_factory")),
            configuration_values={},
            input_ids={},
        ),
    },
)

plugin = lambda: Plugin(
    catalogue=catalogue(),
    validator=validator,
    expander=expander,
    compiler=compiler,
    blueprint_templates=(_testBasic, _testExclusion, _testRemapping, _testFailValidation),
)
