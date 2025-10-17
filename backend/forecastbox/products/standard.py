# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.


from forecastbox.models import SpecifiedModel
from forecastbox.products.interfaces import Interfaces
from forecastbox.products.product import GenericTemporalProduct
from forecastbox.products.registry import CategoryRegistry
from forecastbox.rjsf import FieldWithUI, StringSchema, UIStringField

from .export import OUTPUT_TYPES, export_fieldlist_as

standard_product_registry = CategoryRegistry(
    "Standard",
    interface=[Interfaces.STANDARD, Interfaces.DETAILED],
    description="Standard products",
    title="Standard Products",
)


@standard_product_registry("Output")
class OutputProduct(GenericTemporalProduct):
    allow_multiple_steps = True

    @property
    def formfields(self):
        formfields = super().formfields.copy()
        formfields.update(
            reduce=FieldWithUI(
                jsonschema=StringSchema(
                    title="Reduce",
                    description="Combine all steps and parameters into a single output",
                    enum=["True", "False"], # type: ignore[unknown-argument] # NOTE checker failure, this is legit
                    default="True",
                )
            ),
            format=FieldWithUI(
                jsonschema=StringSchema(
                    title="Format",
                    description="Output format",
                    enum=OUTPUT_TYPES, # type: ignore[unknown-argument] # NOTE checker failure, this is legit
                    default="grib",
                ),
                uischema=UIStringField(
                    widget="select",
                ),
            ),
        )
        return formfields

    @property
    def qube(self):
        return self.make_generic_qube(format=OUTPUT_TYPES, reduce=["True", "False"])

    @property
    def model_assumptions(self):
        return {
            "format": "*",
            "reduce": "*",
        }

    def execute(self, product_spec, model, source):
        source = self.select_on_specification(product_spec, source)

        if product_spec.get("reduce", "True") == "True":
            for dim in source.nodes.dims:
                source = source.concatenate(dim)

        format = product_spec.get("format", "grib")

        conversion_payload = export_fieldlist_as(format=format)
        conversion_payload.func.__name__ = f"convert_to_{format}" # type: ignore # TODO fix typing, the lside should have always name

        source = source.map(conversion_payload).map(self.named_payload(f"output-{format}"))
        return source


@standard_product_registry("Deaccumulated")
class DeaccumulatedProduct(GenericTemporalProduct):
    """Deaccumulated Product."""

    allow_multiple_steps = True

    def validate_intersection(self, model):
        super_result = super().validate_intersection(model)
        return super_result and len(model.accumulations) > 0

    @property
    def qube(self):
        return self.make_generic_qube()

    def model_intersection(self, model: SpecifiedModel):
        """Model intersection with the product qube.

        Only the accumulation variables are used to create the intersection.
        """
        self_qube = self.make_generic_qube(param=model.accumulations or model.variables)

        intersection = model.qube(self.model_assumptions) & self_qube
        result = f"step={'/'.join(map(str, model.timesteps()))}" / intersection
        return result

    def execute(self, product_spec, model, source):
        deaccumulated = model.deaccumulate(source)
        assert deaccumulated is not None, "Model does not support deaccumulation."
        return self.select_on_specification(product_spec, deaccumulated).map(self.named_payload("deaccumulated"))
