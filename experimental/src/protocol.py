
from typing import Protocol, Iterable, Any
from dataclasses import dataclass

from earthkit.workflows.fluent import Action
from qubed import Qube
from pydantic import BaseModel

EKW_TYPE = Action
"""Type alias for EarthKit Workflow"""
NULL_GRAPH = EKW_TYPE
"""Type alias for a null graph (used in sinks)"""

FLOW = Iterable["Node"]
"""Flow of nodes"""



DefinedUserConfig = dict[str, Any]
"""Type alias for user-defined configuration"""

CONFIGURED_FLOW = list[tuple["Node", DefinedUserConfig]]
"""Type alias for a flow of nodes with user-defined configurations"""

# Base protocols

@dataclass
class UIConfigSchema:
    """Schema for configuration for the user interface."""
    form: type[BaseModel] | None
    """React JSON Schema Form"""
    qube: Qube | None
    """Qube for Quick Querying for the form, if None, form values are expected to be static"""

class Node(Protocol):
    """Node protocol for defining nodes in a workflow."""

    def configuration(self, prior: Any, flow: FLOW, config: DefinedUserConfig) -> UIConfigSchema:
        """Create a configuration schema for this node based on the prior EKW and the flow of nodes."""
        ...

    def is_valid(self, prior: Any, flow: FLOW) -> bool:
        """Check if this node is valid in the context of the prior EKW and the flow of nodes."""
        ...

    def realise(self, prior: Any, config: DefinedUserConfig) -> EKW_TYPE:
        """Realise this node into an EKW based on the prior EKW and the user-defined configuration."""
        ...

# Abstract base classes
