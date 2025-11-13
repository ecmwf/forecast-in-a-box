# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Products API Router."""

import re
from collections import OrderedDict
from collections.abc import Iterable
from typing import Any

import forecastbox.rjsf.utils as rjsfutils
from fastapi import APIRouter, HTTPException
from forecastbox.models import SpecifiedModel, get_model
from forecastbox.products.interfaces import Interfaces
from forecastbox.products.product import USER_DEFINED, Product
from forecastbox.products.registry import Category, get_categories, get_product
from forecastbox.rjsf import ExportedSchemas, FieldWithUI, FormDefinition, StringSchema
from qubed import Qube

from ..types import ModelSpecification
from .model import get_model_path

router = APIRouter(
    tags=["product"],
    responses={404: {"description": "Not found"}},
)

CONFIG_ORDER = ["param", "levtype", "levelist", "step"]
"""Order of configuration parameters for display purposes."""


def create_model(model: ModelSpecification) -> SpecifiedModel:
    """Get the model from the local model repository."""

    model_dict = model.model_dump()
    model_obj = get_model(checkpoint=get_model_path(model_dict.pop("model").replace("_", "/")))
    return model_obj.specify(**model_dict)


def select_from_params(available_spec: Qube, params: dict[str, Any]) -> Qube:
    """Select from the available specification based on the provided parameters."""
    for key, val in params.items():
        if not val:
            continue

        if key in available_spec.axes() and USER_DEFINED in available_spec.span(key):
            # Don't select if open ended
            continue

        available_spec = available_spec.select(
            {key: str(val) if not isinstance(val, (list, tuple, set)) else list(map(str, val))}, consume=False
        )

    return available_spec


def _sort_values(values: Iterable[Any]) -> Iterable[Any]:
    """Sort values in a way that numbers come before strings, and numbers are sorted numerically."""
    convert = lambda text: int(text) if text.isdigit() else text
    alphanum_key = lambda key: [convert(c) for c in re.split("([0-9]+)", key)]
    return sorted(values, key=alphanum_key)


def _convert_to_int(value: Iterable[Any]) -> Any:
    """Convert a value to int if it is a digit."""
    if all(isinstance(v, str) and v.isdigit() for v in value):
        return [float(v) for v in value]
    return value


def _sort_fields(fields: dict) -> dict:
    new_fields = OrderedDict()
    for key in CONFIG_ORDER:
        if key in fields:
            new_fields[key] = fields[key]

    for key in fields:
        if key not in new_fields:
            new_fields[key] = fields[key]

    return new_fields


def product_to_config(product: Product, model_spec: ModelSpecification, params: dict[str, Any]) -> ExportedSchemas:
    """Convert a product to a configuration dictionary.

    Parameters
    ----------
    product : Product
        Product Specification
    model_spec : ModelSpecification
        Specification of the model to use for the product.
    params : dict[str, Any]
        Params from the user to apply to the the product configuration.

    Returns
    -------
    ExportedSchemas
        Schema to make form from.
    """

    # product_spec = product.qube

    model = create_model(model_spec)
    # model_qube = model_spec.qube(product.model_assumptions)

    available_product_spec = product.model_intersection(model)
    subsetted_spec = select_from_params(available_product_spec, params)

    axes = subsetted_spec.axes()

    fields = {}
    for key, val in axes.items():
        constrained = []

        inferred_constraints = {}

        # Check if the current axis is being constrained by another parameter
        for k, v in params.items():
            # Skip if the key is the same as the current key or not in params
            if k == key or k not in params:
                continue

            # Has a key: val in params constrained the current key
            if sorted(select_from_params(available_product_spec, {}).span(key)) != sorted(
                select_from_params(available_product_spec, {k: v}).span(key)
            ):
                constrained.append(k)

            # Has this key: val in the subsetted_spec constrained another axis
            selected_span = select_from_params(available_product_spec, {key: val}).span(k)
            if len(selected_span) == 1 and not selected_span[0] == USER_DEFINED:
                inferred_constraints[k] = selected_span[0]

        # Select from the available product specification based on all parameters except the current key
        updated_params = {**params, **inferred_constraints}
        val = select_from_params(available_product_spec, {k: v for k, v in updated_params.items() if not k == key}).axes().get(key, val)

        field = FieldWithUI(jsonschema=StringSchema(title=key))

        if key in product.formfields:
            # Use the product formfield if available
            field = product.formfields[key]

        if USER_DEFINED not in available_product_spec.span(key):
            try:
                field = rjsfutils.update_enum_within_field(field, _convert_to_int(_sort_values(list(set(val)))))
            except TypeError:
                pass

        field = rjsfutils.collapse_enums_if_possible(field)
        fields[key] = field
        # TODO: Add constraints to the field

        # fields[key] = ConfigEntry(
        #     label=product.label.get(key, key),
        #     description=product.description.get(key, None),
        #     values=set(val),
        #     example=product.example.get(key, None),
        #     multiple=product.multiselect.get(key, False),
        #     constrained_by=constrained,
        #     default=product.defaults.get(key, None),
        # )

    for key in model.ignore_in_select:
        fields.pop(key, None)

    form = FormDefinition(
        title=getattr(product, "_name", product.__class__.__name__),
        fields=_sort_fields(fields),
        required=list(fields.keys()),
    )
    return form.export_all()


@router.get("/categories/{interface}")
async def api_get_categories(interface: Interfaces) -> dict[str, Category]:
    """Get all categories for an interface."""
    return get_categories(interface)


@router.post("/categories/{interface}")
async def get_valid_categories(interface: Interfaces, modelspec: ModelSpecification) -> dict[str, Category]:
    """Get valid categories for a given interface and model specification.

    Parameters
    ----------
    interface : Interfaces
        Interface to get categories for.
    modelspec : ModelSpecification
        Model specification to validate against the categories.

    Returns
    -------
    dict[str, Category]
        Dictionary of categories with available options based on the model specification.
    """
    model_spec = create_model(modelspec)

    categories = get_categories(interface)
    for key, category in categories.items():
        options = []
        for product in category.options:
            prod = get_product(key, product)

            if prod.validate_intersection(model_spec):
                category.available = True
                options.append(product)
            else:
                category.unavailable_options.append(product)
        category.options = sorted(options)
    return categories


@router.post("/configuration/{category}/{product}")
async def get_product_configuration(category: str, product: str, model: ModelSpecification, spec: dict[str, Any]) -> ExportedSchemas:
    """Get the product configuration for a given category and product.

    Validates the product against the model specification and returns a configuration object.

    Parameters
    ----------
    category : str
        Category of the product.
    product : str
        Product name.
    model : ModelSpecification
        Model specification to validate against the product.
    spec : dict[str, Any]
        Specification parameters to apply to the product configuration.

    Returns
    -------
    ExportedSchemas
        Schema to make form from.
    """
    try:
        prod = get_product(category, product)
        return product_to_config(prod, model, spec)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=f"Product not found: {e}")
