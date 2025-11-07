

from .registry import REGISTRY, RegisteredNode
from .protocol import Node, CONFIGURED_FLOW, FLOW, EKW_TYPE
from .enums import NodeType

def find_valid_nodes(prior: EKW_TYPE | None, flow: FLOW) -> list[RegisteredNode]:
    """Find all valid nodes in the flow."""
    nodes = []
    for node in REGISTRY:
        try:
            if node().is_valid(prior, flow):
                nodes.append(node)
        except Exception as e:
            print(e)
    return nodes

def get_node(category: str | NodeType, name: str) -> Node:
    """Create a node from the registry."""
    if isinstance(category, str):
        category = NodeType(category.lower())
    registered_node = REGISTRY.get(category, name)
    return registered_node()

def build_ekworkflow(configured_flow: CONFIGURED_FLOW) -> EKW_TYPE:
    """Build an EKW from a flow of nodes."""
    current: EKW_TYPE | None = None
    
    for node, config in configured_flow:
        current = node.realise(current, config)

    if current is None:
        raise ValueError("The configured flow is empty, no workflow was created.")
    return current