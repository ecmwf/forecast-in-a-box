"""Products API Router."""

from fastapi import APIRouter

from typing import Optional
from dataclasses import dataclass

from forecastbox.products.registry import get_categories

router = APIRouter(
    tags=["products"],
    responses={404: {"description": "Not found"}},
)

@dataclass
class ConfigEntry():
    """Configuration Entry"""
    label: str
    """Label of the configuration entry"""
    description: str
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
    entries: list[ConfigEntry]
    """Configuration entries"""

    
categories = {
  "ensemble": {
    "title": "Ensemble",
    "description": "Capture the distribution of the ensemble",
    "options": ['Quantiles', 'EFI', 'ENSMS', 'Threshold']
  },
  "deterministic": {
    "title": "Deterministic",
    "description": "Deterministic Products",
    "options": ['Vertical Profile', 'WindSpeed']
  },
  "extreme": {
    "title": "Extreme Events",
    "description": "Extreme Products",
    "options": ['Quantiles', 'EFI', 'ENSMS']
  },
  "anomalies": {
    "title": "Climatological Anomalies",
    "description": "Deterministic Products",
    "options": ['Quantiles', 'EFI', 'ENSMS']
  },
#   "instance": {
#     "title": "Instance Defined",
#     "description": "Deterministic Products",
#     "options": ['Quantiles', 'EFI', 'ENSMS']
#   },
#   "user": {
#     "title": "User Defined",
#     "description": "Deterministic Products",
#     "options": ['Quantiles', 'EFI', 'ENSMS']
#   }
}

@router.get("/categories")
async def api_get_categories():
    return get_categories()

@router.get("/categories/{key}")
async def get_categories_specific(key):
    return categories[key]

@router.post("/configuration/{product}")
def get_product_configuration(product: str, params: dict):
    return {
        "test": ConfigEntry("test", "test", ["test1", "test2"]),
        product: ConfigEntry(product, "test", ["test1", "test2", str(params)]),
        'NoSelect': ConfigEntry('Notallowed', "test", [])
        }