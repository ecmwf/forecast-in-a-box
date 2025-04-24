from typing import Any, TYPE_CHECKING

import itertools

from earthkit.workflows import fluent

from forecastbox.products.product import GenericTemporalProduct
from forecastbox.products.ensemble.base import BasePProcEnsembleProduct

from . import ensemble_registry

class BaseEnsembleStats(BasePProcEnsembleProduct, GenericTemporalProduct):
    _type: str = None
    
    multiselect = {
        'step': True,
        "param": True,
    }

    @property
    def qube(self):
        return self.make_generic_qube()

    def get_sources(self, product_spec, model, source: fluent.Action) -> dict[str, fluent.Action]:
        params = product_spec["param"]
        step = product_spec["step"]
        return {'forecast': self.select_on_specification({'param': params, 'step': step}, source)}

    def mars_request(self, product_spec: dict[str, Any]):
        """Mars request for ensemble stats."""
        params = product_spec["param"]
        steps = product_spec["step"]
        levtype = product_spec.get("levtype", None)

        requests = []

        for para, st in itertools.product(params, steps):
            request = {
                'type': self._type,
            }
            from anemoi.utils.grib import shortname_to_paramid
            param_id = shortname_to_paramid(para)

            request.update({
                'levtype': levtype,
                'param': param_id,
                'step': st,
            })
            requests.append(request)
        return requests
    
@ensemble_registry("Ensemble Mean")
class ENSMS(BaseEnsembleStats):
    _type = 'em'

@ensemble_registry("Ensemble Standard Deviation")
class ENSSTD(BaseEnsembleStats):
    _type = 'es'