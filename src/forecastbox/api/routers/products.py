"""Products API Router."""

from fastapi import APIRouter

from typing import Any, Optional
from dataclasses import dataclass

from forecastbox.products.product import Product

from ..models import convert_to_model_spec, open_checkpoint
from forecastbox.products.registry import get_categories, get_product_list, get_product

router = APIRouter(
    tags=["products"],
    responses={404: {"description": "Not found"}},
)

@dataclass
class ConfigEntry():
    """Configuration Entry"""
    label: str
    """Label of the configuration entry"""
    description: str | None
    """Description of the configuration entry"""
    values: Optional[list[str]] = None
    """Available values for the configuration entry"""
    example: Optional[str] = None
    """Example value for the configuration entry"""
    select: bool = True
    """Whether the configuration entry is a select"""
    multiselect: bool = False
    """Whether the configuration entry is a multiselect"""

@dataclass
class ProductConfig():
    """Product Configuration"""
    product: str
    """Product name"""
    entries: dict[str, ConfigEntry]
    """Configuration entries"""

def sort_values(values: list[str]) -> list[str]:
    """Sort values."""
    try:
        return sorted(values, key=float)
    except ValueError:
        pass
    return sorted(values, key=lambda x: x.lower())

def product_to_config(product: Product, selected_model: str, params: dict[str, Any]) -> ProductConfig:
    """Convert a product to a configuration."""

    from qubed import Qube
    product_spec = product.qube
    model_spec = convert_to_model_spec(open_checkpoint(selected_model))
    selected_spec = Qube.from_datacube({k: v for k,v in params.items() if v})

    available_product_spec =  product_spec & model_spec
    print(selected_spec, available_product_spec)

    for key, val in selected_spec.axes().items():
      print(key, val)
      available_product_spec = available_product_spec.select({key: list(val)})


    print(product_spec, model_spec)
    print(available_product_spec)

    for key in product_spec.axes().keys():
        if key not in available_product_spec.axes() and key not in model_spec.axes():
            val = product_spec.select({k: list(v) for k,v in available_product_spec.axes().items()}).axes().get(key, None)
            if val is None:
                continue
            val_as_str = val if isinstance(val, str) else "/".join(str(v) for v in val)
            available_product_spec = f"{key}={val_as_str}" / available_product_spec

    axes = available_product_spec.axes()

    entries = {key: ConfigEntry(product.label.get(key, key), product.description.get(key, None), sort_values(list(val)), product.example.get(key, None)) for key, val in axes.items()}
    return ProductConfig(product.__class__.__name__, entries)



@router.get("/categories")
async def api_get_categories():
    return get_categories()

@router.get("/categories/{key}")
async def get_categories_specific(key):
    return get_product_list(key)

@router.post("/configuration/{category}/{product}")
def get_product_configuration(category, product: str, params: dict):
    selected_model = params['model']
    spec = params['spec']
    
    prod = get_product(category, product) 

    conf = product_to_config(prod, selected_model, spec)
    return conf.entries