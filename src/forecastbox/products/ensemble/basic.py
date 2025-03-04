


from . import ensemble_registry
from ..product import Product, GenericParamProduct
from ..generic import generic_registry


@ensemble_registry("Ensemble Mean")
class ENSMS(Product):
    pass

@generic_registry("Threshold Probability")
class ThresholdProbability(Product):
    pass

@ensemble_registry("Threshold Probability")
class DefinedThresholdProbability(ThresholdProbability):
    @property
    def qube(self):
        pass

@ensemble_registry("Quantiles")
class Quantiles(Product):
    pass