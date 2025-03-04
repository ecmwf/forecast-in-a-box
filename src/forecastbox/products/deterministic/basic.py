


from . import deterministic_registry
from ..product import Product, GenericParamProduct
from ..generic import generic_registry


@deterministic_registry("Ensemble Mean")
class ENSMS(Product):
    pass

@generic_registry("Threshold Probability")
class ThresholdProbability(Product):
    pass

class DefinedThresholdProbability(ThresholdProbability):
    pass

@deterministic_registry("Quantiles")
class Quantiles(Product):
    pass