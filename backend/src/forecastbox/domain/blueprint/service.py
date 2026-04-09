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
from typing import cast

from fiab_core.fable import (
    BlockFactoryId,
    BlockInstance,
    BlockInstanceId,
    BlockKind,
    PluginBlockFactoryId,
)
from pydantic import BaseModel

import forecastbox.domain.blueprint.db as _blueprint_db
import forecastbox.domain.glyphs.global_db as global_glyph_db
import forecastbox.domain.glyphs.resolution as glyph_resolution
from forecastbox.domain.blueprint.cascade import EnvironmentSpecification
from forecastbox.domain.blueprint.db import upsert_blueprint
from forecastbox.domain.blueprint.exceptions import BlueprintNotFound
from forecastbox.domain.glyphs.intrinsic import get_values_and_examples
from forecastbox.domain.plugin.manager import PluginManager
from forecastbox.utility.auth import AuthContext
from forecastbox.utility.graph import topological_order

logger = logging.getLogger(__name__)


class BlueprintBuilder(BaseModel):
    # NOTE warning -- this class is used by the web api. Be careful about changes here
    blocks: dict[BlockInstanceId, BlockInstance]
    environment: EnvironmentSpecification | None = None


class BlueprintSaveResult(BaseModel):
    """Returned by save_builder; contains the stable id and the new version number."""

    blueprint_id: str
    blueprint_version: int


class BlueprintRetrieveResult(BaseModel):
    """Full payload returned by load_builder."""

    blueprint_id: str
    blueprint_version: int
    builder: BlueprintBuilder
    display_name: str | None = None
    display_description: str | None = None
    tags: list[str] = []
    parent_id: str | None = None


class BlueprintValidationExpansion(BaseModel):
    """Structured validation result and completion options for a BlueprintBuilder."""

    global_errors: list[str]
    block_errors: dict[BlockInstanceId, list[str]]
    possible_sources: list[PluginBlockFactoryId]
    possible_expansions: dict[BlockInstanceId, list[PluginBlockFactoryId]]


class BlueprintSaveCommand(BaseModel):
    """Command payload for saving a blueprint builder."""

    builder: BlueprintBuilder
    display_name: str | None = None
    display_description: str | None = None
    tags: list[str] = []
    parent_id: str | None = None


# ---------------------------------------------------------------------------
# Pure builder logic (formerly in api.blueprint)
# ---------------------------------------------------------------------------


