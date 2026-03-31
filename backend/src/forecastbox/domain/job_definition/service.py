# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Service layer for the job definition domain.

Owns:
- pure builder validation / expansion logic (formerly in ``api.fable``),
- pure builder compilation logic (formerly in ``api.fable``),
- saving a FableBuilder as a JobDefinition,
- loading a JobDefinition back into FableBuilder form,
- compiling a stored job definition to an ExecutionSpecification.

No HTTP exceptions are raised here; callers are responsible for mapping
``JobDefinitionNotFound`` and ``JobDefinitionAccessDenied`` to HTTP responses.
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

import forecastbox.domain.job_definition.db as _job_definition_db
from forecastbox.api.plugin.manager import PluginManager
from forecastbox.api.types.fable import (
    FableBuilder,
    FableCompileRequest,
    FableRetrieveResponse,
    FableSaveRequest,
    FableSaveResponse,
    FableValidationExpansion,
)
from forecastbox.api.types.jobs import EnvironmentSpecification, ExecutionSpecification, RawCascadeJob
from forecastbox.domain.job_definition.db import upsert_job_definition
from forecastbox.domain.job_definition.exceptions import JobDefinitionNotFound
from forecastbox.utility.auth import AuthContext

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Pure builder logic (formerly in api.fable)
# ---------------------------------------------------------------------------


def _topological_order(fable: FableBuilder) -> Iterator[BlockInstanceId]:
    remaining = {}
    children: dict[BlockInstanceId, list[BlockInstanceId]] = defaultdict(list)
    queue: list[BlockInstanceId] = []
    for blockId, blockInstance in fable.blocks.items():
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


def validate_expand(fable: FableBuilder) -> FableValidationExpansion:
    """Validate and expand a partially-constructed FableBuilder.

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
    for blockId in _topological_order(fable):
        blockInstance = fable.blocks[blockId]
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

    return FableValidationExpansion(
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


def compile_builder(fable: FableBuilder) -> ExecutionSpecification:
    """Compile a FableBuilder into an ExecutionSpecification.

    Raises ``ValueError`` if any block cannot be compiled.
    """
    graph = Graph([])
    plugins = PluginManager.plugins
    action_lookup = {}

    for blockId in _topological_order(fable):
        blockInstance = fable.blocks[blockId]
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
    if fable.environment is not None:
        merged_artifacts = list(set(fable.environment.runtime_artifacts).union(set(graph_artifacts)))
        environment = fable.environment.model_copy(update={"runtime_artifacts": merged_artifacts})
    else:
        environment = EnvironmentSpecification(runtime_artifacts=graph_artifacts)
    return ExecutionSpecification(job=job, environment=environment)


# ---------------------------------------------------------------------------
# Definition-aware service operations
# ---------------------------------------------------------------------------


async def save_builder(
    *,
    auth_context: AuthContext,
    payload: FableSaveRequest,
    fable_id: str | None = None,
) -> FableSaveResponse:
    """Persist a FableBuilder as a JobDefinition and return the stable id and version.

    ``source`` is derived from ``display_name``: ``user_defined`` when a name is
    provided, ``oneoff_execution`` otherwise.
    Raises ``JobDefinitionNotFound`` or ``JobDefinitionAccessDenied`` from the db layer.
    """
    source: str = "user_defined" if payload.display_name is not None else "oneoff_execution"
    env = payload.builder.environment
    definition_id, version = await upsert_job_definition(
        auth_context=auth_context,
        definition_id=fable_id,
        source=source,  # ty:ignore[arg-type]
        created_by=auth_context.user_id,
        blocks=payload.builder.model_dump(mode="json")["blocks"],
        environment_spec=env.model_dump(mode="json") if env is not None else None,
        display_name=payload.display_name,
        display_description=payload.display_description,
        tags=payload.tags if payload.tags else None,
        parent_id=payload.parent_id,
    )
    return FableSaveResponse(id=definition_id, version=version)


async def load_builder(fable_id: str, version: int | None = None) -> FableRetrieveResponse:
    """Load a JobDefinition and return it as a FableRetrieveResponse.

    Raises ``JobDefinitionNotFound`` if the id does not exist or has no builder spec.
    """
    job_definition = await _job_definition_db.get_job_definition(fable_id, version)
    if job_definition is None:
        raise JobDefinitionNotFound(f"Fable job definition {fable_id!r} not found.")
    if job_definition.blocks is None:
        raise JobDefinitionNotFound(f"Fable job definition {fable_id!r} has no builder spec.")
    builder = FableBuilder(blocks=job_definition.blocks)  # ty:ignore[invalid-argument-type]
    if job_definition.environment_spec is not None:
        builder.environment = EnvironmentSpecification.model_validate(job_definition.environment_spec)
    return FableRetrieveResponse(
        id=job_definition.job_definition_id,  # ty:ignore[invalid-argument-type]
        version=job_definition.version,  # ty:ignore[invalid-argument-type]
        builder=builder,
        display_name=job_definition.display_name,  # ty:ignore[invalid-argument-type]
        display_description=job_definition.display_description,  # ty:ignore[invalid-argument-type]
        tags=job_definition.tags or [],  # ty:ignore[invalid-argument-type]
        parent_id=job_definition.parent_id,  # ty:ignore[invalid-argument-type]
    )


async def compile_definition(fable_id: str, version: int | None = None) -> ExecutionSpecification:
    """Load a stored job definition and compile it to an ExecutionSpecification.

    Raises ``JobDefinitionNotFound`` if the id does not exist or has no builder spec.
    Raises ``ValueError`` if compilation fails.
    """
    job_definition = await _job_definition_db.get_job_definition(fable_id, version)
    if job_definition is None:
        raise JobDefinitionNotFound(f"Fable job definition {fable_id!r} not found.")
    if job_definition.blocks is None:
        raise JobDefinitionNotFound(f"Fable job definition {fable_id!r} has no builder spec.")
    builder = FableBuilder(blocks=job_definition.blocks)  # ty:ignore[invalid-argument-type]
    if job_definition.environment_spec is not None:
        builder.environment = EnvironmentSpecification.model_validate(job_definition.environment_spec)
    return compile_builder(builder)
