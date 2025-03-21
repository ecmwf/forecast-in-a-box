from .registry import CategoryRegistry


from typing import Any
from .product import  GenericParamProduct


forecast_registry = CategoryRegistry("fc_stat", "Statistics over time for each member", "Forecast Statistics")


class BaseForecast(GenericParamProduct):
	"""Base Forecast Product"""

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

@forecast_registry("Mean")
class FCMean(BaseForecast):

	def mars_request(self, **kwargs) -> dict[str, Any]:
		return super().mars_request(**kwargs)  # type: ignore

	def to_graph(self, **kwargs):
		return super().to_graph(**kwargs)
	
@forecast_registry("Minimum")
class FCMin(BaseForecast):

	def mars_request(self, **kwargs) -> dict[str, Any]:
		return super().mars_request(**kwargs)  # type: ignore

	def to_graph(self, **kwargs):
		return super().to_graph(**kwargs)
	
@forecast_registry("Maximum")
class FCMax(BaseForecast):

    def mars_request(self, **kwargs) -> dict[str, Any]:
        return super().mars_request(**kwargs)  # type: ignore

    def to_graph(self, **kwargs):
        return super().to_graph(**kwargs)
	
@forecast_registry("Standard Deviation")
class FCStd(BaseForecast):

	def mars_request(self, **kwargs) -> dict[str, Any]:
		return super().mars_request(**kwargs)  # type: ignore

	def to_graph(self, **kwargs):
		return super().to_graph(**kwargs)

