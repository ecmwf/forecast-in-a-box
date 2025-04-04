from typing import Any, TYPE_CHECKING
from earthkit.workflows.fluent import Action, Payload, Node
from ..registry import CategoryRegistry

from ..product import GenericParamProduct
from forecastbox.models import Model
from qubed import Qube

thermal_indices = CategoryRegistry("thermal", "Thermal Indices", "Thermal Indices")

THERMOFEEL_IMPORTED = True
try:
    import thermofeel
except ImportError:
    THERMOFEEL_IMPORTED = False


class BaseThermalIndex(GenericParamProduct):
    """Base Thermal Index Product"""

    param_requirements: list[str] | None = None

    @property
    def qube(self):
        return Qube.from_datacube({"param": "*"})

    def model_intersection(self, model: Model) -> Qube:
        return model.qube()

    def validate_intersection(self, model: Model) -> bool:
        model_intersection = self.model_intersection(model)

        if not THERMOFEEL_IMPORTED or self.param_requirements is None:
            return False
        return all(x in model_intersection.span("param") for x in self.param_requirements)

    def mars_request(self, **kwargs):
        return super().mars_request(**kwargs)


@thermal_indices("Heat Index")
class HeatIndex(BaseThermalIndex):
    """Heat Index Product"""

    param_requirements = ["2t", "r"]

    def to_graph(self, specification: dict[str, Any], source: Action) -> Action:
        from thermofeel import calculate_heat_index_simplified

        source = source.select(param=["2t", "r"])

        return source.reduce(
            Payload(
                calculate_heat_index_simplified,
                (Node.input_name(0), Node.input_name(1)),
            ),
            dim="param",
        )


@thermal_indices("Heat Index Adjusted")
class HeatIndexAdjusted(BaseThermalIndex):
    """Heat Index Product"""

    param_requirements = ["2t", "2d"]

    def to_graph(self, specification: dict[str, Any], source: Action) -> Action:
        from thermofeel import calculate_heat_index_adjusted

        source = source.select(param=["2t", "2d"])

        return source.reduce(
            Payload(
                calculate_heat_index_adjusted,
                (Node.input_name(0), Node.input_name(1)),
            ),
            dim="param",
        )


@thermal_indices("Saturation Vapour Pressure")
class SaturationVapourPressure(BaseThermalIndex):
    """Heat Index Product"""

    param_requirements = ["2t"]

    def to_graph(self, specification: dict[str, Any], source: Action) -> Action:
        from thermofeel import calculate_saturation_vapour_pressure

        source = source.select(param=["2t"])

        return source.reduce(
            Payload(
                calculate_saturation_vapour_pressure,
                (Node.input_name(0),),
            ),
            dim="param",
        )


@thermal_indices("Wind Chill")
class WindChill(BaseThermalIndex):
    """Heat Index Product"""

    param_requirements = ["2t", "10u"]

    def to_graph(self, specification: dict[str, Any], source: Action) -> Action:
        from thermofeel import calculate_wind_chill

        source = source.select(param=["2t", "10u"])

        return source.reduce(
            Payload(
                calculate_wind_chill,
                (Node.input_name(0), Node.input_name(1)),
            ),
            dim="param",
        )


@thermal_indices("Wind Chill")
class Humidex(BaseThermalIndex):
    """Heat Index Product"""

    param_requirements = ["2t", "2d"]

    def to_graph(self, specification: dict[str, Any], source: Action) -> Action:
        from thermofeel import calculate_humidex

        source = source.select(param=["2t", "2d"])

        return source.reduce(
            Payload(
                calculate_humidex,
                (Node.input_name(0), Node.input_name(1)),
            ),
            dim="param",
        )
