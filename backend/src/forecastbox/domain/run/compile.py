# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Compilation of a BlueprintBuilder into an ExecutionSpecification."""

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import cast

from cascade.low.core import DatasetId, JobInstance, TaskId
from cascade.low.func import assert_never
from earthkit.workflows.compilers import graph2job
from earthkit.workflows.fluent import PayloadBuildingContext
from earthkit.workflows.graph import Graph, deduplicate_nodes
from fiab_core.artifacts import CompositeArtifactId
from fiab_core.fable import BlockInstanceId, BlockInstanceOutput, ConfigurationOptionId, NoOutput, RawOutput

from forecastbox.domain.artifact.compatibility import get_platform_info
from forecastbox.domain.blueprint.cascade import EnvironmentSpecification
from forecastbox.domain.blueprint.configuration_values import convert_known_configuration_values
from forecastbox.domain.blueprint.service import BlueprintBuilder
from forecastbox.domain.glyphs.intrinsic import AvailableIntrinsicGlyphs, get_values_and_examples
from forecastbox.domain.glyphs.resolution import ExtractedGlyphs, extract_glyphs, merge_glyph_values, resolve_configurations
from forecastbox.domain.plugin.state import PluginManager
from forecastbox.domain.run.cascade import ExecutionSpecification, RawCascadeJob, RunOutputCharacteristic, RunOutputs
from forecastbox.domain.run.detail import CompilationDetail, TaskDetail, _fluentName_to_taskId, fluentNode_to_detail
from forecastbox.domain.run.types import RunId
from forecastbox.utility.graph import topological_order
from forecastbox.utility.time import value_dt2str

logger = logging.getLogger(__name__)


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


def _hotfix_gpu_availability(job_instance: JobInstance) -> None:
    """If there is no gpu on the platform, remove all needs_gpu flags from the job.

    Rationale: scheduler always assigns needs_gpu tasks only to gpu workers, there is no
    middle ground or conditional decision making. Hence all existing plugins put
    `needs_gpu: True` to any task that benefits from a gpu, they have no way of expressing
    "nice_to_have_gpu". So on a gpu-less machine, the workflow cannot complete due to
    scheduler decision. We thus hotfix by removing the needs_gpu on such platform,
    relying that the user obeyed the is_locally_compatible flag on the Artifact, which
    additionally takes available memory into account.

    When needs_gpu becomes replaced by `profile(gpu_name|None) -> duration_or_infty`,
    we will remove this hotfix."""
    platform = get_platform_info()
    # unknown platform or gpu available => no need to hotfix
    if platform is None:
        return
    if platform.gpu_memory_mib is not None and platform.gpu_memory_mib > 0:
        return
    for taskInstance in job_instance.tasks.values():
        taskInstance.definition.needs_gpu = False


@dataclass(frozen=True, slots=True)
class CompilationResult:
    """Result of compiling a BlueprintBuilder into an ExecutionSpecification.

    ``execution_spec`` and ``run_outputs`` are the compiled cascade job and its declared
    external outputs, respectively (``execution_spec.job.job_instance.ext_outputs`` is set to
    the authoritative list of cascade external outputs -- previously a side effect of
    ``execute_cascade``).

    ``compilation_detail`` carries task-level lookups produced during compilation.

    ``resolved_configuration_options`` maps each block instance id to the subset of its
    configuration options that referenced at least one glyph, together with their final
    (post-resolution) string values. This is used to persist the resolution actually used
    at execution time, for later inspection/reproducibility. Options with an explicit null
    value carry no glyphs and are therefore not included.
    """

    execution_spec: ExecutionSpecification
    run_outputs: RunOutputs
    compilation_detail: CompilationDetail
    resolved_configuration_options: dict[BlockInstanceId, dict[ConfigurationOptionId, str | None]]


