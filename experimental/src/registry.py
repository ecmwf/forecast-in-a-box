
from typing import Any, Hashable
from dataclasses import dataclass

from .protocol import Node
from .enums import NodeType


def _create_node_id(category: NodeType, name: Hashable) -> int:
    return hash((category, name))

@dataclass
class RegisteredNode:
    category: NodeType
    name: Hashable
    cls: type[Node]
    description: str | None = None
    tags: set[str] | None = None

    def __repr__(self):
        return repr(self.cls)

    @property
    def id(self):
        return _create_node_id(self.category, self.name)

    def invoke(self, *args: Any, **kwargs: Any) -> Node:
        return self.cls(*args, **kwargs)
    
    def __call__(self, *args: Any, **kwargs: Any) -> Node:
        return self.invoke(*args, **kwargs)
    
    def __getattr__(self, key: str):
        return getattr(self.cls, key)
    

class Registry:
    nodes: dict[Hashable, RegisteredNode]

    def __init__(self):
        self.nodes = {}

    def __contains__(self, rn: RegisteredNode):
        return rn.id in self.nodes

    def register(self, registered_node: RegisteredNode) -> None:
        if registered_node in self:
            raise ValueError(f"Node '{registered_node}' already registered in category '{registered_node.category}'")
        self.nodes[registered_node.id] = registered_node

    def tags(self, category: NodeType | None = None) -> set[str]:
        """Get tags, optionally filtered by category."""
        tags: set[str] = set()
        for n in self.nodes.values():
            if category is not None and n.category != category:
                continue
            if n.tags:
                tags.update(n.tags)
        return tags
    
    def get(self, category:  NodeType, name: Hashable) -> RegisteredNode:
        if category not in NodeType:
            raise ValueError(f"Category '{category}' is not a valid NodeType. Valid categories: {list(NodeType)}")
            
        id = _create_node_id(category, name)
        if id not in self.nodes:
            raise KeyError(f"Node '{name}' not found in category '{category}'. Available nodes: {[n.name for n in self.nodes.values() if n.category == category]}")
        return self.nodes[id]

    def __iter__(self):
        return iter(self.nodes.values())

REGISTRY = Registry()
