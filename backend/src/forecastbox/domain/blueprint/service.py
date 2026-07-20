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

import datetime as dt
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
    BlueprintTemplateExampleInput,
    ConfigurationOptionId,
    NoOutput,
    PluginCompositeId,
    QubedOutput,
)
from pydantic import Field

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
from forecastbox.utility.time import value_dt2str

logger = logging.getLogger(__name__)


class Tag(FiabBaseModel):
    """A key-value tag that can be attached to a Blueprint.

    ``value`` is ``None`` for plain label tags; non-None for informational
    key=value pairs (e.g. the ``CoreVersionMismatch`` warning tag).
    """

    key: str
    value: str | None = None


class PluginBlockFactoryId(FiabBaseModel):
    """Routing key combining plugin identity with a local factory id.

    Used in API responses (possible_sources) and expansion results to give
    clients the full address of a block factory across all installed plugins.
    Plugin authors never construct or consume this class directly.
    """

    plugin: PluginCompositeId
    factory: BlockFactoryId


class SerializedBlockExpansion(FiabBaseModel):
    """Expansion result as returned to clients, combining plugin identity with restrictions.

    This is the service-level representation sent to API consumers, containing
    the full plugin composite id, factory id, and serialized restriction types.
    """

    plugin: PluginCompositeId
    factory: BlockFactoryId
    restrictions: dict[ConfigurationOptionId, str] = Field(default_factory=dict)
    """Serialized FableType restrictions (e.g., 'int', "enumClosed['a','b']")"""


class RoutableBlock(FiabBaseModel):
    """A block as stored and transmitted via the API.

    Flat structure: carries the block's own identity (instance_id), its full
    routing address (plugin + factory), and its content (instance).
    """

    instance_id: BlockInstanceId
    plugin: PluginCompositeId
    factory: BlockFactoryId
    instance: BlockInstance


class BlueprintBuilder(FiabBaseModel):
    # NOTE warning -- this class is used by the web api. Be careful about changes here
    blocks: list[RoutableBlock] = Field(default_factory=list)
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
    source: str
    fiabcore_major: int
    created_at: str
    """Creation time of the first version of this blueprint entity."""
    updated_at: str
    """Creation time of the returned version."""
    user: str
    """Owner of this blueprint entity."""


