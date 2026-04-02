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
from typing import Iterator, cast

from earthkit.workflows.compilers import graph2job
from earthkit.workflows.graph import Graph, deduplicate_nodes
from fiab_core.artifacts import CompositeArtifactId
from fiab_core.fable import (
    BlockFactoryId,
    BlockInstance,
    BlockInstanceId,
    BlockKind,
    PluginBlockFactoryId,
)
from pydantic import BaseModel

import forecastbox.domain.blueprint.db as _blueprint_db
from forecastbox.domain.blueprint.cascade import EnvironmentSpecification, ExecutionSpecification, RawCascadeJob
from forecastbox.domain.blueprint.db import upsert_blueprint
from forecastbox.domain.blueprint.exceptions import BlueprintNotFound
from forecastbox.domain.plugin.manager import PluginManager
from forecastbox.utility.auth import AuthContext

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


def _topological_order(blueprint: BlueprintBuilder) -> Iterator[BlockInstanceId]:
    remaining = {}
    children: dict[BlockInstanceId, list[BlockInstanceId]] = defaultdict(list)
    queue: list[BlockInstanceId] = []
    for blockId, blockInstance in blueprint.blocks.items():
        l = len(blockInstance.input_ids)
        if l == 0:
            queue.append(blockId)
        else:
            remaining[blockId] = l
        for parent in blockInstance.input_ids.values():
            children[parent].append(blockId)
    while queue:
        head = queue.pop(0)
        yield head
        for child in children[head]:
            remaining[child] -= 1
            if remaining[child] == 0:
                queue.append(child)


def validate_expand(blueprint: BlueprintBuilder) -> BlueprintValidationExpansion:
    """Validate and expand a partially-constructed BlueprintBuilder.

    Returns structured validation errors and possible completion options.
    The presence of errors does not affect the return (callers decide how to
    surface them).
    """
    plugins = PluginManager.plugins  # TODO we are avoiding a lock here! See the TODO at api/plugin.py
    possible_sources = [
        PluginBlockFactoryId(plugin=plugin_id, factory=block_factory_id)
        for plugin_id, plugin in plugins.items()
        for block_factory_id, block_factory in plugin.catalogue.factories.items()
        if block_factory.kind == "source" and not block_factory.inputs
    ]
    possible_expansions: dict[BlockInstanceId, list[PluginBlockFactoryId]] = {}
    block_errors: dict[BlockInstanceId, list[str]] = defaultdict(list)
    outputs = {}
    for blockId in _topological_order(blueprint):
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


def _get_artifacts_list(graph: Graph) -> list[CompositeArtifactId]:
    payloads = (node.payload for node in graph.nodes())
    artifactLists = (
        payload.metadata.get("artifacts", []) for payload in payloads if hasattr(payload, "metadata") and isinstance(payload.metadata, dict)
    )
    artifacts = set(
        artifact
        for artifactList in artifactLists
        if isinstance(artifactList, list)
        for artifact in artifactList
        if isinstance(artifact, CompositeArtifactId)
    )
    return list(artifacts)


def compile_builder(blueprint: BlueprintBuilder) -> ExecutionSpecification:
    """Compile a BlueprintBuilder into an ExecutionSpecification.

    Raises ``ValueError`` if any block cannot be compiled.
    """
    graph = Graph([])
    plugins = PluginManager.plugins
    action_lookup = {}

    for blockId in _topological_order(blueprint):
        blockInstance = blueprint.blocks[blockId]
        plugin = plugins.get(blockInstance.factory_id.plugin, None)
        if not plugin:
            logger.debug(f"plugin for {blockId=} not found: {blockInstance.factory_id.plugin}. Available plugins: {plugins.keys()}")
            raise ValueError(f"plugin for {blockId=} not found: {blockInstance.factory_id.plugin}")
        result = plugin.compiler(action_lookup, blockId, blockInstance)
        if result.t is None:
            raise ValueError(f"compile failed at {blockId=} with {result.e}")
        action_lookup[blockId] = result.t
        block_factory = plugin.catalogue.factories[blockInstance.factory_id.factory]
        if block_factory.kind == "sink":
            graph += action_lookup[blockId].graph()

    graph = deduplicate_nodes(graph)
    job_instance = graph2job(graph)
    job = RawCascadeJob(job_type="raw_cascade_job", job_instance=job_instance)

    graph_artifacts = _get_artifacts_list(graph)
    if blueprint.environment is not None:
        merged_artifacts = list(set(blueprint.environment.runtime_artifacts).union(set(graph_artifacts)))
        environment = blueprint.environment.model_copy(update={"runtime_artifacts": merged_artifacts})
    else:
        environment = EnvironmentSpecification(runtime_artifacts=graph_artifacts)
    return ExecutionSpecification(job=job, environment=environment)


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
