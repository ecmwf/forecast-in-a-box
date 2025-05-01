from abc import ABC, abstractmethod

from typing import Any, TYPE_CHECKING

from qubed import Qube
from forecastbox.models import Model

from .definitions import DESCRIPTIONS, LABELS

if TYPE_CHECKING:
    from earthkit.workflows.graph import Graph
    from earthkit.workflows.fluent import Action


class Product(ABC):
    """Base Product Class"""

    label: dict[str, str] = {}
    """Labels of product axes."""

    description: dict[str, str] = {}
    """Description of product axes."""

    example: dict[str, str] = {}
    """Example values for product axes."""

    multiselect: dict[str, bool] = {}
    """Whether the product axes are multi-selectable."""

    defaults: dict[str, Any] = {}
    """Default values for product axes."""

    @property
    @abstractmethod
    def qube(self) -> "Qube":
        """Requirements of the product to be used with a Model Qube."""
        pass

    @property
    # @abstractmethod
    def data_requirements(self) -> "Qube":
        """Data requirements for the product."""
        return Qube({})

    @property
    def model_assumptions(self) -> dict[str, Any]:
        """Model assumptions for the product."""
        return {}

    def select_on_specification(self, specification: dict[str, Any], source: "Action") -> "Action":
        """Select from `source` the key:value pairs from `specification`."""

        # Handle levelist specification where param is flattened
        # into a list of param_levelist
        if "levelist" in specification:
            levelist = specification.pop("levelist")
            if isinstance(levelist, str):
                levelist = [levelist]
            if isinstance(specification["param"], str):
                specification["param"] = [f"{specification['param']}_{l}" for l in levelist]
            else:
                specification["param"] = [f"{p}_{l}" for p in specification["param"] for l in levelist]

        for key, value in specification.items():
            if not value:
                continue
            if key not in source.nodes.dims:
                continue

            def convert_to_int(value: Any) -> int:
                """Convert value to int if it is a digit."""
                try:
                    return_val = int(value)
                    if not str(return_val) == value:
                        return float(value)
                    return return_val
                except ValueError:
                    return value

            if isinstance(value, str):
                value = convert_to_int(value)
            if isinstance(value, list):
                value = [convert_to_int(v) for v in value]

            source = source.sel(**{key: value if isinstance(value, (list, tuple)) else [value]})
        return source

    def validate_intersection(self, model: Model) -> bool:
        """Validate the intersection of the model and product qubes.

        By default, if `model_assumptions` are provided, the intersection must contain all of them.
        Otherwise, the intersection must be non-empty.
        """
        model_intersection = self.model_intersection(model)

        if self.model_assumptions:
            return all(k in model_intersection.axes() for k in self.model_assumptions.keys())

        return len(model_intersection.axes()) > 0

    def model_intersection(self, model: Model) -> "Qube":
        """Get the intersection of the model and product qubes."""
        return model.qube(self.model_assumptions) & self.qube

    @abstractmethod
    def to_graph(self, product_spec: dict[str, Any], model: Model, source: "Action") -> "Graph":
        raise NotImplementedError()


class GenericParamProduct(Product):
    """Generic Param Product"""

    label = LABELS
    description = DESCRIPTIONS

    @property
    def generic_params(self) -> dict[str, Any]:
        """Specification for generic parameters for a Qube."""
        return {
            "frequency": "*",
            "levtype": "*",
            "param": "*",
            "levelist": "*",
        }

    def validate_intersection(self, model: Model) -> bool:
        """Validate the intersection of the model and product qubes."""
        axes = self.model_intersection(model).axes()
        return all(k in axes for k in self.generic_params if not k == "levelist")

    def make_generic_qube(self, **kwargs) -> "Qube":
        """Make a generic Qube, including the intersection of pl and sfc."""

        generic_params_without_levelist = self.generic_params.copy()
        generic_params_without_levelist.pop("levelist")

        return Qube.from_datacube(
            {
                **self.generic_params,
                **kwargs,
            }
        ) | Qube.from_datacube(
            {
                **generic_params_without_levelist,
                **kwargs,
            }
        )


class GenericTemporalProduct(GenericParamProduct):
    description = {
        **GenericParamProduct.description,
        "step": "Time step",
    }

    def model_intersection(self, model: Model) -> Qube:
        """Get model intersection.

        Add step as axis to the model intersection.
        """
        intersection = super().model_intersection(model)
        result = f"step={'/'.join(map(str, model.timesteps))}" / intersection
        return result


USER_DEFINED = "USER_DEFINED"
"""User defined value, used to indicate that the value is not known."""
