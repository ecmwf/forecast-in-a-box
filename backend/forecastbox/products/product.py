# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

from abc import ABC, abstractmethod
from collections import OrderedDict
from typing import Any, Union

from earthkit.workflows import fluent
from earthkit.workflows.fluent import Action
from earthkit.workflows.graph import Graph
from qubed import Qube

from forecastbox.models import SpecifiedModel
from forecastbox.rjsf import ArraySchema, FieldSchema, FieldWithUI, IntegerSchema, StringSchema


class Product(ABC):
    """Base Product Class"""

    @property
    def _name(self):
        """Name of the product, used for display purposes."""
        return self.__class__.__name__

    @property
    def formfields(self) -> OrderedDict[str, "FieldWithUI"]:
        return OrderedDict()

    def _make_field(self, multiple: bool = True, schema: type[FieldSchema] = StringSchema, **kwargs):
        if multiple:
            return FieldWithUI(
                jsonschema=ArraySchema(
                    title=kwargs.pop("title", None),
                    description=kwargs.pop("description", None),
                    items=schema(**kwargs),
                    uniqueItems=True,
                    minItems=1,
                ),
            )
        return FieldWithUI(
            jsonschema=schema(**kwargs),
        )

    @property
    @abstractmethod
    def qube(self) -> "Qube":
        """Requirements of the product to be used with a Model Qube."""
        pass

    @property
    def data_requirements(self) -> "Qube":
        """Data requirements for the product."""
        return Qube.from_datacube({})

    @property
    def model_assumptions(self) -> dict[str, Any]:
        """Model assumptions for the product."""
        return {}

    def select_on_specification(self, specification: dict[str, Any], source: "Action") -> "Action":
        """Select from `source` the key:value pairs from `specification`."""

        # Handle levelist specification where param is flattened
        # into a list of param_levelist
        if "levelist" in specification:
            levelist = specification.pop("levelist")
            if isinstance(levelist, str):
                levelist = [levelist]
            if isinstance(specification["param"], str):
                specification["param"] = [f"{specification['param']}_{lev}" for lev in levelist]
            else:
                specification["param"] = [f"{par}_{lev}" for par in specification["param"] for lev in levelist]

        for key, value in specification.items():
            if not value:
                continue
            if key not in source.nodes.dims:
                continue

            def convert_to_int(value: Any) -> Any:
                """Convert value to int if it is a digit."""
                try:
                    return_val = int(value)
                    if not str(return_val) == value:
                        return float(value)
                    return return_val
                except ValueError:
                    return value

            original_value = value

            if isinstance(value, str):
                value = convert_to_int(value)
            if isinstance(value, list):
                value = [convert_to_int(v) for v in value]

            if isinstance(value, list):
                if not all(str(value[i]) == original_value[i] for i in range(len(original_value))):
                    value = original_value
            else:
                if str(value) != original_value:
                    value = original_value

            value = value if isinstance(value, (list, tuple)) else [value]

            if any(isinstance(v, str) and v == "*" for v in value):
                # If the value is '*', we skip the selection
                continue
            source = source.sel(**{key: value})  # type: ignore
        return source

    def validate_intersection(self, model: SpecifiedModel) -> bool:
        """Validate the intersection of the model and product qubes.

        By default, if `model_assumptions` are provided, the intersection must contain all of them.
        Otherwise, the intersection must be non-empty.
        """
        model_intersection = self.model_intersection(model)

        if self.model_assumptions:
            return all(k in model_intersection.axes() for k in self.model_assumptions.keys())

        return len(model_intersection.axes()) > 0

    def model_intersection(self, model: SpecifiedModel) -> "Qube":
        """Get the intersection of the model and product qubes."""
        return model.qube(self.model_assumptions) & self.qube

    def named_payload(self, name: str) -> fluent.Payload:
        """Get an empty payload with a name."""

        def payload(x):
            return x

        payload.__name__ = name
        return fluent.Payload(payload)

    @abstractmethod
    def execute(self, product_spec: dict[str, Any], model: SpecifiedModel, source: "Action") -> Union["Graph", "Action"]:
        raise NotImplementedError()


class GenericParamProduct(Product):
    """Generic Param Product"""

    allow_multiple_params = True
    allow_multiple_levels = True

    @property
    def formfields(self) -> OrderedDict[str, "FieldWithUI"]:
        """Form fields for the product."""
        formfields = super().formfields.copy()
        formfields.update(
            param=self._make_field(
                title="Parameter",
                multiple=self.allow_multiple_params,
            ),
            levtype=FieldWithUI(
                jsonschema=StringSchema(
                    title="Level Type",
                ),
            ),
            levelist=self._make_field(
                title="Level List",
                schema=IntegerSchema,
                multiple=self.allow_multiple_levels,
            ),
        )
        return formfields

    @property
    def generic_params(self) -> dict[str, Any]:
        """Specification for generic parameters for a Qube."""
        return {
            "frequency": "*",
            "levtype": "*",
            "param": "*",
            "levelist": "*",
        }

    def validate_intersection(self, model: SpecifiedModel) -> bool:
        """Validate the intersection of the model and product qubes."""
        axes = self.model_intersection(model).axes()
        return all(k in axes for k in self.generic_params if not k == "levelist")

    def make_generic_qube(self, **kwargs) -> "Qube":
        """Make a generic Qube, including the intersection of pl and sfc."""

        generic_params_without_levelist = self.generic_params.copy()
        generic_params_without_levelist.pop("levelist")
        generic_params_without_levelist.update(kwargs)

        generic_params = self.generic_params.copy()
        generic_params.update(kwargs)

        return Qube.from_datacube(
            {
                **generic_params,
            }
        ) | Qube.from_datacube(
            {
                **generic_params_without_levelist,
            }
        )


class GenericTemporalProduct(GenericParamProduct):
    """Generic Temporal Product.

    Adds step as an axis to the product qube, and configures
    the formfields to include step.
    """

    allow_multiple_steps = True
    """Whether the product allows multiple steps."""

    @property
    def formfields(self) -> OrderedDict[str, "FieldWithUI"]:
        """Form fields for the product."""
        formfields = super().formfields.copy()
        formfields.update(
            step=self._make_field(
                title="Step",
                multiple=self.allow_multiple_steps,
                schema=IntegerSchema,
            ),
        )
        return formfields

    def model_intersection(self, model: SpecifiedModel) -> Qube:
        """Get model intersection.

        Add step as axis to the model intersection.
        """
        intersection = super().model_intersection(model)
        result = f"step={'/'.join(map(str, model.timesteps()))}" / intersection
        return result


USER_DEFINED = "USER_DEFINED"
"""User defined value, used to indicate that the value is not known."""
