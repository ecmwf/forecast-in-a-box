# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

from collections import OrderedDict
from typing import TYPE_CHECKING, Any

from forecastbox.rjsf import StringSchema

from .export import export_fieldlist_as
from .interfaces import Interfaces
from .product import GenericParamProduct
from .registry import CategoryRegistry

forecast_registry = CategoryRegistry(
    "forecast_statistic",
    interface=Interfaces.DETAILED,
    description="Statistics over time for each member",
    title="Forecast Statistics",
)

if TYPE_CHECKING:
    from earthkit.workflows.fluent import Action


# TODO, Generalise with start, end, step kwargs for configuration


class BaseForecast(GenericParamProduct):
    """Base Forecast Product"""

    _statistic: str | None = None
    """Statistic to apply"""

    allow_multiple_params = True
    allow_multiple_levels = True

    @property
    def _name(self):
        return f"Forecast {self._statistic.capitalize() if self._statistic else ''}"

    @property
    def formfields(self) -> OrderedDict[str, "FieldWithUI"]:
        """Form fields for the product."""
        formfields = super().formfields.copy()
        formfields.update(
            step=self._make_field(
                title="Step",
                multiple=False,
                schema=StringSchema,
            ),
        )
        return formfields

    @property
    def model_assumptions(self):
        return {"step": "*"}

    @property
    def qube(self):
        return self.make_generic_qube(step=["0-24", "0-168"])

    def _select_on_step(self, source: "Action", step: str) -> "Action":
        if step == "0-24":
            return source.sel(step=slice(0, 24))
        elif step == "0-168":
            return source.sel(step=slice(0, 168))
        else:
            raise ValueError(f"Invalid step {step}")

    def _apply_statistic(self, specification: dict[str, Any], source: "Action", statistic: str) -> "Action":
        spec = specification.copy()
        step = spec.pop("step")

        source = super().select_on_specification(spec, source)
        source = self._select_on_step(source, step)
        return getattr(source, statistic)("step")

    def execute(self, product_spec, model, source):
        assert self._statistic is not None, "Statistic must be defined"
        return (
            self._apply_statistic(product_spec, source, self._statistic)
            .map(export_fieldlist_as(format="grib"))
            .map(self.named_payload(self._statistic))
        )


@forecast_registry("Mean")
class FCMean(BaseForecast):
    _statistic = "mean"


@forecast_registry("Minimum")
class FCMin(BaseForecast):
    _statistic = "min"


@forecast_registry("Maximum")
class FCMax(BaseForecast):
    _statistic = "max"


@forecast_registry("Standard Deviation")
class FCStd(BaseForecast):
    _statistic = "std"
