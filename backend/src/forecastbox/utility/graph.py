# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

from collections import defaultdict
from collections.abc import Callable, Iterable, Iterator
from typing import TypeVar

TNodeId = TypeVar("TNodeId")
TNode = TypeVar("TNode")


def topological_order(
    graph: Iterable[tuple[TNodeId, TNode]],
    parent_extractor: Callable[[TNode], Iterable[TNodeId]],
) -> Iterator[TNodeId]:
    """Yield node IDs in topological order using Kahn's algorithm.

    ``graph`` is an iterable of ``(node_id, node)`` pairs. ``parent_extractor``
    returns the IDs of a node's parents (i.e. its dependencies). Nodes whose
    entire dependency chain forms a cycle are silently omitted from the output.
    """
    remaining: dict[TNodeId, int] = {}
    children: dict[TNodeId, list[TNodeId]] = defaultdict(list)
    queue: list[TNodeId] = []
    for node_id, node in graph:
        parents = list(parent_extractor(node))
        if not parents:
            queue.append(node_id)
        else:
            remaining[node_id] = len(parents)
        for parent in parents:
            children[parent].append(node_id)
    while queue:
        head = queue.pop(0)
        yield head
        for child in children[head]:
            remaining[child] -= 1
            if remaining[child] == 0:
                queue.append(child)
