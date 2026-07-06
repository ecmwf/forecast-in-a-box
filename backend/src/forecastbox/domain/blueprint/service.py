# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Service layer for the blueprint domain.

Owns:
- pure builder validation / expansion logic (formerly in ``api.blueprint``),
- pure builder compilation logic (formerly in ``api.blueprint``),
- saving a BlueprintBuilder as a Blueprint,
- loading a Blueprint back into BlueprintBuilder form,
- compiling a stored blueprint to an ExecutionSpecification.

No HTTP exceptions are raised here; callers are responsible for mapping
``BlueprintNotFound`` and ``BlueprintAccessDenied`` to HTTP responses.
"""

import logging
from collections import defaultdict
from itertools import groupby
from typing import Any, cast

from fiab_core.fable import (
    BlockFactoryId,
    BlockInstance,
    BlockInstanceId,
    BlockInstanceOutput,
    BlockKind,
    BlueprintTemplate,
    ConfigurationOptionId,
    LocalBlock,
    NoOutput,
    PluginBlockExpansion,
    PluginBlockFactoryId,
    PluginCompositeId,
    QubedOutput,
)
from pydantic import Field, model_validator

from forecastbox.domain.blueprint import db
from forecastbox.domain.blueprint.cascade import EnvironmentSpecification
from forecastbox.domain.blueprint.configuration_values import convert_known_configuration_values
from forecastbox.domain.blueprint.db import upsert_blueprint
from forecastbox.domain.blueprint.exceptions import BlueprintNotFound
from forecastbox.domain.blueprint.types import BlueprintId
from forecastbox.domain.glyphs import global_db, resolution
from forecastbox.domain.glyphs.exceptions import GlyphCircularReferenceError
from forecastbox.domain.glyphs.intrinsic import get_values_and_examples
from forecastbox.domain.glyphs.resolution import ExtractedGlyphs, expand_glyph_values, merge_glyph_values, remap_glyph_names
from forecastbox.domain.plugin.manager import PluginManager
from forecastbox.utility.auth import AuthContext
from forecastbox.utility.graph import topological_order
from forecastbox.utility.pydantic import FiabBaseModel

logger = logging.getLogger(__name__)


class Tag(FiabBaseModel):
    """A key-value tag that can be attached to a Blueprint.

    ``value`` is ``None`` for plain label tags; non-None for informational
    key=value pairs (e.g. the ``CoreVersionMismatch`` warning tag).
    """

    key: str
    value: str | None = None


class RoutedBlock(FiabBaseModel):
    """A block as stored and transmitted via the API: carries the full plugin routing factory id."""

    factory_id: PluginBlockFactoryId
    instance: BlockInstance

    @model_validator(mode="before")
    @classmethod
    def _compat_flat_format(cls, data: Any) -> Any:
        """Accept the legacy flat format where configuration_values and input_ids were top-level."""
        if isinstance(data, dict) and "instance" not in data and "factory_id" in data:
            return {
                "factory_id": data["factory_id"],
                "instance": {
                    "configuration_values": data.get("configuration_values", {}),
                    "input_ids": data.get("input_ids", {}),
                },
            }
        return data


class BlueprintBuilder(FiabBaseModel):
    # NOTE warning -- this class is used by the web api. Be careful about changes here
    blocks: dict[BlockInstanceId, RoutedBlock]
    environment: EnvironmentSpecification | None = None
    local_glyphs: dict[str, str] = Field(default_factory=dict)


class BlueprintSaveResult(FiabBaseModel):
    """Returned by save_builder; contains the stable id and the new version number."""

    blueprint_id: BlueprintId
    blueprint_version: int


class BlueprintRetrieveResult(FiabBaseModel):
    """Full payload returned by load_builder."""

    blueprint_id: BlueprintId
    blueprint_version: int
    builder: BlueprintBuilder
    display_name: str | None = None
    display_description: str | None = None
    tags: list[Tag] = Field(default_factory=list)
    parent_id: str | None = None
    fiabcore_major: int


class BlueprintValidationExpansion(FiabBaseModel):
    """Structured validation result and completion options for a BlueprintBuilder."""

    global_errors: list[str]
    block_errors: dict[BlockInstanceId, list[str]]
    possible_sources: list[PluginBlockFactoryId]
    possible_expansions: dict[BlockInstanceId, list[PluginBlockExpansion]]
    configuration_restrictions: dict[BlockInstanceId, dict[ConfigurationOptionId, str]] = Field(default_factory=dict)
    resolved_configuration_options: dict[BlockInstanceId, dict[ConfigurationOptionId, str]] = Field(default_factory=dict)
    missing_glyphs: dict[BlockInstanceId, dict[ConfigurationOptionId, list[str]]] = Field(default_factory=dict)
    block_output_qubes: dict[BlockInstanceId, dict[str, Any]] = Field(default_factory=dict)
    """Per-block output qube serialized via ``Qube.to_json()`` (qubed node
    tree), for visualizing the qube as it flows through the pipeline. Only
    populated for the expand endpoint (``validate_only`` False)."""


class BlueprintSaveCommand(FiabBaseModel):
    """Command payload for saving a blueprint builder."""

    builder: BlueprintBuilder
    display_name: str | None = None
    display_description: str | None = None
    tags: list[Tag] = Field(default_factory=list)
    parent_id: str | None = None


# ---------------------------------------------------------------------------
# Pure builder logic (formerly in api.blueprint)
# ---------------------------------------------------------------------------


async def validate_expand(
    blueprint: BlueprintBuilder, auth_context: AuthContext, *, validate_only: bool = False
) -> BlueprintValidationExpansion:
    """Validate and expand a partially-constructed BlueprintBuilder.

    Returns structured validation errors and possible completion options.
    The presence of errors does not affect the return (callers decide how to
    surface them). Intrinsic and global glyphs visible to the caller, along
    with local glyphs defined on the builder, are all considered known.

    When ``validate_only`` is True, ``possible_sources`` and
    ``possible_expansions`` are omitted from the result (saves work when the
    caller only needs error checking), and the blueprint is deep-copied so
    that ``resolve_configurations`` mutations do not affect the caller's object.
    When ``validate_only`` is False (the default, used by the expand endpoint),
    the passed-in blueprint may be mutated in place and expansion data is computed.
    """
    plugins = PluginManager.plugins
    if validate_only:
        blueprint = blueprint.model_copy(deep=True)
    possible_sources = (
        []
        if validate_only
        else [
            PluginBlockFactoryId(plugin=plugin_id, factory=block_factory_id)
            for plugin_id, plugin in plugins.items()
            for block_factory_id, block_factory in plugin.catalogue.factories.items()
            if block_factory.kind == "source" and not block_factory.inputs
        ]
    )
    possible_expansions: dict[BlockInstanceId, list[PluginBlockExpansion]] = {}
    configuration_restrictions: dict[BlockInstanceId, dict[ConfigurationOptionId, str]] = {}
    resolved_configuration_options: dict[BlockInstanceId, dict[ConfigurationOptionId, str]] = {}
    block_errors: dict[BlockInstanceId, list[str]] = defaultdict(list)
    missing_glyphs_result: dict[BlockInstanceId, dict[ConfigurationOptionId, list[str]]] = {}
    block_output_qubes: dict[BlockInstanceId, dict[str, Any]] = {}
    outputs = {}

    intrinsic_values = cast(dict[str, str], get_values_and_examples())
    global_buckets = await global_db.get_glyphs_for_resolution(auth_context)
    local_glyphs = blueprint.local_glyphs

    all_glyphs_raw = merge_glyph_values(
        intrinsic_values,
        global_buckets.public_overriddable,
        global_buckets.user_own,
        global_buckets.public_nonoverridable,
        local_glyphs,
        {},
    )
    available_glyphs = set(all_glyphs_raw.keys())

    global_errors: list[str] = []
    intrinsic_names = set(intrinsic_values.keys())
    colliding_keys = set(local_glyphs.keys()) & intrinsic_names
    for key in sorted(colliding_keys):
        global_errors.append(f"Local glyph key {key!r} is reserved as an intrinsic glyph and cannot be overridden.")

    try:
        all_glyphs = expand_glyph_values(all_glyphs_raw)
    except GlyphCircularReferenceError as e:
        global_errors.append(str(e))
        all_glyphs = all_glyphs_raw

    invalidable: set[BlockInstanceId] = set()
    visited: set[BlockInstanceId] = set()

    for blockId in topological_order(blueprint.blocks.items(), lambda block: block.instance.input_ids.values()):
        visited.add(blockId)
        routed = blueprint.blocks[blockId]
        plugin = plugins.get(routed.factory_id.plugin, None)
        if not plugin:
            block_errors[blockId] += ["Plugin not found"]
            invalidable.add(blockId)
            continue
        blockFactory = plugin.catalogue.factories.get(routed.factory_id.factory, None)
        if not blockFactory:
            block_errors[blockId] += ["BlockFactory not found in the catalogue"]
            invalidable.add(blockId)
            continue
        extraConfig = routed.instance.configuration_values.keys() - blockFactory.configuration_options.keys()
        if extraConfig:
            block_errors[blockId] += [f"Block contains extra config: {extraConfig}"]
        extract_result = resolution.extract_glyphs(routed.instance)
        if extract_result.e is not None:
            block_errors[blockId] += extract_result.e
            invalidable.add(blockId)
            continue
        extracted = cast(ExtractedGlyphs, extract_result.t)
        unknown_glyphs = extracted.glyphs - available_glyphs
        if unknown_glyphs:
            # Soft path: omit options referencing unknown glyphs and record them,
            # rather than failing the whole block.
            option_glyph_map = resolution.extract_glyphs_per_option(routed.instance)
            for opt_id, opt_glyphs in option_glyph_map.items():
                opt_unknown = opt_glyphs & unknown_glyphs
                if opt_unknown:
                    missing_glyphs_result.setdefault(blockId, {})[opt_id] = sorted(opt_unknown)
                    del routed.instance.configuration_values[opt_id]
            # Re-extract after removing affected options to get an accurate extracted state.
            extract_result = resolution.extract_glyphs(routed.instance)
            if extract_result.e is not None:
                block_errors[blockId] += extract_result.e
                invalidable.add(blockId)
                continue
            extracted = cast(ExtractedGlyphs, extract_result.t)
        try:
            resolution.resolve_configurations(routed.instance, all_glyphs)
        except Exception as exc:
            block_errors[blockId] += [f"Jinja expression error: {exc}"]
            invalidable.add(blockId)
            continue
        # A glyph value may itself reference an unknown glyph (e.g. myPath="${root}/${missing}").
        # After substitution those unresolved ${...} patterns survive in the config values;
        # a second extract_glyphs pass surfaces them.
        extract_after = resolution.extract_glyphs(routed.instance)
        nested_unknowns = cast(ExtractedGlyphs, extract_after.t).glyphs
        if nested_unknowns:
            # Soft path: omit options with unresolved nested glyph references.
            option_glyph_map_after = resolution.extract_glyphs_per_option(routed.instance)
            for opt_id, opt_glyphs in option_glyph_map_after.items():
                opt_nested = opt_glyphs & nested_unknowns
                if opt_nested:
                    block_opts = missing_glyphs_result.setdefault(blockId, {})
                    existing = set(block_opts.get(opt_id, []))
                    block_opts[opt_id] = sorted(existing | opt_nested)
                    del routed.instance.configuration_values[opt_id]
        # We dont want to return resolutions of nested glyphs, just the top levels. For this reason
        # we need to run the extraction twice, not just once after the substitution
        resolved_configuration_options[blockId] = {
            k: routed.instance.configuration_values[k] for k in extracted.glyphed_options if k in routed.instance.configuration_values
        }
        converted_values = convert_known_configuration_values(routed.instance, blockFactory)
        if converted_values.t is None:
            block_errors[blockId] += converted_values.e
            invalidable.add(blockId)
            continue
        routed.instance.configuration_values = converted_values.t

        if any(source_id in invalidable for source_id in routed.instance.input_ids.values()):
            invalidable.add(blockId)
            continue

        inputs = {input_id: outputs[source_id] for input_id, source_id in routed.instance.input_ids.items()}
        validation = plugin.validator(routed.factory_id.factory, routed.instance, inputs)
        output_or_error = validation.result
        restrictions = validation.restrictions
        if not validate_only and restrictions:
            configuration_restrictions[blockId] = {k: v.serialize() for k, v in restrictions.items()}
        if output_or_error.t is None:
            block_errors[blockId] += [output_or_error.e.reason]
            invalidable.add(blockId)
            continue
        outputs[blockId] = output_or_error.t

        # Serialize the block's output qube for the frontend qube lens. Best
        # effort only — a malformed/edge-case qube must never fail validation.
        if not validate_only and isinstance(output_or_error.t, QubedOutput):
            try:
                block_output_qubes[blockId] = output_or_error.t.dataqube.to_json()
            except Exception as exc:  # viz extra, never fatal
                logger.error(f"Could not serialize output qube for {blockId=}: {repr(exc)}")

        if not validate_only:
            possible_expansions[blockId] = (
                [
                    PluginBlockExpansion(
                        plugin=any_plugin_id,
                        factory=expansion.factory,
                        restrictions={k: v.serialize() for k, v in expansion.restrictions.items()},
                    )
                    for any_plugin_id, any_plugin in plugins.items()
                    for expansion in any_plugin.expander(output_or_error.t)
                ]
                if not isinstance(output_or_error.t, NoOutput)
                else []
            )

    # the topological search *omits* nodes in cycles or with missing ancestors -- thus we need to report and detect them
    for blockId, routed in blueprint.blocks.items():
        if blockId not in visited:
            missing = [source_id for source_id in routed.instance.input_ids.values() if source_id not in blueprint.blocks]
            if missing:
                block_errors[blockId] += [f"References non-existent block(s): {missing}"]
                invalidable.add(blockId)

    return BlueprintValidationExpansion(
        possible_sources=possible_sources,
        possible_expansions=possible_expansions,
        configuration_restrictions=configuration_restrictions,
        resolved_configuration_options=resolved_configuration_options,
        block_errors=block_errors,
        global_errors=global_errors,
        missing_glyphs=missing_glyphs_result,
        block_output_qubes=block_output_qubes,
    )


def template_to_builder(template: BlueprintTemplate, plugin_id: PluginCompositeId) -> BlueprintBuilder:
    """Convert a ``BlueprintTemplate`` to a ``BlueprintBuilder`` suitable for persistence.

    The local factory ids in template blocks are combined with the real plugin composite
    ID to produce routed blocks.  ``example_values`` and ``example_glyphs`` are
    intentionally not copied -- they are guiding-only data and must not appear
    in ``configuration_values``.
    """
    blocks: dict[BlockInstanceId, RoutedBlock] = {}
    for block_id, local_block in template.blocks.items():
        blocks[block_id] = RoutedBlock(
            factory_id=PluginBlockFactoryId(plugin=plugin_id, factory=local_block.factory_id),
            instance=BlockInstance(
                configuration_values=dict(local_block.instance.configuration_values),
                input_ids=dict(local_block.instance.input_ids),
            ),
        )
    environment: EnvironmentSpecification | None = None
    if template.environment is not None:
        environment = EnvironmentSpecification(
            environment_variables=template.environment.environment_variables,
        )
    return BlueprintBuilder(
        blocks=blocks,
        environment=environment,
        local_glyphs=dict(template.local_glyphs),
    )


def resolve_builder_with_examples(
    builder: BlueprintBuilder,
    example_values: dict[BlockInstanceId, dict[ConfigurationOptionId, str]],
    example_glyphs: dict[str, str],
) -> BlueprintBuilder:
    """Return a copy of ``builder`` with example values/glyphs overlaid for validation only.

    Example configuration values overlay the per-block ``configuration_values``;
    example glyphs are merged into ``local_glyphs``.  The result is fed to
    ``validate_expand(validate_only=True)``; it is never persisted.

    Overlay precedence: example values and glyphs **win** over any existing
    template value.  Templates are validated at install time, before the user
    has had a chance to fill in any values.  Template defaults (if any) may not
    be valid examples on their own, so example values are allowed to override
    them to produce a builder that passes validation.

    The function is pure: it operates on a deep copy of ``builder`` and never
    mutates the caller's object.
    """
    copy = builder.model_copy(deep=True)

    new_blocks: dict[BlockInstanceId, RoutedBlock] = {}
    for block_id, routed in copy.blocks.items():
        if block_id in example_values:
            # Merge: example values override existing template configuration values.
            merged_config = {**routed.instance.configuration_values, **example_values[block_id]}
            new_blocks[block_id] = routed.model_copy(
                update={"instance": routed.instance.model_copy(update={"configuration_values": merged_config})}
            )
        else:
            new_blocks[block_id] = routed

    # Merge example_glyphs into local_glyphs; example glyphs take precedence.
    merged_local_glyphs: dict[str, str] = {**copy.local_glyphs, **example_glyphs}

    return copy.model_copy(update={"blocks": new_blocks, "local_glyphs": merged_local_glyphs})


def remap_builder_glyphs(builder: BlueprintBuilder, mapping: dict[str, str]) -> BlueprintBuilder:
    """Return a copy of *builder* with all glyph identifier references renamed per *mapping*.

    Applied in a single non-recursive pass to:

    * every configuration option value string in every block (``${name}``
      references inside ``${...}`` expressions);
    * every local-glyph value string (same rename inside ``${...}``);
    * every local-glyph key: if the key itself is present in *mapping*, it is
      renamed to the mapped value.

    Returns *builder* unchanged (same object) when *mapping* is empty.
    """
    if not mapping:
        return builder

    new_blocks: dict[BlockInstanceId, RoutedBlock] = {}
    for block_id, routed in builder.blocks.items():
        new_config = {opt_id: remap_glyph_names(val, mapping) for opt_id, val in routed.instance.configuration_values.items()}
        new_blocks[block_id] = routed.model_copy(
            update={"instance": routed.instance.model_copy(update={"configuration_values": new_config})}
        )

    new_local_glyphs: dict[str, str] = {}
    for key, val in builder.local_glyphs.items():
        new_key = mapping.get(key, key)
        new_val = remap_glyph_names(val, mapping)
        new_local_glyphs[new_key] = new_val

    return builder.model_copy(update={"blocks": new_blocks, "local_glyphs": new_local_glyphs})


# ---------------------------------------------------------------------------
# Blueprint-aware service operations
# ---------------------------------------------------------------------------


async def save_builder(
    *,
    auth_context: AuthContext,
    payload: BlueprintSaveCommand,
    blueprint_id: BlueprintId | None = None,
    expected_version: int | None = None,
) -> BlueprintSaveResult:
    """Persist a BlueprintBuilder as a Blueprint and return the stable id and version.

    ``source`` is derived from ``display_name``: ``user_defined`` when a name is
    provided, ``oneoff_execution`` otherwise.
    When ``expected_version`` is provided it must match the current max version;
    raises ``BlueprintVersionConflict`` if it does not.
    Raises ``BlueprintNotFound`` or ``BlueprintAccessDenied`` from the db layer.
    """
    source: str = "user_defined" if payload.display_name is not None else "oneoff_execution"
    blueprint_id, version = await upsert_blueprint(
        auth_context=auth_context,
        blueprint_id=blueprint_id,
        source=source,
        created_by=auth_context.user_id,
        builder=payload.builder.model_dump(mode="json"),
        display_name=payload.display_name,
        display_description=payload.display_description,
        tags=[t.model_dump() for t in payload.tags] if payload.tags else None,
        parent_id=payload.parent_id,
        expected_version=expected_version,
    )
    return BlueprintSaveResult(blueprint_id=blueprint_id, blueprint_version=version)


async def load_builder(blueprint_id: BlueprintId, version: int | None = None) -> BlueprintRetrieveResult:
    """Load a Blueprint and return it as a BlueprintRetrieveResult.

    Raises ``BlueprintNotFound`` if the id does not exist or has no builder spec.
    """
    blueprint = await db.get_blueprint(blueprint_id, version)
    if blueprint is None:
        raise BlueprintNotFound(f"Blueprint {blueprint_id!r} not found.")
    if blueprint.builder is None:
        raise BlueprintNotFound(f"Blueprint {blueprint_id!r} has no builder spec.")
    builder = BlueprintBuilder.model_validate(blueprint.builder)
    raw_tags: list[dict] = blueprint.tags or []  # ty:ignore[invalid-argument-type,invalid-assignment]
    return BlueprintRetrieveResult(
        blueprint_id=BlueprintId(str(blueprint.blueprint_id)),  # ty:ignore[invalid-argument-type]
        blueprint_version=cast(int, blueprint.version),
        builder=builder,
        display_name=blueprint.display_name,  # ty:ignore[invalid-argument-type]
        display_description=blueprint.display_description,  # ty:ignore[invalid-argument-type]
        tags=[Tag.model_validate(t) for t in raw_tags],
        parent_id=blueprint.parent_id,  # ty:ignore[invalid-argument-type]
        fiabcore_major=cast(int, blueprint.fiabcore_major),
    )
