# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""A granular detail of a Run, including compilation-produced lookups and metadata."""

from cascade.low.core import TaskId
from earthkit.workflows.graph.nodes import Node
from fiab_core.fable import BlockInstanceId

from forecastbox.domain.run.exceptions import CompilationDetailCorrupted, CompilationDetailNotFound
from forecastbox.domain.run.types import RunId
from forecastbox.utility.memcache import get, insert
from forecastbox.utility.pydantic import FiabBaseModel


class TaskDetail(FiabBaseModel):
    """Task-level detail for a single node in the compiled graph."""

    block: BlockInstanceId
    display_name: str
    parents: list[TaskId]


class CompilationDetail(FiabBaseModel):
    """Detail produced by compilation of a BlueprintBuilder."""

    task_detail: dict[TaskId, TaskDetail] = {}


def _fluentName_to_taskId(name: str) -> TaskId:
    """Convert an earthkit node name to a TaskId.

    Centralises the name→TaskId conversion, which is currently a positional hack
    (node.name happens to equal the cascade TaskId string).
    """
    return TaskId(name)


def fluentNode_to_detail(node: Node, block: BlockInstanceId) -> tuple[TaskId, TaskDetail]:
    """Convert an earthkit.workflows Node to a (TaskId, TaskDetail) pair."""
    task_id = _fluentName_to_taskId(node.name)
    parents = [_fluentName_to_taskId(output.parent.name) for output in node.inputs.values()]
    # TODO retrieve display name from the fluent metadata if present, node.name should be fallback
    return task_id, TaskDetail(block=block, display_name=node.name, parents=parents)


def store_compilation_detail(run_id: RunId, compilation_detail: CompilationDetail) -> None:
    """Persist a CompilationDetail for the given run in the in-memory cache.

    May raise ``TooLargeEntry`` if the detail exceeds cache capacity.
    """
    insert(run_id, compilation_detail)


def retrieve_compilation_detail(run_id: RunId) -> CompilationDetail:
    """Retrieve the CompilationDetail for the given run from the in-memory cache.

    Raises
    ------
    CompilationDetailNotFound
        If no detail is cached for this run.
    CompilationDetailCorrupted
        If the cached value cannot be interpreted as a CompilationDetail.
    """
    try:
        return get(run_id, CompilationDetail)
    except KeyError:
        raise CompilationDetailNotFound(f"No compilation detail found for run {run_id!r}")
    except TypeError as e:
        raise CompilationDetailCorrupted(f"Compilation detail for run {run_id!r} is corrupted: {e}")
