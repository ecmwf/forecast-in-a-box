from .registry import CategoryRegistry


from typing import Any, TYPE_CHECKING
from .product import  GenericParamProduct


forecast_registry = CategoryRegistry("fc_stat", "Statistics over time for each member", "Forecast Statistics")

if TYPE_CHECKING:
	from cascade.fluent import Action

class BaseForecast(GenericParamProduct):
	"""Base Forecast Product"""

	_statistic: str = None
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
		return {'step': '*'}

	@property
	def qube(self):
		return self.make_generic_qube(step = ['0-24', '0-168'])
	
	def _select_on_step(self, source: "Action", step: str) -> "Action":
		if step == '0-24':
			return source.sel(step = slice(0, 24))
		elif step == '0-168':
			return source.sel(step = slice(0, 168))
		else:
			raise ValueError(f"Invalid step {step}")
		
	def _apply_statistic(self, specification: dict[str, Any], source: "Action", statistic: str) -> "Action":
		spec = specification.copy()
		step = spec.pop('step')

		source = super().select_on_specification(spec, source)
		source = self._select_on_step(source, step)
		return getattr(source, statistic)('step')

	def to_graph(self, specification: dict[str, Any], source: "Action") -> "Action":
		return self._apply_statistic(specification, source, self._statistic)

@forecast_registry("Mean")
class FCMean(BaseForecast):
	_statistic = 'mean'

	def mars_request(self, **kwargs) -> dict[str, Any]:
		return super().mars_request(**kwargs)  # type: ignore

	
@forecast_registry("Minimum")
class FCMin(BaseForecast):
	_statistic = 'min'

	def mars_request(self, **kwargs) -> dict[str, Any]:
		return super().mars_request(**kwargs)  # type: ignore
		
@forecast_registry("Maximum")
class FCMax(BaseForecast):
	_statistic = 'max'

	def mars_request(self, **kwargs) -> dict[str, Any]:
		return super().mars_request(**kwargs)  # type: ignore

	
@forecast_registry("Standard Deviation")
class FCStd(BaseForecast):
	_statistic = 'std'

	def mars_request(self, **kwargs) -> dict[str, Any]:
		return super().mars_request(**kwargs)  # type: ignore
