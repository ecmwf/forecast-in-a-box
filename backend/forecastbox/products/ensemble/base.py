# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.


from typing import Any

from forecastbox.models import SpecifiedModel
from forecastbox.products.pproc import PProcProduct
from forecastbox.products.product import Product


class BaseEnsembleProduct(Product):
    """Base Ensemble Product"""

    def validate_intersection(self, model: SpecifiedModel) -> bool:
        """Check if the model has ensemble members"""
        result = super().validate_intersection(model)
        if model._ensemble_members == 1:
            return False
        return result & True


class BasePProcEnsembleProduct(BaseEnsembleProduct, PProcProduct):
    @property
    def default_request_keys(self) -> dict[str, Any]:
        """Get the default request keys for the product."""
        return {
            **super().default_request_keys,
            "stream": "enfo",
            "class": "od",
        }
