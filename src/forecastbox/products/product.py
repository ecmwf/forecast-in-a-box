

from abc import ABC, abstractmethod


from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from qubed import Qube

class Product(ABC):
    """Base Product Class"""

    description: dict[str, str] = {}
    """Description of product axes."""

    @property
    @abstractmethod
    def qube(self) -> "Qube":
        pass

    @abstractmethod
    def mars_request(self, **kwargs) -> dict[str, Any]:
        pass

    @abstractmethod
    def to_graph(self, source):
        pass

class GenericParamProduct(Product):
    """Generic Param Product"""

    description = {
        'param': 'Parameter',
        'level': 'Level',
    }
    