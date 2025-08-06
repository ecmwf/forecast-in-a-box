# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Registry of products"""

from collections.abc import Callable
from dataclasses import dataclass, field

from .interfaces import Interfaces
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
    def __init__(
        self,
        category: str,
        interface: Interfaces | list[Interfaces] = Interfaces.ALL,
        description: str | None = None,
        title: str | None = None,
    ):
        """Register a product category.

        Parameters
        ----------
        category : str
            Category name
        description : str
            Category description
        interface : Interfaces | list[Interfaces] | None, optional
            Interface(s) for the category, by default None
        title : str, optional
            Category title, by default None

        Returns
        -------
        Callable
            Decorator Function
        """
        PRODUCTS[category] = self
        self._products: dict[str, type[Product]] = {}

        self.interface = [interface] if not isinstance(interface, list) else interface
        self._description = description
        self._title = title or category

    def to_category_info(self) -> Category:
        return Category(
            title=self._title, description=self._description, options=list(map(str, self._products.keys()))
        )  # {"title": self._title, "description": self._description, "options": list(map(str, self._products.keys()))}

    def __call__(self, product: str) -> Callable[[type[Product]], type[Product]]:
        """Register a product.

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
    def products(self) -> dict[str, type[Product]]:
        return self._products

    def __getitem__(self, key: str) -> type[Product]:
        return self._products[key]

    def __contains__(self, key: str) -> bool:
        return key in self._products

    def __repr__(self) -> str:
        return f"CategoryRegistry({self._title}, {self._description}, {self.interface})"


def get_categories(interface: Interfaces = Interfaces.ALL) -> dict[str, Category]:
    """Get product categories.

    If an interface is provided, only return categories for that interface.
    If no interface is provided, return all categories.
    """
    valid_categories = {
        key: val
        for key, val in PRODUCTS.items()
        if interface == Interfaces.ALL or (Interfaces.ALL in val.interface) or (interface in val.interface)
    }
    return {key: val.to_category_info() for key, val in sorted(valid_categories.items(), key=lambda x: x[0])}


def get_product_list(category: str) -> list[str]:
    """Get products for a category."""
    return sorted(PRODUCTS[category].to_category_info().options)


def get_product(category: str, product: str) -> Product:
    """Get a product."""
    return PRODUCTS[category][product]()
