from typing import Any
from . import ensemble_registry
from ..product import Product, GenericParamProduct, USER_DEFINED
from ..generic import generic_registry

from qubed import Qube
import yaml
from pathlib import Path


from forecastbox.products.definitions import DESCRIPTIONS, LABELS

class BaseThresholdProbability(Product):
	"""Base Threshold Probability Product"""

	description = {
		**DESCRIPTIONS,
		"threshold": "Threshold",
	}
	label = {
		**LABELS,
		"threshold": "Threshold",
	}

	@property
	def model_assumptions(self):
		return {"threshold": "*"}

	def mars_request(self, **kwargs) -> dict[str, Any]:
		return super().mars_request(**kwargs)  # type: ignore

	def to_graph(self, **kwargs):
		return super().to_graph(**kwargs)


@generic_registry("Threshold Probability")
class GenericThresholdProbability(BaseThresholdProbability, GenericParamProduct):
	example = {
		"threshold": "10",
	}
	

	@property
	def qube(self):
		return self.make_generic_qube(threshold=USER_DEFINED)

	def mars_request(self, **kwargs) -> dict[str, Any]:
		return super().mars_request(**kwargs)  # type: ignore

	def to_graph(self, **kwargs):
		return super().to_graph(**kwargs)


@ensemble_registry("Threshold Probability")
class DefinedThresholdProbability(BaseThresholdProbability):
	@property
	def qube(self):
		defined = yaml.safe_load(open(Path(__file__).parent / "defined_threshold_probability.yaml"))

		q = Qube.empty()
		for d in defined:
			q = q | Qube.from_datacube({"frequency": "*", **d})
		return q.compress()

	def mars_request(self, **kwargs) -> dict[str, Any]:
		return super().mars_request(**kwargs)  # type: ignore

	def to_graph(self, **kwargs):
		return super().to_graph(**kwargs)


class BaseQuantiles(Product):
	"""Base Quantiles Product"""

	description = {
		**DESCRIPTIONS,
		"quantile": "Quantile",
	}
	label = {
		**LABELS,
		"quantile": "Quantile",
	}

	@property
	def model_assumptions(self):
		return {"quantile": "*"}

	def mars_request(self, **kwargs) -> dict[str, Any]:
		return super().mars_request(**kwargs)  # type: ignore

	def to_graph(self, **kwargs):
		return super().to_graph(**kwargs)


@ensemble_registry("Quantiles")
class Quantiles(BaseQuantiles):
	@property
	def qube(self):
		q = Qube.from_datacube(
			{
				"frequency": "*",
				"levtype": "sfc",
				"param": ["2t", "cape", "capes", "sf", "tp", "avg_2t"],
				"quantile": list(map(str, range(0, 101, 1))),
			}
		)
		return q

@ensemble_registry("BadProduct")
class BadProduct(BaseQuantiles):
	@property
	def qube(self):
		q = Qube.from_datacube(
			{
				"frequency": "*",
				"levtype": "sfc",
				"param": ["capeefe"],
				"quantile": list(map(str, range(0, 101, 1))),
			}
		)
		return q

@generic_registry("Quantiles")
class GenericQuantiles(BaseQuantiles, GenericParamProduct):
	example = {
		"quantile": "99.5",
	}

	@property
	def qube(self):
		return self.make_generic_qube(quantile=USER_DEFINED)

	def mars_request(self, **kwargs) -> dict[str, Any]:
		return super().mars_request(**kwargs)  # type: ignore

	def to_graph(self, **kwargs):
		return super().to_graph(**kwargs)


@ensemble_registry("Ensemble Mean")
class ENSMS(GenericParamProduct):

	multiselect = {
		"param": True,
	}

	@property
	def qube(self):
		return self.make_generic_qube()

	def mars_request(self, **kwargs) -> dict[str, Any]:
		return super().mars_request(**kwargs)  # type: ignore

	def to_graph(self, **kwargs):
		return super().to_graph(**kwargs)

@ensemble_registry("Ensemble Standard Deviation")
class ENSSTD(GenericParamProduct):
	
	multiselect = {
		"param": True,
	}

	@property
	def qube(self):
		return self.make_generic_qube()

	def mars_request(self, **kwargs) -> dict[str, Any]:
		return super().mars_request(**kwargs)  # type: ignore

	def to_graph(self, **kwargs):
		return super().to_graph(**kwargs)