async def validate_expand(blueprint: BlueprintBuilder, auth_context: AuthContext) -> BlueprintValidationExpansion:
    """Validate and expand a partially-constructed BlueprintBuilder.

    Returns structured validation errors and possible completion options.
    The presence of errors does not affect the return (callers decide how to
    surface them). Intrinsic and global glyphs visible to the caller are both
    considered known.
    """
    plugins = PluginManager.plugins
    possible_sources = [
        PluginBlockFactoryId(plugin=plugin_id, factory=block_factory_id)
        for plugin_id, plugin in plugins.items()
        for block_factory_id, block_factory in plugin.catalogue.factories.items()
        if block_factory.kind == "source" and not block_factory.inputs
    ]
    possible_expansions: dict[BlockInstanceId, list[PluginBlockFactoryId]] = {}
    block_errors: dict[BlockInstanceId, list[str]] = defaultdict(list)
    outputs = {}
    global_glyphs = {str(row.key): str(row.value) for row in await global_glyph_db.list_global_glyphs(auth_context)}
    available_glyphs = set(get_values_and_examples().keys()).union(global_glyphs.keys())
    glyph_values: dict[str, str] = {**global_glyphs, **cast(dict[str, str], get_values_and_examples())}
    for blockId in topological_order(blueprint.blocks.items(), lambda block: block.input_ids.values()):
        blockInstance = blueprint.blocks[blockId]
        plugin = plugins.get(blockInstance.factory_id.plugin, None)
        if not plugin:
            block_errors[blockId] += ["Plugin not found"]
            continue
        blockFactory = plugin.catalogue.factories.get(blockInstance.factory_id.factory, None)
        if not blockFactory:
            block_errors[blockId] += ["BlockFactory not found in the catalogue"]
            continue
        extraConfig = blockInstance.configuration_values.keys() - blockFactory.configuration_options.keys()
        if extraConfig:
            block_errors[blockId] += [f"Block contains extra config: {extraConfig}"]
        missingConfig = blockFactory.configuration_options.keys() - blockInstance.configuration_values.keys()
        if missingConfig:
            # TODO most likely disable this, we would inject defaults at the compile level
            block_errors[blockId] += [f"Block contains missing config: {missingConfig}"]

        extract_result = glyph_resolution.extract_glyphs(blockInstance)
        if extract_result.e is not None:
            block_errors[blockId] += extract_result.e
            continue
        extracted_glyphs = cast(set[str], extract_result.t)
        unknown_glyphs = extracted_glyphs - available_glyphs
        if unknown_glyphs:
            block_errors[blockId] += [f"Unknown glyphs referenced: {unknown_glyphs}"]
            continue
        glyph_resolution.resolve_configurations(blockInstance, glyph_values)

        inputs = {input_id: outputs[source_id] for input_id, source_id in blockInstance.input_ids.items()}
        output_or_error = plugin.validator(blockInstance, inputs)
        if output_or_error.t is None:
            block_errors[blockId] += [cast(str, output_or_error.e)]
            continue
        outputs[blockId] = output_or_error.t

        possible_expansions[blockId] = [
            PluginBlockFactoryId(plugin=any_plugin_id, factory=block_factory_id)
            for any_plugin_id, any_plugin in plugins.items()
            for block_factory_id in any_plugin.expander(output_or_error.t)
        ]

    global_errors: list[str] = []

    return BlueprintValidationExpansion(
        possible_sources=possible_sources,
        possible_expansions=possible_expansions,
        block_errors=block_errors,
        global_errors=global_errors,
    )


# ---------------------------------------------------------------------------
# Blueprint-aware service operations
# ---------------------------------------------------------------------------


async def save_builder(
    *,
    auth_context: AuthContext,
    payload: BlueprintSaveCommand,
    blueprint_id: str | None = None,
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
    env = payload.builder.environment
    blueprint_id, version = await upsert_blueprint(
        auth_context=auth_context,
        blueprint_id=blueprint_id,
        source=source,
        created_by=auth_context.user_id,
        blocks=payload.builder.model_dump(mode="json")["blocks"],
        environment_spec=env.model_dump(mode="json") if env is not None else None,
        display_name=payload.display_name,
        display_description=payload.display_description,
        tags=payload.tags if payload.tags else None,
        parent_id=payload.parent_id,
        expected_version=expected_version,
    )
    return BlueprintSaveResult(blueprint_id=blueprint_id, blueprint_version=version)


async def load_builder(blueprint_id: str, version: int | None = None) -> BlueprintRetrieveResult:
    """Load a Blueprint and return it as a BlueprintRetrieveResult.

    Raises ``BlueprintNotFound`` if the id does not exist or has no builder spec.
    """
    blueprint = await _blueprint_db.get_blueprint(blueprint_id, version)
    if blueprint is None:
        raise BlueprintNotFound(f"Blueprint {blueprint_id!r} not found.")
    if blueprint.blocks is None:
        raise BlueprintNotFound(f"Blueprint {blueprint_id!r} has no builder spec.")
    builder = BlueprintBuilder(blocks=blueprint.blocks)  # ty:ignore[invalid-argument-type]
    if blueprint.environment_spec is not None:
        builder.environment = EnvironmentSpecification.model_validate(blueprint.environment_spec)
    return BlueprintRetrieveResult(
        blueprint_id=str(blueprint.blueprint_id),  # ty:ignore[invalid-argument-type]
        blueprint_version=cast(int, blueprint.version),
        builder=builder,
        display_name=blueprint.display_name,  # ty:ignore[invalid-argument-type]
        display_description=blueprint.display_description,  # ty:ignore[invalid-argument-type]
        tags=blueprint.tags or [],  # ty:ignore[invalid-argument-type]
        parent_id=blueprint.parent_id,  # ty:ignore[invalid-argument-type]
    )
