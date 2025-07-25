# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.


from pathlib import Path
from qubed import Qube

from forecastbox.products.product import GenericParamProduct, Product
from forecastbox.models import Model

import pytest


def create_test_product(axis: dict[str, list[str]]) -> Product:
    """Create a test product with specified axis.

    Does not modify the model assumptions.
    """

    class TestProduct(Product):
        """Test product for testing purposes."""

        @property
        def qube(self) -> Qube:
            return Qube.from_datacube(axis)

        @property
        def model_assumptions(self):
            return {}

        def execute(self, product_spec, model, source):
            raise NotImplementedError("Testing")

    product = TestProduct()

    assert product.qube == Qube.from_datacube(axis), "Product qube should match the provided axis"
    assert product.validate_intersection(create_test_model(axis)), "Product should be valid with the test model"
    return product


def create_test_model(axis: dict[str, list[str]]) -> Model:
    """Create a test model with specified axis."""

    class TestModel(Model):
        """Test model for testing purposes."""

        def qube(self, model_assumptions) -> Qube:
            assert model_assumptions == {}, "Model assumptions should be empty for this test"
            return Qube.from_datacube(axis)

        @property
        def checkpoint(self):
            return None  # No checkpoint needed for this test

    model = TestModel(checkpoint_path=Path(__file__), lead_time=72, date="2023-01-01", ensemble_members=1)
    assert model.qube({}) == Qube.from_datacube(axis), "Model qube should match the provided axis"

    return model


def test_product_selection():
    """Test the selection of a product with a model."""
    product = create_test_product(dict(options=["value1", "value2"]))
    model = create_test_model(dict(options=["value1", "value2"]))

    assert product.validate_intersection(model), "Product should be valid with the model"

    product_qube = product.model_intersection(model)
    assert "options" in product_qube.axes(), "Product qube should have 'options' axis"

    assert product_qube.axes()["options"] == set(["value1", "value2"]), "Product qube should have 'value1' and 'value2' in 'options' axis"


@pytest.mark.parametrize(
    "product_axis, model_axis, expected",
    [
        ({"options": ["value1", "value2"]}, {"options": ["value1", "value2"]}, True),
        ({"options": ["value1", "value2"]}, {"options": ["value3"]}, False),
        ({"options": ["value1", "value2"]}, {"options": ["value2", "value3"]}, True),
        ({"other": ["value3"]}, {"options": ["value1", "value2"]}, False),
        ({"param": ["2t"]}, {"param": ["2t"]}, True),
        ({"param": ["2t"], "options": ["value1"]}, {"param": ["2t"], "options": ["value1", "value2"]}, True),
    ],
)
def test_product_validity(product_axis, model_axis, expected):
    """Test the validity of a product with a model based on axis."""
    product = create_test_product(product_axis)
    model = create_test_model(model_axis)

    assert (
        product.validate_intersection(model) == expected
    ), f"Product with axis {product_axis} should{' not' if not expected else ''} be valid with model axis {model_axis}"


def test_generic_param_product():
    """Test the GenericParamProduct class."""

    class TestGeneric(GenericParamProduct):
        """Test product for testing purposes."""

        def execute(self, product_spec, model, source):
            raise NotImplementedError("Testing")

        @property
        def qube(self) -> Qube:
            return self.make_generic_qube()

    product = TestGeneric()
    qube = product.make_generic_qube(options=["value1", "value2"])

    assert isinstance(qube, Qube), "Generic product should return a Qube"
    assert qube.span("options") == ["value1", "value2"], "Generic product Qube should have 'value1' and 'value2' in 'options' axis"

    # assert qube.span('param') == ["*"], "Generic product Qube should have '*' in 'param' axis" # Cannot check due to wildcard nature of 'param'
