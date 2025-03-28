from typing import Any, TYPE_CHECKING

from forecastbox.models import Model
from . import ensemble_registry
from ..product import Product, GenericParamProduct, USER_DEFINED
from ..generic import generic_registry

from qubed import Qube
import yaml
from pathlib import Path

from forecastbox.products.definitions import DESCRIPTIONS, LABELS

if TYPE_CHECKING:
	from cascade.fluent import Action

class BaseEnsembleProduct(Product):
	"""Base Ensemble Product"""

	def validate_intersection(self, model: Model) -> bool:
		result = super().validate_intersection(model)
		if model.ensemble_members == 1:
			return False
		return result & True

class BaseThresholdProbability(BaseEnsembleProduct):
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

	def to_graph(self, specification: dict[str, Any], source: "Action") -> "Action":
		from anemoi.cascade.fluent import ENSEMBLE_DIMENSION_NAME
		from cascade import backends, fluent

		source = source.sel(param = specification['param'])
		if 'levlist' in specification:
			source = source.sel(levlist = specification['levlist'])
		
		payload = fluent.Payload(
            backends.threshold,
            (
                fluent.Node.input_name(0),
                '<',
                float(specification['threshold']),
            ),
        )
		
		return source.map(payload).multiply(100).mean(ENSEMBLE_DIMENSION_NAME)

@generic_registry("Threshold Probability")
class GenericThresholdProbability(BaseThresholdProbability, GenericParamProduct):
	example = {
		"threshold": "10",
	}
	multiselect = {
		"param": True,
	}
	@property
	def qube(self):
		return self.make_generic_qube(threshold=USER_DEFINED)

	def mars_request(self, **kwargs) -> dict[str, Any]:
		return super().mars_request(**kwargs)  # type: ignore

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


class BaseQuantiles(BaseEnsembleProduct):
	"""Base Quantiles Product"""

	description = {
		**DESCRIPTIONS,
		"quantile": "Quantile",
	}
	label = {
		**LABELS,
		"quantile": "Quantile",
	}
	multiselect = {
		"quantile": True,
		"param": True,
	}

	@property
	def model_assumptions(self):
		return {"quantile": "*"}

	def mars_request(self, **kwargs) -> dict[str, Any]:
		return super().mars_request(**kwargs)  # type: ignore

	def to_graph(self, specification: dict[str, Any], source: "Action") -> "Action":
		from .transforms import _quantiles_transform
		from anemoi.cascade.fluent import ENSEMBLE_DIMENSION_NAME

		params = [
            (float(x), "quantile", None)
            for x in (specification['quantile'] if isinstance(specification['quantile'], list) else specification['quantile'].split(","))
        ]
		source = source.sel(param = specification['param'])
		if 'levlist' in specification:
			source = source.sel(levlist = specification['levlist'])
		
		return source.concatenate(ENSEMBLE_DIMENSION_NAME).transform(_quantiles_transform, params, "quantile")

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

@generic_registry("Quantiles")
class GenericQuantiles(BaseQuantiles, GenericParamProduct):
	example = {
		"quantile": "99.0, 99.5",
	}

	@property
	def qube(self):
		return self.make_generic_qube(quantile=USER_DEFINED)

	def mars_request(self, **kwargs) -> dict[str, Any]:
		return super().mars_request(**kwargs)  # type: ignore



@ensemble_registry("Ensemble Mean")
class ENSMS(BaseEnsembleProduct, GenericParamProduct):

	multiselect = {
		"param": True,
	}

	@property
	def qube(self):
		return self.make_generic_qube()

	def mars_request(self, **kwargs) -> dict[str, Any]:
		return super().mars_request(**kwargs)  # type: ignore

	def to_graph(self, specification: dict[str, Any], source: "Action") -> "Action":
		from anemoi.cascade.fluent import ENSEMBLE_DIMENSION_NAME
		
		source = self.select_on_specification(specification, source)
		return source.mean(ENSEMBLE_DIMENSION_NAME)


@ensemble_registry("Ensemble Standard Deviation")
class ENSSTD(BaseEnsembleProduct, GenericParamProduct):
	
	multiselect = {
		"param": True,
	}

	@property
	def qube(self):
		return self.make_generic_qube()

	def mars_request(self, **kwargs) -> dict[str, Any]:
		return super().mars_request(**kwargs)  # type: ignore

	def to_graph(self, specification: dict[str, Any], source: "Action") -> "Action":
		from anemoi.cascade.fluent import ENSEMBLE_DIMENSION_NAME

		source = self.select_on_specification(specification, source)
		return source.std(ENSEMBLE_DIMENSION_NAME)

