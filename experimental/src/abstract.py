from abc import abstractmethod, ABC
from typing import Any, overload

from .protocol import UIConfigSchema, DefinedUserConfig, EKW_TYPE, FLOW, NULL_GRAPH

from .registry import REGISTRY, RegisteredNode
from .enums import NodeType

class AbstractNode(ABC):
    name: str | None = None
    description: str | None = None
    tags: set[str] | None = None


class Source(AbstractNode):
    """Abstract base class for source nodes in a workflow."""
    def __init_subclass__(cls) -> None:
        rn = RegisteredNode(
            category=NodeType.SOURCE,
            name=cls.name or cls.__name__,
            cls=cls,
            description=cls.description,
            tags=cls.tags
        )
        REGISTRY.register(rn)
        return super().__init_subclass__()
    
    @abstractmethod
    def configuration(self, prior: None, flow: FLOW, config: DefinedUserConfig) -> UIConfigSchema:
        """Create a configuration schema for this source node."""
        pass

    @abstractmethod
    def is_valid(self, prior: None, flow: FLOW) -> bool:
        """Check if this source node is valid."""
        pass

    @abstractmethod
    def realise(self, prior: None, config: DefinedUserConfig) -> EKW_TYPE:
        """Realise this source node into an EKW based on the user-defined configuration."""
        pass

class Operation(AbstractNode):
    """Abstract base class for operation nodes in a workflow."""
    @abstractmethod
    def configuration(self, prior: EKW_TYPE, flow: FLOW, config: DefinedUserConfig) -> UIConfigSchema:
        """Create a configuration schema for this source node."""
        pass

    @abstractmethod
    def is_valid(self, prior: EKW_TYPE, flow: FLOW) -> bool:
        """Check if this source node is valid."""
        pass

    @abstractmethod
    def realise(self, prior: EKW_TYPE, config: DefinedUserConfig) -> EKW_TYPE:
        """Realise this source node into an EKW based on the user-defined configuration."""
        pass    

class Transform(Operation):
    """Abstract base class for transform nodes in a workflow."""
    def __init_subclass__(cls) -> None:
        rn = RegisteredNode(
            category=NodeType.TRANSFORM,
            name=cls.__name__,
            cls=cls,
            tags=cls.tags
        )
        REGISTRY.register(rn)
        return super().__init_subclass__()

class Sink(Operation):
    """Abstract base class for sink nodes in a workflow."""
    def __init_subclass__(cls) -> None:
        rn = RegisteredNode(
            category=NodeType.SINK,
            name=cls.__name__,
            cls=cls,
            tags=cls.tags
        )
        REGISTRY.register(rn)
        return super().__init_subclass__()
    
    @abstractmethod
    def realise(self, prior: EKW_TYPE | None, config: DefinedUserConfig) -> NULL_GRAPH:
        """Realise this sink node based on the prior EKW and the user-defined configuration."""
        pass


class AlwaysValid(AbstractNode):
    """Mixin class to make a node always valid."""
    def is_valid(self, prior: Any, flow: FLOW) -> bool:
        return True
    
class ValidIfPrior(AbstractNode):
    """Mixin class to make a node valid only if there is a prior EKW."""
    def is_valid(self, prior: Any, flow: FLOW) -> bool:
        return prior is not None
    
    
class NoConfiguration(AbstractNode):
    """Mixin class to make a node have no configuration."""
    def configuration(self, prior: EKW_TYPE | None, flow: FLOW, config: DefinedUserConfig) -> UIConfigSchema:
        _ = prior, flow, config
        return UIConfigSchema(
            form=None,
            qube=None
        )

