# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Products API Router."""

from fastapi import APIRouter

from typing import Any

from forecastbox.products.product import Product, USER_DEFINED

from forecastbox.products.registry import get_categories, get_product, Category
from forecastbox.models import Model

from .model import get_model_path

from ..types import ConfigEntry, ProductConfiguration, ModelSpecification
from qubed import Qube


router = APIRouter(
    tags=["product"],
    responses={404: {"description": "Not found"}},
)

CONFIG_ORDER = ["param", "levtype", "levelist"]


def get_model(model: ModelSpecification) -> Model:
    """Get the model from the model repository."""

    model_dict = model.model_dump()
    model_path = get_model_path(model_dict.pop("model").replace("_", "/"))
    return Model(checkpoint_path=model_path, **model_dict)


def select_from_params(available_spec: Qube, params: dict[str, Any]) -> Qube:
    for key, val in params.items():
        if not val:
            continue
        if key in available_spec.axes() and USER_DEFINED in available_spec.span(key):
            # Dont select if open ended
            continue

        available_spec = available_spec.select(
            {key: str(val) if not isinstance(val, (list, tuple)) else list(map(str, val))}, consume=False
        )

    return available_spec


async def product_to_config(product: Product, modelspec: ModelSpecification, params: dict[str, Any]) -> dict[str, ConfigEntry]:
    """Convert a product to a configuration."""

    # product_spec = product.qube

    model_spec = get_model(modelspec)
    # model_qube = model_spec.qube(product.model_assumptions)

    available_product_spec = product.model_intersection(model_spec)
    subsetted_spec = select_from_params(available_product_spec, params)

    axes = subsetted_spec.axes()

    entries = {}
    for key, val in axes.items():
        # Add back in other options when selected
        constrained = []
        for k, v in params.items():
            if k == key or k not in params:
                continue

            if sorted(select_from_params(available_product_spec, {}).span(key)) != sorted(
                select_from_params(available_product_spec, {k: v}).span(key)
            ):
                constrained.append(product.label.get(k, k))

        val = select_from_params(available_product_spec, {k: v for k, v in params.items() if not k == key}).axes().get(key, val)

        entries[key] = ConfigEntry(
            label=product.label.get(key, key),
            description=product.description.get(key, None),
            values=set(val),
            example=product.example.get(key, None),
            multiple=product.multiselect.get(key, False),
            constrained_by=constrained,
            default=product.defaults.get(key, None),
        )

    for key in model_spec.ignore_in_select:
        entries.pop(key, None)

    return entries


@router.get("/categories")
async def api_get_categories() -> dict[str, Category]:
    """Get all categories."""
    return get_categories()


@router.post("/valid-categories")
async def get_valid_categories(modelspec: ModelSpecification) -> dict[str, Category]:
    model_spec = get_model(modelspec)

    categories = get_categories()
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
async def get_product_configuration(category: str, product: str, model: ModelSpecification, spec: dict[str, Any]) -> ProductConfiguration:
    prod = get_product(category, product)
    entries = await product_to_config(prod, model, spec)
    return ProductConfiguration(product=f"{category}/{product}", options=entries)
