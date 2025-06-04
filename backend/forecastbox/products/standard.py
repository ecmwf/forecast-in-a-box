# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.


from forecastbox.products.registry import CategoryRegistry
from forecastbox.products.product import GenericTemporalProduct
from forecastbox.models import Model
from forecastbox.products.interfaces import Interfaces


standard_product_registry = CategoryRegistry(
    "Standard", interface=[Interfaces.STANDARD, Interfaces.DETAILED], description="Standard products", title="Standard Products"
)

OUTPUT_TYPES = ["grib", "xarray"]


@standard_product_registry("Output")
class GribProduct(GenericTemporalProduct):
    multiselect = {
        "param": True,
        "step": True,
    }

    defaults = {
        "format": "grib",
        "reduce": "True",
    }

    @property
    def qube(self):
        return self.make_generic_qube(format=OUTPUT_TYPES, reduce=["True", "False"])

    @property
    def model_assumptions(self):
        return {
            "format": "*",
            "reduce": "*",
        }

    def to_graph(self, product_spec, model, source):
        source = self.select_on_specification(product_spec, source)

        if product_spec.get("reduce", "True") == "True":
            for dim in source.nodes.dims:
                source = source.concatenate(dim)

        source = source.map(self.named_payload("grib"))
        return source


@standard_product_registry("Deaccumulated")
class DeaccumulatedProduct(GenericTemporalProduct):
    """
    Deaccumulated Product.
    """

    multiselect = {
        "param": True,
        "step": True,
    }

    @property
    def qube(self):
        return self.make_generic_qube()

    def model_intersection(self, model: Model):
        """
        Model intersection with the product qube.

        Only the accumulation variables are used to create the intersection.
        """
        self_qube = self.make_generic_qube(param=model.accumulations)

        intersection = model.qube(self.model_assumptions) & self_qube
        result = f"step={'/'.join(map(str, model.timesteps))}" / intersection
        return result

    def to_graph(self, product_spec, model, source):
        return self.select_on_specification(product_spec, model.deaccumulate(source)).map(self.named_payload("deaccumulated"))
