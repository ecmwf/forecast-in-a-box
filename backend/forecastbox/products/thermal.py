# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import importlib.util
from collections import OrderedDict

from forecastbox.models import SpecifiedModel
from forecastbox.rjsf import FieldWithUI, IntegerSchema
from qubed import Qube

from .export import export_fieldlist_as
from .interfaces import Interfaces
from .product import Product
from .registry import CategoryRegistry

thermal_indices = CategoryRegistry(
    "thermal", interface=Interfaces.DETAILED, description="Thermal Indices", title="Thermal Indices"
)

PPROC_AVAILABLE = True
try:
    from earthkit.workflows.plugins.pproc.fluent import Action as ppAction
except (OSError, ImportError):
    ppAction = object # type: ignore # NOTE implicit shadowing, intentional
    PPROC_AVAILABLE = False

THERMOFEEL_IMPORTED = True
if not importlib.util.find_spec("thermofeel"):
    THERMOFEEL_IMPORTED = False


class BaseThermalIndex(Product):
    """Base Thermal Index Product"""

    param_requirements: list[str] | None = None
    output_param: str

    @property
    def qube(self):
        return Qube.from_datacube({"param": "*"})

    @property
    def formfields(self) -> OrderedDict[str, "FieldWithUI"]:
        """Form fields for the product."""
        formfields = super().formfields.copy()
        formfields.update(
            step=self._make_field(
                title="Step",
                multiple=True,
                schema=IntegerSchema,
            ),
        )
        return formfields

    def model_intersection(self, model: SpecifiedModel) -> Qube:
        return f"step={'/'.join(map(str, model.timesteps()))}" / Qube.from_datacube({})

    def validate_intersection(self, model: SpecifiedModel) -> bool:
        model_intersection = model.qube()

        if not PPROC_AVAILABLE or not THERMOFEEL_IMPORTED or self.param_requirements is None:
            return False
        return all(x in model_intersection.span("param") for x in self.param_requirements)

    def execute(self, product_spec, model, source):
        """Get the graph for the product."""
        deaccumulated = model.deaccumulate(source)
        assert deaccumulated is not None, "Model does not support deaccumulation."

        selected = self.select_on_specification(product_spec, deaccumulated)
        source = selected.select(param=self.param_requirements)

        if not PPROC_AVAILABLE:
            raise ImportError("PPROC is not available. Please install earthkit-workflows[pproc] to use PPROC products.")

        return (
            ppAction(source.nodes)
            .thermal_index(self.output_param)
            .stack("step")
            .map(export_fieldlist_as(format="grib"))
            .map(self.named_payload(self.__class__.__name__))
        )


@thermal_indices("Heat Index")
class HeatIndex(BaseThermalIndex):
    """Heat Index Product"""

    param_requirements = ["2t", "r"]
    output_param = "heatx"


@thermal_indices("Universal thermal climate index")
class UniversalThermalClimateIndex(BaseThermalIndex):
    """Universal thermal climate index product"""

    param_requirements = ["ssrd", "strd", "ssr", "str", "fdir", "10u", "10v", "2t", "2d"]
    output_param = "utci"


@thermal_indices("Wet bulb globe temperature")
class WetBulbGlobeTemperature(BaseThermalIndex):
    """Wet bulb globe temperature product"""

    param_requirements = ["ssrd", "strd", "ssr", "str", "fdir", "10u", "10v", "2t", "2d"]
    output_param = "wbgt"


@thermal_indices("Globe temperature")
class GlobeTemperature(BaseThermalIndex):
    """Globe temperature product"""

    param_requirements = ["ssrd", "strd", "ssr", "str", "fdir", "10u", "10v", "2t"]
    output_param = "gt"


@thermal_indices("2 metre relative humidity")
class TwoMetreRelativeHumidity(BaseThermalIndex):
    """2 metre relative humidity product"""

    param_requirements = ["2t", "2d"]
    output_param = "2r"


@thermal_indices("Humidex")
class Humidex(BaseThermalIndex):
    """Humidex product"""

    param_requirements = ["2t", "2d"]
    output_param = "hmdx"


@thermal_indices("Wind chill factor")
class WindChill(BaseThermalIndex):
    """Wind chill factor product"""

    param_requirements = ["10u", "10v", "2t"]
    output_param = "wcf"


@thermal_indices("Apparent temperature")
class ApparentTemperature(BaseThermalIndex):
    """Apparent temperature product"""

    param_requirements = ["10u", "10v", "2t", "2d"]
    output_param = "aptmp"


@thermal_indices("Normal effective temperature")
class NormalEffectiveTemperature(BaseThermalIndex):
    """Normal effective temperature product"""

    param_requirements = ["10u", "10v", "2t", "2d"]
    output_param = "nefft"


# @thermal_indices("Heat Index Adjusted")
# class HeatIndexAdjusted(BaseThermalIndex):
#     """Heat Index Product"""

#     param_requirements = ["2t", "2d"]

#     def to_graph(self, specification: dict[str, Any], source: Action) -> Action:
#         from thermofeel import calculate_heat_index_adjusted

#         source = source.select(param=["2t", "2d"])

#         return source.reduce(
#             Payload(
#                 calculate_heat_index_adjusted,
#                 (Node.input_name(0), Node.input_name(1)),
#             ),
#             dim="param",
#         )


# @thermal_indices("Saturation Vapour Pressure")
# class SaturationVapourPressure(BaseThermalIndex):
#     """Heat Index Product"""

#     param_requirements = ["2t"]

#     def to_graph(self, specification: dict[str, Any], source: Action) -> Action:
#         from thermofeel import calculate_saturation_vapour_pressure

#         source = source.select(param=["2t"])

#         return source.reduce(
#             Payload(
#                 calculate_saturation_vapour_pressure,
#                 (Node.input_name(0),),
#             ),
#             dim="param",
#         )


# @thermal_indices("Wind Chill")
# class WindChill(BaseThermalIndex):
#     """Heat Index Product"""

#     param_requirements = ["2t", "10u"]

#     def to_graph(self, specification: dict[str, Any], source: Action) -> Action:
#         from thermofeel import calculate_wind_chill

#         source = source.select(param=["2t", "10u"])

#         return source.reduce(
#             Payload(
#                 calculate_wind_chill,
#                 (Node.input_name(0), Node.input_name(1)),
#             ),
#             dim="param",
#         )


# @thermal_indices("Wind Chill")
# class Humidex(BaseThermalIndex):
#     """Heat Index Product"""

#     param_requirements = ["2t", "2d"]

#     def to_graph(self, specification: dict[str, Any], source: Action) -> Action:
#         from thermofeel import calculate_humidex

#         source = source.select(param=["2t", "2d"])

#         return source.reduce(
#             Payload(
#                 calculate_humidex,
#                 (Node.input_name(0), Node.input_name(1)),
#             ),
#             dim="param",
#         )
