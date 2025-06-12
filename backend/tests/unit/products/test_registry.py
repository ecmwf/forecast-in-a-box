# (C) Copyright 2025- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import pytest

from forecastbox.products.registry import CategoryRegistry, PRODUCTS, get_categories, get_product, get_product_list
from forecastbox.products.interfaces import Interfaces


@pytest.fixture(scope="module")
def mocked_products_global_dict():
    """Fixture to mock the global PRODUCTS dictionary."""
    original_products = PRODUCTS.copy()
    PRODUCTS.clear()
    yield
    PRODUCTS.clear()
    PRODUCTS.update(original_products)


def test_category_registry_initialisation(mocked_products_global_dict):
    """Test the initialization of CategoryRegistry."""
    CategoryRegistry("test_category", description="Test category", title="Test Category")
    assert "test_category" in PRODUCTS
    assert isinstance(PRODUCTS["test_category"], CategoryRegistry)

    assert "test_category" in get_categories()


def test_category_registry_initialisation_with_interface(mocked_products_global_dict):
    """Test the initialization of CategoryRegistry with interfaces."""
    CategoryRegistry(
        "test_category_with_interface",
        interface="detailed",
        description="Test category with interface",
        title="Test Category with Interface",
    )
    assert "test_category_with_interface" in PRODUCTS
    assert isinstance(PRODUCTS["test_category_with_interface"], CategoryRegistry)

    assert "test_category_with_interface" in get_categories()
    assert "test_category_with_interface" in get_categories(Interfaces.ALL)
    assert "test_category_with_interface" in get_categories(Interfaces.DETAILED)
    assert "test_category_with_interface" not in get_categories(Interfaces.STANDARD)


@pytest.fixture
def mocked_category_registry(mocked_products_global_dict):
    """Fixture to create a mockßed CategoryRegistry."""
    registry = CategoryRegistry("mocked_category", description="Mocked category", title="Mocked Category")
    return registry


@pytest.fixture
def mocked_product():
    """Fixture to create a mocked product."""

    class MockProduct:
        name = "mock_product"
        description = "This is a mock product."
        options = ["option1", "option2"]

    return MockProduct


def test_category_registry_add_product(mocked_category_registry: CategoryRegistry, mocked_product):
    """Test adding a product to the CategoryRegistry."""

    mocked_category_registry("mock_product")(mocked_product)

    assert "mock_product" in mocked_category_registry.products
    assert mocked_category_registry.products["mock_product"] == mocked_product

    assert get_product_list("mocked_category") == ["mock_product"]
    assert isinstance(get_product("mocked_category", "mock_product"), mocked_product)
    assert get_categories(Interfaces.ALL)["mocked_category"].options == ["mock_product"]