class BlueprintValidationExpansion(FiabBaseModel):
    """Structured validation result and completion options for a BlueprintBuilder."""

    global_errors: list[str]
    block_errors: dict[BlockInstanceId, list[str]]
    possible_sources: list[PluginBlockFactoryId]
    possible_expansions: dict[BlockInstanceId, list[SerializedBlockExpansion]]
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
    possible_expansions: dict[BlockInstanceId, list[SerializedBlockExpansion]] = {}
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

    # Build lookup and detect duplicate instance ids.
    block_lookup: dict[BlockInstanceId, RoutableBlock] = {}
    for routable in blueprint.blocks:
        if routable.instance_id in block_lookup:
            global_errors.append(f"Duplicate block instance id: {routable.instance_id!r}")
        else:
            block_lookup[routable.instance_id] = routable

    try:
        all_glyphs = expand_glyph_values(all_glyphs_raw)
    except GlyphCircularReferenceError as e:
        global_errors.append(str(e))
        all_glyphs = all_glyphs_raw

    invalidable: set[BlockInstanceId] = set()
    visited: set[BlockInstanceId] = set()

    for blockId in topological_order(block_lookup.items(), lambda block: block.instance.input_ids.values()):
        visited.add(blockId)
        routable = block_lookup[blockId]
        plugin = plugins.get(routable.plugin, None)
        if not plugin:
            block_errors[blockId] += ["Plugin not found"]
            invalidable.add(blockId)
            continue
        blockFactory = plugin.catalogue.factories.get(routable.factory, None)
        if not blockFactory:
            block_errors[blockId] += ["BlockFactory not found in the catalogue"]
            invalidable.add(blockId)
            continue
        extraConfig = routable.instance.configuration_values.keys() - blockFactory.configuration_options.keys()
        if extraConfig:
            block_errors[blockId] += [f"Block contains extra config: {extraConfig}"]
        extract_result = resolution.extract_glyphs(routable.instance)
        if extract_result.e is not None:
            block_errors[blockId] += extract_result.e
            invalidable.add(blockId)
            continue
        extracted = cast(ExtractedGlyphs, extract_result.t)
        unknown_glyphs = extracted.glyphs - available_glyphs
        if unknown_glyphs:
            # Soft path: omit options referencing unknown glyphs and record them,
            # rather than failing the whole block.
            option_glyph_map = resolution.extract_glyphs_per_option(routable.instance)
            for opt_id, opt_glyphs in option_glyph_map.items():
                opt_unknown = opt_glyphs & unknown_glyphs
                if opt_unknown:
                    missing_glyphs_result.setdefault(blockId, {})[opt_id] = sorted(opt_unknown)
                    del routable.instance.configuration_values[opt_id]
            # Re-extract after removing affected options to get an accurate extracted state.
            extract_result = resolution.extract_glyphs(routable.instance)
            if extract_result.e is not None:
                block_errors[blockId] += extract_result.e
                invalidable.add(blockId)
                continue
            extracted = cast(ExtractedGlyphs, extract_result.t)
        try:
            resolution.resolve_configurations(routable.instance, all_glyphs)
        except Exception as exc:
            block_errors[blockId] += [f"Jinja expression error: {exc}"]
            invalidable.add(blockId)
            continue
        # A glyph value may itself reference an unknown glyph (e.g. myPath="${root}/${missing}").
        # After substitution those unresolved ${...} patterns survive in the config values;
        # a second extract_glyphs pass surfaces them.
        extract_after = resolution.extract_glyphs(routable.instance)
        nested_unknowns = cast(ExtractedGlyphs, extract_after.t).glyphs
        if nested_unknowns:
            # Soft path: omit options with unresolved nested glyph references.
            option_glyph_map_after = resolution.extract_glyphs_per_option(routable.instance)
            for opt_id, opt_glyphs in option_glyph_map_after.items():
                opt_nested = opt_glyphs & nested_unknowns
                if opt_nested:
                    block_opts = missing_glyphs_result.setdefault(blockId, {})
                    existing = set(block_opts.get(opt_id, []))
                    block_opts[opt_id] = sorted(existing | opt_nested)
                    del routable.instance.configuration_values[opt_id]
        # We dont want to return resolutions of nested glyphs, just the top levels. For this reason
        # we need to run the extraction twice, not just once after the substitution
        resolved_configuration_options[blockId] = {
            k: routable.instance.configuration_values[k] for k in extracted.glyphed_options if k in routable.instance.configuration_values
        }
        converted_values = convert_known_configuration_values(routable.instance, blockFactory)
        if converted_values.t is None:
            block_errors[blockId] += converted_values.e
            invalidable.add(blockId)
            continue
        routable.instance.configuration_values = converted_values.t

        if any(source_id in invalidable for source_id in routable.instance.input_ids.values()):
            invalidable.add(blockId)
            continue

        inputs = {input_id: outputs[source_id] for input_id, source_id in routable.instance.input_ids.items()}
        validation = plugin.validator(routable.factory, routable.instance, inputs)
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
                    SerializedBlockExpansion(
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
    for blockId, routable in block_lookup.items():
        if blockId not in visited:
            missing = [source_id for source_id in routable.instance.input_ids.values() if source_id not in block_lookup]
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
    blocks: list[RoutableBlock] = []
    for block_id, template_block in template.blocks.items():
        blocks.append(
            RoutableBlock(
                instance_id=block_id,
                plugin=plugin_id,
                factory=template_block.factory_id,
                instance=BlockInstance(
                    configuration_values=dict(template_block.instance.configuration_values),
                    input_ids=dict(template_block.instance.input_ids),
                ),
            )
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
    example_values: dict[BlockInstanceId, dict[ConfigurationOptionId, BlueprintTemplateExampleInput]],
    example_glyphs: dict[str, BlueprintTemplateExampleInput],
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

    new_blocks: list[RoutableBlock] = []
    for routable in copy.blocks:
        if routable.instance_id in example_values:
            # Merge: example values override existing template configuration values.
            # Only the example_value string is used for execution; the other fields
            # (display_name, display_description, type_hint) are UI metadata only.
            example_str_values = {opt: inp.example_value for opt, inp in example_values[routable.instance_id].items()}
            merged_config = {**routable.instance.configuration_values, **example_str_values}
            new_blocks.append(
                routable.model_copy(update={"instance": routable.instance.model_copy(update={"configuration_values": merged_config})})
            )
        else:
            new_blocks.append(routable)

    # Merge example_glyphs into local_glyphs; example glyphs take precedence.
    merged_local_glyphs: dict[str, str] = {**copy.local_glyphs, **{k: v.example_value for k, v in example_glyphs.items()}}

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

    new_blocks: list[RoutableBlock] = []
    for routable in builder.blocks:
        new_config = {opt_id: remap_glyph_names(val, mapping) for opt_id, val in routable.instance.configuration_values.items()}
        new_blocks.append(
            routable.model_copy(update={"instance": routable.instance.model_copy(update={"configuration_values": new_config})})
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


async def load_builder(blueprint_id: BlueprintId, version: int | None, auth_context: AuthContext) -> BlueprintRetrieveResult:
    """Load a Blueprint and return it as a BlueprintRetrieveResult.

    Applies the same ownership scoping as ``list_blueprints`` -- a caller may only
    load a blueprint they own, a plugin template, or (if admin) any blueprint.
    Raises ``BlueprintNotFound`` if the id does not exist, is not visible to
    ``auth_context``, or has no builder spec.
    """
    results = list(await db.list_blueprints(auth_context=auth_context, blueprint_id=blueprint_id, version=version, limit=1))
    if not results:
        raise BlueprintNotFound(f"Blueprint {blueprint_id!r} not found.")
    latest = results[0]
    blueprint = latest.blueprint
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
        source=cast(str, blueprint.source),
        fiabcore_major=cast(int, blueprint.fiabcore_major),
        created_at=value_dt2str(latest.created_at),
        updated_at=value_dt2str(cast(dt.datetime, blueprint.created_at)),
        user=cast(str, blueprint.created_by),
    )
