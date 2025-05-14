from pathlib import Path
from qubed import Qube

from forecastbox.products.product import GenericParamProduct, Product
from forecastbox.models import Model

import pytest

from anemoi.inference.testing import fake_checkpoints


@pytest.fixture
def mock_checkpoint_path():
    """Fixture for a mock checkpoint path."""
    return (Path(__file__).parent / "../checkpoints/simple.yaml").absolute()


@pytest.fixture
@fake_checkpoints
def mock_checkpoint(mock_checkpoint_path):
    from anemoi.inference.checkpoint import Checkpoint

    Checkpoint(mock_checkpoint_path).diagnostic_variables
    return Checkpoint(mock_checkpoint_path)


@pytest.fixture
def test_product():
    """Fixture for a test product."""

    class TestProduct(GenericParamProduct):
        """Test product for testing purposes."""

        @property
        def qube(self) -> Qube:
            return self.make_generic_qube(options=["value1", "value2"])

        @property
        def model_assumptions(self):
            return {
                "options": "*",
            }

        def to_graph(self, product_spec, model, source):
            pass

    return TestProduct()


@pytest.fixture
def test_model(mock_checkpoint_path, mock_checkpoint):
    """Fixture for a test model."""

    class TestModel(Model):
        """Test model for testing purposes."""

        @property
        @fake_checkpoints
        def checkpoint(self):
            return mock_checkpoint

    return TestModel(checkpoint_path=mock_checkpoint_path, lead_time=72, date="2023-01-01", ensemble_members=1)


@fake_checkpoints
def test_product_selection(test_model: Model, test_product: Product):
    model_qube = test_model.qube(test_product.model_assumptions)
    assert model_qube.select({"options": "value1"})

    product_qube = test_product.model_intersection(test_model)
    assert "options" in product_qube.axes()

    assert product_qube.axes()["options"] == set(["value1", "value2"])


@pytest.mark.parametrize(
    "product_spec, expected",
    [
        ({"options": "value1"}, True),
        ({"options": "value2"}, True),
        ({"options": "value3"}, False),
        ({"other": "value3"}, False),
        ({"param": "2t"}, True),
        ({"param": "2t", "options": "value1"}, True),
    ],
)
@fake_checkpoints
def test_product_selection_with_different_options(test_model: Model, test_product: Product, product_spec, expected):
    product_qube = test_product.model_intersection(test_model)
    selected_space = product_qube.select(product_spec)

    for key, val in product_spec.items():
        assert (
            key in selected_space.axes()
        ) == expected, f"Key {key}: {val} should{'' if expected else ' not'} be in product qube axes, {selected_space.axes()}"
