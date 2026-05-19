# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

from types import SimpleNamespace
from unittest.mock import patch

import pytest
from cascade.low.core import TaskId
from fiab_core.fable import BlockInstanceId

from forecastbox.domain.run.detail import (
    CompilationDetail,
    TaskDetail,
    _fluentName_to_taskId,
    fluentNode_to_detail,
    retrieve_compilation_detail,
    store_compilation_detail,
)
from forecastbox.domain.run.exceptions import CompilationDetailCorrupted, CompilationDetailNotFound
from forecastbox.domain.run.types import RunId

# ---------------------------------------------------------------------------
# TaskDetail
# ---------------------------------------------------------------------------


def test_task_detail_construction() -> None:
    td = TaskDetail(
        block=BlockInstanceId("my_sink"),
        display_name="some_func:abc123",
        parents=[TaskId("parent_task:xyz")],
    )
    assert td.block == BlockInstanceId("my_sink")
    assert td.display_name == "some_func:abc123"
    assert td.parents == [TaskId("parent_task:xyz")]


def test_task_detail_no_parents() -> None:
    td = TaskDetail(block=BlockInstanceId("source"), display_name="source_func:hash", parents=[])
    assert td.parents == []


# ---------------------------------------------------------------------------
# fluentNode_to_detail
# ---------------------------------------------------------------------------


def _make_node(name: str, parent_names: list[str]) -> SimpleNamespace:
    """Build a minimal earthkit-like Node stub."""
    parents = [SimpleNamespace(parent=SimpleNamespace(name=pname)) for pname in parent_names]
    inputs = {f"input{i}": p for i, p in enumerate(parents)}
    return SimpleNamespace(name=name, inputs=inputs)


def test_fluentNode_to_detail_source_node() -> None:
    """A source node has no inputs, so parents should be empty."""
    node = _make_node("source_42:abc123", [])
    task_id, detail = fluentNode_to_detail(node, BlockInstanceId("my_block"))  # type: ignore[arg-type]
    assert task_id == TaskId("source_42:abc123")
    assert detail.block == BlockInstanceId("my_block")
    assert detail.display_name == "source_42:abc123"
    assert detail.parents == []


def test_fluentNode_to_detail_sink_node_with_parent() -> None:
    """A sink node has one input whose parent name becomes its parent task_id."""
    node = _make_node("sink_file:def456", ["source_42:abc123"])
    task_id, detail = fluentNode_to_detail(node, BlockInstanceId("sink_block"))  # type: ignore[arg-type]
    assert task_id == TaskId("sink_file:def456")
    assert detail.block == BlockInstanceId("sink_block")
    assert detail.display_name == "sink_file:def456"
    assert detail.parents == [TaskId("source_42:abc123")]


def test_fluentNode_to_detail_multiple_parents() -> None:
    """A node with multiple inputs gets all parent task_ids."""
    node = _make_node("join_node:ghi789", ["left:aaa", "right:bbb"])
    _, detail = fluentNode_to_detail(node, BlockInstanceId("join_block"))  # type: ignore[arg-type]
    assert len(detail.parents) == 2
    assert TaskId("left:aaa") in detail.parents
    assert TaskId("right:bbb") in detail.parents


# ---------------------------------------------------------------------------
# CompilationDetail
# ---------------------------------------------------------------------------


def test_compilation_detail_defaults() -> None:
    detail = CompilationDetail()
    assert detail.task_detail == {}


def test_compilation_detail_with_task_detail() -> None:
    task_detail = {TaskId("task-a"): TaskDetail(block=BlockInstanceId("block-a"), display_name="func:hash", parents=[])}
    detail = CompilationDetail(task_detail=task_detail)
    assert detail.task_detail[TaskId("task-a")].display_name == "func:hash"


# ---------------------------------------------------------------------------
# store_compilation_detail / retrieve_compilation_detail
# ---------------------------------------------------------------------------


def test_store_and_retrieve_round_trip() -> None:
    run_id = RunId("test-run-id-2")
    task_detail = {TaskId("task-a"): TaskDetail(block=BlockInstanceId("block-a"), display_name="func:hash", parents=[])}
    detail = CompilationDetail(task_detail=task_detail)

    store_compilation_detail(run_id, detail)
    retrieved = retrieve_compilation_detail(run_id)

    assert retrieved.task_detail == task_detail


def test_retrieve_raises_not_found_for_missing_key() -> None:
    run_id = RunId("nonexistent-run-id")
    with patch("forecastbox.domain.run.detail.memcache_get", side_effect=KeyError("missing")):
        with pytest.raises(CompilationDetailNotFound, match="nonexistent-run-id"):
            retrieve_compilation_detail(run_id)


def test_retrieve_raises_corrupted_for_wrong_type() -> None:
    run_id = RunId("corrupted-run-id")
    with patch("forecastbox.domain.run.detail.memcache_get", side_effect=TypeError("wrong type")):
        with pytest.raises(CompilationDetailCorrupted, match="corrupted-run-id"):
            retrieve_compilation_detail(run_id)