def compile_builder(blueprint: BlueprintBuilder, glyph_values: dict[str, str]) -> CompilationResult:
    """Compile a BlueprintBuilder into a CompilationResult.

    Raises ``ValueError`` if any block cannot be validated/compiled. When ``glyph_values`` is
    non-empty, ${glyph} patterns in configuration values are resolved before compilation.
    """
    graph = Graph([])
    plugins = PluginManager.plugins
    action_lookup = {}
    block_outputs: dict[BlockInstanceId, BlockInstanceOutput] = {}
    # Maps any produced cascade TaskId → TaskDetail.
    task_detail: dict[TaskId, TaskDetail] = {}
    # Maps sink block ids to mime type used in RunOutputs (only relevant for external outputs).
    block_to_mime: dict[BlockInstanceId, str] = {}
    sink_tasks: set[TaskId] = set()
    resolved_configuration_options: dict[BlockInstanceId, dict[ConfigurationOptionId, str | None]] = {}

    block_lookup = {b.instance_id: b for b in blueprint.blocks}

    for blockId in topological_order(block_lookup.items(), lambda block: block.instance.input_ids.values()):
        routable = block_lookup[blockId]
        plugin = plugins.get(routable.plugin, None)
        if not plugin:
            raise ValueError(f"plugin for {blockId=} not found: {routable.plugin}")
        block_factory = plugin.catalogue.factories[routable.factory]
        missing_config = sorted(block_factory.configuration_options.keys() - routable.instance.configuration_values.keys())
        if missing_config:
            raise ValueError(f"compile failed at {blockId=} with missing configuration options: {missing_config}")
        extract_result = extract_glyphs(routable.instance)
        if extract_result.e is not None:
            raise ValueError(f"compile failed at {blockId=} with {extract_result.e}")
        extracted = cast(ExtractedGlyphs, extract_result.t)
        resolve_configurations(routable.instance, glyph_values)
        resolved_configuration_options[blockId] = {
            k: routable.instance.configuration_values[k] for k in extracted.glyphed_options if k in routable.instance.configuration_values
        }
        converted_values = convert_known_configuration_values(routable.instance, block_factory)
        if converted_values.t is None:
            raise ValueError(f"compile failed at {blockId=} with {converted_values.e}")
        routable.instance.configuration_values = converted_values.t
        with PayloadBuildingContext(blockId=blockId):
            result = plugin.compiler(action_lookup, routable.factory, routable.instance)
        if result.t is None:
            raise ValueError(f"compile failed at {blockId=} with {result.e}")
        action_lookup[blockId] = result.t

        # TODO we run validation again just to get the block outputs, to determine mime types
        # This wasteful and redundant, ideally we'd return block output in the compile.
        # At this stage the validation should pass, but we still approach it defensively
        validator_inputs = {
            input_name: block_outputs[source_id]
            for input_name, source_id in routable.instance.input_ids.items()
            if source_id in block_outputs
        }
        try:
            validated = plugin.validator(routable.factory, routable.instance, validator_inputs).result
            if validated.t is None:
                raise ValueError(f"compile failed at {blockId=} with {validated.e}")
            block_outputs[blockId] = validated.t
        except Exception as e:
            raise ValueError(f"compile failed at {blockId=} with {e}")

        if block_factory.kind == "sink":
            block_graph = action_lookup[blockId].graph()

            sink_tasks.update(
                _fluentName_to_taskId(node.name)
                for node in block_graph.sinks
                if not node.name.startswith("run_as_earthkit")  # TODO this may not be relevant anymore -- verify on real workflows
            )

            block_output = block_outputs.get(blockId)
            if not isinstance(block_output, NoOutput):
                block_to_mime[blockId] = block_output.mime_type if isinstance(block_output, RawOutput) else "application/octet-stream"

            graph += block_graph

    graph = deduplicate_nodes(graph)
    for node in graph.nodes():
        metadata = getattr(node.payload, "metadata", None)
        if not isinstance(metadata, dict) or "blockId" not in metadata:
            raise ValueError(f"compile failed: missing blockId metadata on task {node.name}")
        task_block_id = metadata["blockId"]
        task_id, detail = fluentNode_to_detail(node, task_block_id)
        task_detail[task_id] = detail
    job_instance = graph2job(graph)
    _hotfix_gpu_availability(job_instance)

    job_instance.ext_outputs = [dataset_id for task_id in sink_tasks for dataset_id in job_instance.outputs_of(task_id)]

    run_outputs: dict[TaskId, RunOutputCharacteristic] = {
        task_id: RunOutputCharacteristic(
            original_block=task_detail[task_id].block,
            mime_type=block_to_mime[task_detail[task_id].block],
        )
        for task_id in sink_tasks
    }

    job = RawCascadeJob(job_type="raw_cascade_job", job_instance=job_instance)

    graph_artifacts = _get_artifacts_list(graph)
    if blueprint.environment is not None:
        merged_artifacts = list(set(blueprint.environment.runtime_artifacts).union(set(graph_artifacts)))
        environment = blueprint.environment.model_copy(update={"runtime_artifacts": merged_artifacts})
    else:
        environment = EnvironmentSpecification(runtime_artifacts=graph_artifacts)
    compilation_detail = CompilationDetail(task_detail=task_detail)
    return CompilationResult(
        execution_spec=ExecutionSpecification(job=job, environment=environment),
        run_outputs=RunOutputs(outputs=run_outputs),
        compilation_detail=compilation_detail,
        resolved_configuration_options=resolved_configuration_options,
    )
