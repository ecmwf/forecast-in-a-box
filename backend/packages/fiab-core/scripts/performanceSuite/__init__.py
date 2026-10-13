# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Code shared by the plugin performance suite (pluginPerf) and the plugin profiler (pluginProf).

Contains the schema of the case files, the constraints put on them, the fake ArtifactsProvider, and the
way a single block is validated and compiled.

Constraints on the cases, compared to blueprints processed by the backend:
 - no glyphs, no jinja expressions -- any string value containing ``${`` is rejected
 - all configuration options of the factory must be present, no extra are allowed, default values are not imputed
 - all blocks belong to the plugin under test
 - blocks are declared in topological order, ie, every input id references a block declared earlier
 - environment, local glyphs, example values and other template fields are not supported

The ``skipped`` flag of a case is honoured by pluginPerf and ignored by pluginProf.
"""

import tempfile
from pathlib import Path
from typing import Any

from earthkit.workflows.fluent import Action, NodeMetadataContext
from earthkit.workflows.metadata import BuilderMetadata
from pydantic import BaseModel

from fiab_core.artifacts import ArtifactsProvider, ArtifactStoreId, parse_json
from fiab_core.fable import (
    ActionLookup,
    BlockFactory,
    BlockInstance,
    BlockInstanceId,
    BlockInstanceOutput,
    BlueprintTemplateBlock,
    ConfigurationOptionId,
)
from fiab_core.plugin import Plugin

ARTIFACT_STORE_ID = ArtifactStoreId("ecmwf")

PHASES = ("validate", "expand", "compile")


class PerfCase(BaseModel):
    blocks: dict[BlockInstanceId, BlueprintTemplateBlock]
    skipped: str | None = None


def register_fake_artifacts_provider(artifacts_path: Path) -> None:
    lookup = dict(parse_json(ARTIFACT_STORE_ID, artifacts_path.read_text(), lambda _common, _specific: (True, None)))
    fake_root = Path(tempfile.gettempdir()) / "fiabPerfSuiteNonexistent"
    ArtifactsProvider.register_get_artifacts_lookup(lambda: lookup)
    ArtifactsProvider.register_get_artifact_local_path(lambda c: fake_root / c.artifact_store_id / c.artifact_local_id)


def contains_glyph(value: Any) -> bool:
    if isinstance(value, str):
        return "${" in value
    if isinstance(value, (list, tuple)):
        return any(contains_glyph(v) for v in value)
    if isinstance(value, dict):
        return any(contains_glyph(k) or contains_glyph(v) for k, v in value.items())
    return False


def convert_configuration_values(context: str, instance: BlockInstance, factory: BlockFactory) -> BlockInstance:
    """Checks the case constraints and returns the instance with deserialized configuration values"""
    declared = set(factory.configuration_options.keys())
    given = set(instance.configuration_values.keys())
    if declared != given:
        raise ValueError(f"{context}: configuration options mismatch, missing {declared - given}, extra {given - declared}")
    converted: dict[ConfigurationOptionId, Any] = {}
    for option_id, option in factory.configuration_options.items():
        raw = instance.configuration_values[option_id]
        if contains_glyph(raw):
            raise ValueError(f"{context}: option {option_id!r} contains a glyph, which is not supported: {raw!r}")
        converted[option_id] = option.value_type.validate_convert(raw)
    return instance.model_copy(update={"configuration_values": converted})


def prepare_block(
    plugin: Plugin,
    context: str,
    block: BlueprintTemplateBlock,
    outputs: dict[BlockInstanceId, BlockInstanceOutput],
) -> tuple[BlockInstance, dict[str, BlockInstanceOutput]]:
    """Returns the instance with converted configuration, and the validator inputs, given the outputs of preceding blocks"""
    factory = plugin.catalogue.factories.get(block.factory_id)
    if factory is None:
        raise ValueError(f"{context}: factory {block.factory_id!r} not in the plugin's catalogue")
    for source_id in block.instance.input_ids.values():
        if source_id not in outputs:
            raise ValueError(f"{context}: input {source_id!r} not declared before this block")
    instance = convert_configuration_values(context, block.instance, factory)
    inputs = {input_name: outputs[source_id] for input_name, source_id in instance.input_ids.items()}
    return instance, inputs


def validate_block(
    plugin: Plugin, context: str, block: BlueprintTemplateBlock, instance: BlockInstance, inputs: dict[str, BlockInstanceOutput]
) -> BlockInstanceOutput:
    """Invokes the validator, raising on failure"""
    validation = plugin.validator(block.factory_id, instance, inputs)
    if validation.result.t is None:
        raise ValueError(f"{context}: validation failed with {validation.result.e}")
    return validation.result.t


def compile_block(
    plugin: Plugin,
    context: str,
    block_id: BlockInstanceId,
    block: BlueprintTemplateBlock,
    instance: BlockInstance,
    action_lookup: ActionLookup,
) -> Action:
    """Invokes the compiler within the same NodeMetadataContext as the backend does, raising on failure"""
    with NodeMetadataContext(builder=BuilderMetadata(blockId=block_id)):
        result = plugin.compiler(action_lookup, block.factory_id, instance)
    if result.t is None:
        raise ValueError(f"{context}: compile failed with {result.e}")
    return result.t
