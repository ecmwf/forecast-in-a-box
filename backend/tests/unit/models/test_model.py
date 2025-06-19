# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.


import datetime
from pathlib import Path
from qubed import Qube

from forecastbox.models.model import Model, ModelExtra

import pytest

from anemoi.inference.testing import fake_checkpoints
from anemoi.inference.checkpoint import Checkpoint

from earthkit.workflows import fluent


@pytest.fixture
def mock_checkpoint_path():
    """Fixture for a mock checkpoint path."""
    return (Path(__file__).parent / "../checkpoints/simple.yaml").absolute()


@pytest.fixture
@fake_checkpoints
def mock_checkpoint(mock_checkpoint_path) -> Checkpoint:
    return Checkpoint(mock_checkpoint_path)


@pytest.fixture
def test_model(mock_checkpoint_path, mock_checkpoint) -> Model:
    """Fixture for a test model."""

    class TestModel(Model):
        """Test model for testing purposes."""

        @property
        @fake_checkpoints
        def checkpoint(self):
            return mock_checkpoint

        def versions(self):
            """Checkpoint has no versions."""
            return {}

        @property
        def extra_information(self) -> ModelExtra:
            return ModelExtra()

    return TestModel(checkpoint_path=mock_checkpoint_path, lead_time=72, date="2023-01-01", ensemble_members=1)


@fake_checkpoints
def test_model_qube(test_model: Model):
    """Test the `qube` method of the model."""
    qube = test_model.qube({})
    assert isinstance(qube, Qube), "Qube should be an instance of Qube"

    assert "param" in qube.axes(), "Qube should have 'param' axis"
    assert qube.span("param") == ["10u", "10v", "2t", "q", "tcc", "tp"], "Qube 'param' axis should match expected values"
    assert "levtype" in qube.axes(), "Qube should have 'levtype' axis"
    assert qube.span("levtype") == ["pl", "sfc"], "Qube 'levtype' axis should match expected values"
    assert "levelist" in qube.axes(), "Qube should have 'levelist' axis"
    assert qube.span("levelist") == ["850"], "Qube 'levelist' axis should match expected values"
    assert "frequency" in qube.axes(), "Qube should have 'frequency' axis"
    assert qube.span("frequency") == [datetime.timedelta(hours=6)], "Qube 'frequency' axis should match expected values"


@fake_checkpoints
def test_model_qube_with_model_assumptions(test_model: Model):
    """Test the `qube` method of the model with model assumptions."""
    model_assumptions = {
        "options": ["value1", "value2"],
    }
    qube = test_model.qube(model_assumptions)
    assert isinstance(qube, Qube), "Qube should be an instance of Qube"
    assert "options" in qube.axes(), "Qube should have 'options' axis"
    assert qube.span("options") == ["value1", "value2"], "Qube 'options' axis should match expected values"


@pytest.fixture
def fake_initial_conditions() -> fluent.Action:
    return fluent.from_source(lambda x: x)


@fake_checkpoints
def test_graph_creation(fake_initial_conditions: fluent.Action, test_model: Model):
    """Test the creation of a graph from the model."""
    graph = test_model.graph(fake_initial_conditions)

    assert isinstance(graph, fluent.Action), "Graph should be an instance of fluent.Action"
