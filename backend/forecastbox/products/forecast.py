from .registry import CategoryRegistry


from typing import Any, TYPE_CHECKING
from .product import GenericParamProduct

forecast_registry = CategoryRegistry("fc_stat", "Statistics over time for each member", "Forecast Statistics")

if TYPE_CHECKING:
    from earthkit.workflows.fluent import Action


# TODO, Generalise with start, end, step kwargs for configuration

class BaseForecast(GenericParamProduct):
    """Base Forecast Product"""

    _statistic: str | None = None
    """Statistic to apply"""

    multiselect = {
        "param": True,
    }
    label = {
        **GenericParamProduct.label,
        "step": "Step Range",
    }

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

    def to_graph(self, product_spec, model, source):
        return self._apply_statistic(product_spec, source, self._statistic)


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
