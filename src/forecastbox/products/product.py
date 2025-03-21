

from abc import ABC, abstractmethod


from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from qubed import Qube

class Product(ABC):
    """Base Product Class"""

    label: dict[str, str] = {}
    """Labels of product axes."""

    description: dict[str, str] = {}
    """Description of product axes."""

    example: dict[str, str] = {}
    """Example values for product axes."""

    @property
    @abstractmethod
    def requirements(self) -> dict[str, Any]:
        """Requirements of the product to be used with a Model Qube."""
        pass

    @abstractmethod
    def mars_request(self, **kwargs) -> dict[str, Any]:
        raise NotImplementedError()

    @abstractmethod
    def to_graph(self, source):
        pass

class GenericParamProduct(Product):
    """Generic Param Product"""

    description = {
        'param': 'Parameter',
        'level': 'Level',
    }
    
    @property
    def generic_params(self) -> dict[str, Any]:
        """Specification for generic parameters for a Qube."""
        return {
            "levtype": "*",
            "param": "*",
            "levelist": "*",
            # "frequency": "*",
        }