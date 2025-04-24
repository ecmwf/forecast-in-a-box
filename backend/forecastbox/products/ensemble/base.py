
from typing import Any
from forecastbox.products.product import Product
from forecastbox.products.pproc import PProcProduct
from forecastbox.models.model import Model


class BaseEnsembleProduct(Product):
    """Base Ensemble Product"""

    def validate_intersection(self, model: Model) -> bool:
        """Check if the model has ensemble members"""
        result = super().validate_intersection(model)
        if model.ensemble_members == 1:
            return False
        return result & True
    
class BasePProcEnsembleProduct(BaseEnsembleProduct, PProcProduct):
    @property
    def default_request_keys(self) -> dict[str, Any]:
        """Get the default request keys for the product."""
        return {
            **super().default_request_keys,
            'stream': 'enfo',
            'class': 'od',
        }