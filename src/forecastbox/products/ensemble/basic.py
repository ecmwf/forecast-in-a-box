


from typing import Any
from . import ensemble_registry
from ..product import Product, GenericParamProduct
from ..generic import generic_registry

from qubed import Qube
import yaml
from pathlib import Path

# @ensemble_registry("Ensemble Mean")
# class ENSMS(Product):
#     pass

@generic_registry("Threshold Probability")
class ThresholdProbability(GenericParamProduct):
    description = {
        'param': 'Parameter',
        'level': 'Level',
        'threshold': 'Threshold',
    }
    @property
    def requirements(self):
        return Qube.from_datacube({
            **self.generic_params,
            "threshold": "USER_DEFINED",
        })

    def mars_request(self, **kwargs) -> dict[str, Any]:
        return super().mars_request(**kwargs) # type: ignore
    
    def to_graph(self, **kwargs):
        return super().to_graph(**kwargs)
    

@ensemble_registry("Threshold Probability")
class DefinedThresholdProbability(Product):
    description = {
        'param': 'Parameter Name',
        'level': 'Level',
        'threshold': 'Threshold',
    }

    @property
    def qube(self):
        defined = yaml.safe_load(open(Path(__file__).parent / "defined_threshold_probability.yaml"))
        q = Qube.from_datacube({})

        for d in defined:
            q = q | Qube.from_datacube(d)

        return q


    def mars_request(self, **kwargs) -> dict[str, Any]:
        return super().mars_request(**kwargs) # type: ignore
    
    def to_graph(self, **kwargs):
        return super().to_graph(**kwargs)

@ensemble_registry("Quantiles")
class Quantiles(GenericParamProduct):
    description = {
        'param': 'Parameter Name',
        'level': 'Level',
        'quantile': 'Quantile',
    }

    @property
    def qube(self):
        q = Qube.from_datacube(
            {
                'levtype':'sfc',
                'param': ['2t', 'cape', 'capes', 'sf', 'tp', 'avg_2t'],
                'quantile':list(map(str, range(0, 101, 1))),
            }
        )
        return q


    def mars_request(self, **kwargs) -> dict[str, Any]:
        return super().mars_request(**kwargs) # type: ignore
    
    def to_graph(self, **kwargs):
        return super().to_graph(**kwargs)
