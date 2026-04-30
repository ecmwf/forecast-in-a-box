# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Compilation of a BlueprintBuilder into an ExecutionSpecification."""

from datetime import datetime
from typing import cast

from cascade.low.core import DatasetId, TaskId
from cascade.low.func import assert_never
from earthkit.workflows.compilers import graph2job
from earthkit.workflows.graph import Graph, deduplicate_nodes
from fiab_core.artifacts import CompositeArtifactId
from fiab_core.fable import BlockInstanceId, BlockInstanceOutput, NoOutput, RawOutput

from forecastbox.domain.blueprint.cascade import EnvironmentSpecification
from forecastbox.domain.blueprint.service import BlueprintBuilder
from forecastbox.domain.glyphs.intrinsic import AvailableIntrinsicGlyphs, get_values_and_examples
from forecastbox.domain.glyphs.resolution import merge_glyph_values, resolve_configurations, value_dt2str
from forecastbox.domain.plugin.manager import PluginManager
from forecastbox.domain.run.cascade import ExecutionSpecification, RawCascadeJob, RunOutputCharacteristic, RunOutputs
from forecastbox.domain.run.types import RunId
from forecastbox.utility.graph import topological_order


def resolve_intrinsic_glyph_values(
    run_id: RunId, submit_datetime: datetime, start_datetime: datetime, attempt_count: int
) -> dict[AvailableIntrinsicGlyphs, str]:
    """Build a mapping of all intrinsic glyph names to their runtime values.

    ``submitDatetime`` is set to ``submit_datetime`` and is preserved across restarts
    (callers pass the original first-run time on retry).  ``startDatetime`` is set to
    ``start_datetime`` (the moment execution actually begins), so restarts see a fresh value.
    ``attemptCount`` is the current attempt number, incremented on every restart.
    """
    resolved: dict[AvailableIntrinsicGlyphs, str] = {}
    for var in get_values_and_examples():
        if var == "runId":
            resolved[var] = run_id
        elif var == "submitDatetime":
            resolved[var] = value_dt2str(submit_datetime)
        elif var == "startDatetime":
            resolved[var] = value_dt2str(start_datetime)
        elif var == "attemptCount":
            resolved[var] = str(attempt_count)
        else:
            assert_never(var)
    return resolved


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


def compile_builder(blueprint: BlueprintBuilder, glyph_values: dict[str, str]) -> tuple[ExecutionSpecification, RunOutputs]:
    """Compile a BlueprintBuilder into an ExecutionSpecification and RunOutputs.

    Raises ``ValueError`` if any block cannot be validated/compiled. When ``glyph_values`` is
    non-empty, ${glyph} patterns in configuration values are resolved before compilation.

    Sets ``job_instance.ext_outputs`` to the authoritative list of cascade external
    outputs (previously a side effect of ``execute_cascade``).
    """
    graph = Graph([])
    plugins = PluginManager.plugins
    action_lookup = {}
    block_outputs: dict[BlockInstanceId, BlockInstanceOutput] = {}
    # Maps cascade TaskId (node.name) → (originating BlockInstanceId, mime_type)
    sink_task_to_block: dict[TaskId, tuple[BlockInstanceId, str]] = {}

    for blockId in topological_order(blueprint.blocks.items(), lambda block: block.input_ids.values()):
        blockInstance = blueprint.blocks[blockId]
        plugin = plugins.get(blockInstance.factory_id.plugin, None)
        if not plugin:
            raise ValueError(f"plugin for {blockId=} not found: {blockInstance.factory_id.plugin}")
        resolve_configurations(blockInstance, glyph_values)
        result = plugin.compiler(action_lookup, blockId, blockInstance)
        if result.t is None:
            raise ValueError(f"compile failed at {blockId=} with {result.e}")
        action_lookup[blockId] = result.t

        # TODO we run validation again just to get the block outputs, to determine mime types
        # This wasteful and redundant, ideally we'd return block output in the compile.
        # At this stage the validation should pass, but we still approach it defensively
        validator_inputs = {
            input_name: block_outputs[source_id] for input_name, source_id in blockInstance.input_ids.items() if source_id in block_outputs
        }
        try:
            validated = plugin.validator(blockInstance, validator_inputs)
            if validated.t is None:
                raise ValueError(f"compile failed at {blockId=} with {validated.e}")
            block_outputs[blockId] = validated.t
        except Exception as e:
            raise ValueError(f"compile failed at {blockId=} with {e}")

        block_factory = plugin.catalogue.factories[blockInstance.factory_id.factory]
        if block_factory.kind == "sink":
            sink_graph = action_lookup[blockId].graph()
            block_output = block_outputs.get(blockId)
            if not isinstance(block_output, NoOutput):
                mime_type = block_output.mime_type if isinstance(block_output, RawOutput) else "application/octet-stream"
                for node in sink_graph.sinks:
                    # TODO this may not be relevant anymore -- verify on real workflows
                    if node.name.startswith("run_as_earthkit"):
                        continue
                    task_id = cast(TaskId, node.name)  # TODO hack -- expose a proper interface for the name→taskId conversion in cascade
                    sink_task_to_block[task_id] = (blockId, mime_type)
            graph += sink_graph

    graph = deduplicate_nodes(graph)
    job_instance = graph2job(graph)

    job_instance.ext_outputs = [dataset_id for task_id in sink_task_to_block for dataset_id in job_instance.outputs_of(task_id)]

    run_outputs: dict[TaskId, RunOutputCharacteristic] = {
        task_id: RunOutputCharacteristic(original_block=block_id, mime_type=mime_type)
        for task_id, (block_id, mime_type) in sink_task_to_block.items()
    }

    job = RawCascadeJob(job_type="raw_cascade_job", job_instance=job_instance)

    graph_artifacts = _get_artifacts_list(graph)
    if blueprint.environment is not None:
        merged_artifacts = list(set(blueprint.environment.runtime_artifacts).union(set(graph_artifacts)))
        environment = blueprint.environment.model_copy(update={"runtime_artifacts": merged_artifacts})
    else:
        environment = EnvironmentSpecification(runtime_artifacts=graph_artifacts)
    return ExecutionSpecification(job=job, environment=environment), RunOutputs(outputs=run_outputs)
