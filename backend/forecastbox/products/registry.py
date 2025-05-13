# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""
Registry of products
"""

from dataclasses import dataclass, field
from typing import Callable, Type

from .product import Product

PRODUCTS: dict[str, "CategoryRegistry"] = {}


@dataclass
class Category:
    """Category information"""

    title: str
    description: str
    options: list[str]
    unavailable_options: list[str] = field(default_factory=list)

    available: bool = False


class CategoryRegistry:
    def __init__(self, category: str, description: str, title: str | None = None):
        """
        Register a product category.

        Parameters
        ----------
        category : str
            Category name
        description : str
            Category description
        title : str, optional
            Category title, by default None

        Returns
        -------
        Callable
            Decorator Function
        """
        PRODUCTS[category] = self
        self._products: dict[str, Type[Product]] = {}

        self._description = description
        self._title = title or category

    def to_category_info(self) -> Category:
        return Category(
            title=self._title, description=self._description, options=set(map(str, self._products.keys()))
        )  # {"title": self._title, "description": self._description, "options": list(map(str, self._products.keys()))}

    def __call__(self, product: str) -> Callable:
        """
        Register a product.

        Parameters
        ----------
        product : str
            Product name

        Returns
        -------
        Callable
            Decorator Function
        """

        def decorator(func: type[Product]) -> type[Product]:
            self._products[product] = func
            return func

        return decorator

    @property
    def products(self) -> dict[str, Type[Product]]:
        return self._products

    def __getitem__(self, key: str) -> Type[Product]:
        return self._products[key]

    def __contains__(self, key: str) -> bool:
        return key in self._products


def get_categories() -> dict[str, Category]:
    """Get category information."""
    return {key: val.to_category_info() for key, val in sorted(PRODUCTS.items(), key=lambda x: x[0])}


def get_product_list(category: str) -> list[str]:
    """Get products for a category."""
    return sorted(PRODUCTS[category].products.keys())


def get_product(category: str, product: str) -> Product:
    """Get a product."""
    return PRODUCTS[category][product]()
