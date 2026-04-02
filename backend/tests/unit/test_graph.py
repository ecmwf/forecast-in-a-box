# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for forecastbox.utility.graph."""

from forecastbox.utility.graph import topological_order


def _graph(edges: dict[str, list[str]]) -> list[tuple[str, list[str]]]:
    """Build a (node_id, parents) list from a {node_id: [parent_ids]} dict."""
    return list(edges.items())


def _topo(edges: dict[str, list[str]]) -> list[str]:
    return list(topological_order(_graph(edges), lambda parents: parents))


def _precedes(result: list[str], before: str, after: str) -> bool:
    return result.index(before) < result.index(after)


def test_empty_graph() -> None:
    assert _topo({}) == []


def test_single_node() -> None:
    assert _topo({"A": []}) == ["A"]


def test_linear_chain() -> None:
    # C depends on B depends on A
    result = _topo({"A": [], "B": ["A"], "C": ["B"]})
    assert result == ["A", "B", "C"]


def test_diamond() -> None:
    # A → B, A → C, B → D, C → D
    result = _topo({"A": [], "B": ["A"], "C": ["A"], "D": ["B", "C"]})
    assert result[0] == "A"
    assert result[-1] == "D"
    assert _precedes(result, "B", "D")
    assert _precedes(result, "C", "D")


def test_multiple_roots() -> None:
    # A and B are independent roots, C depends on both
    result = _topo({"A": [], "B": [], "C": ["A", "B"]})
    assert set(result[:2]) == {"A", "B"}
    assert result[-1] == "C"


def test_all_independent_nodes() -> None:
    result = _topo({"X": [], "Y": [], "Z": []})
    assert set(result) == {"X", "Y", "Z"}


def test_wide_fan_out() -> None:
    # A feeds B, C, D, E
    result = _topo({"A": [], "B": ["A"], "C": ["A"], "D": ["A"], "E": ["A"]})
    assert result[0] == "A"
    assert set(result[1:]) == {"B", "C", "D", "E"}


def test_cycle_nodes_omitted() -> None:
    # A → B → C → B (cycle between B and C); A has no parents so it is yielded
    result = _topo({"A": [], "B": ["A", "C"], "C": ["B"]})
    assert "A" in result
    # B and C form a cycle and should be omitted
    assert "B" not in result
    assert "C" not in result


def test_non_string_node_ids() -> None:
    graph = [(1, []), (2, [1]), (3, [2])]
    result = list(topological_order(iter(graph), lambda parents: parents))
    assert result == [1, 2, 3]


def test_preserves_all_reachable_nodes() -> None:
    edges = {
        "start": [],
        "a": ["start"],
        "b": ["start"],
        "c": ["a", "b"],
        "end": ["c"],
    }
    result = _topo(edges)
    assert set(result) == set(edges.keys())
    assert result[0] == "start"
    assert result[-1] == "end"
