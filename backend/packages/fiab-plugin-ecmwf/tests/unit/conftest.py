# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.


from datetime import datetime
from typing import cast

import pytest
from earthkit.workflows.fluent import Action
from fiab_core.artifacts import CompositeArtifactId
from fiab_core.fable import (
    BlockFactoryId,
    BlockInstanceId,
    QubedOutput,
)
from fiab_core.fable import (
    BlockInstance as BlockInstanceBase,
)
from fiab_core.tools.blocks import BlockInstanceRich as BlockInstance
from qubed import Qube

from fiab_plugin_ecmwf.anemoi.blocks import AnemoiSource
from fiab_plugin_ecmwf.block_utils import (
    BASE_TIME,
    CHECKPOINT,
    ENSEMBLE,
    FORECAST,
    INPUT_SOURCE,
    LEAD_TIME,
    PARAM,
    SOURCE,
    STATISTIC,
    STEP,
)
from fiab_plugin_ecmwf.blocks import (
    FORECAST_DATASETS,
    OperationalForecastSource,
)
from fiab_plugin_ecmwf.datasets import ForecastDataset
from fiab_plugin_ecmwf.products.blocks import EnsembleStatistics
from fiab_plugin_ecmwf.qubed_utils import select


class MockedForecastDataset(ForecastDataset):
    def as_qube(self, ens_dim: str = "number", include_member_zero: bool = False, **extra: dict) -> Qube:
        full_qube = super().as_qube(ens_dim, include_member_zero=include_member_zero, **extra)
        selected_qube = full_qube.select(
            {
                PARAM: ["165", "166", "167", "168", "169", "175", "176", "177", "228021", "47", "151", "140232", "140232", "131", "132"],
                STEP: ["0", "6", "12"],
                ENSEMBLE: ["0", "1", "2", "3", "4"],
            }
        )
        return selected_qube


@pytest.fixture
def mock_forecast_preset(monkeypatch: pytest.MonkeyPatch) -> None:
    mocked_datasets = {
        name: MockedForecastDataset(FORECAST_DATASETS[name].datacubes, FORECAST_DATASETS[name].member_zero, False)
        for name in FORECAST_DATASETS.keys()
    }
    for name, dataset in mocked_datasets.items():
        monkeypatch.setitem(FORECAST_DATASETS, name, dataset)


@pytest.fixture
def dummy_blockinstance() -> BlockInstance:
    return BlockInstance.from_block(
        BlockFactoryId("dummy"),
        BlockInstanceBase(
            input_ids={},
            configuration_values={
                SOURCE: "ecmwf-open-data",
                BASE_TIME: datetime(2024, 1, 1),
                FORECAST: "aifs-ens",
            },
        ),
        OperationalForecastSource.configuration_options,
    )


@pytest.fixture
def dummy_blockinstance_output() -> QubedOutput:
    return QubedOutput()


@pytest.fixture
def sample_forecast_source_output(dummy_blockinstance: BlockInstance) -> QubedOutput:
    oper_output = cast(QubedOutput, OperationalForecastSource().validate(block=dummy_blockinstance, inputs={}, restrictions={}))
    return select(oper_output, {PARAM: ["167", "151", "131"], STEP: [0, 6, 12], ENSEMBLE: [0, 1, 2, 3, 4]})


@pytest.fixture
def sample_forecast_source_action(mock_forecast_preset: pytest.FixtureRequest, dummy_blockinstance: BlockInstance) -> Action:
    oper_action = OperationalForecastSource().compile(inputs={}, block=dummy_blockinstance).get_or_raise()
    return oper_action.select({PARAM: ["167", "151", "131"], STEP: [0, 6, 12], ENSEMBLE: [0, 1, 2, 3, 4]}, expand=True)


@pytest.fixture
def anemoi_source_ensemble_configuration(dummy_checkpoint: CompositeArtifactId) -> BlockInstance:
    return BlockInstance.from_block(
        BlockFactoryId("anemoiSource"),
        BlockInstanceBase(
            input_ids={},
            configuration_values={
                CHECKPOINT: dummy_checkpoint,
                INPUT_SOURCE: "opendata",
                LEAD_TIME: 24,
                BASE_TIME: datetime(2024, 1, 1),
                ENSEMBLE: 3,
            },
        ),
        AnemoiSource.configuration_options,
    )


@pytest.fixture
def anemoi_source_ensemble_output(anemoi_source_ensemble_configuration: BlockInstance) -> QubedOutput:
    return AnemoiSource().validate(block=anemoi_source_ensemble_configuration, inputs={}, restrictions={})  # type: ignore[return-value]


@pytest.fixture
def anemoi_source_ensemble_action(anemoi_source_ensemble_configuration: BlockInstance) -> Action:
    return AnemoiSource().compile(inputs={}, block=anemoi_source_ensemble_configuration).get_or_raise()


@pytest.fixture(params=list(FORECAST_DATASETS.keys()))
def dataset(request: pytest.FixtureRequest) -> str:
    return request.param


@pytest.fixture
def operational_forecast_blockinstance(dataset: str) -> BlockInstance:
    return BlockInstance.from_block(
        BlockFactoryId("dummy"),
        BlockInstanceBase(
            input_ids={},
            configuration_values={
                SOURCE: "ecmwf-open-data",
                BASE_TIME: datetime(2024, 1, 1),
                FORECAST: dataset,
            },
        ),
        OperationalForecastSource.configuration_options,
    )


@pytest.fixture
def operational_forecast_source_output(operational_forecast_blockinstance: BlockInstance) -> QubedOutput:
    oper_output = cast(
        QubedOutput, OperationalForecastSource().validate(block=operational_forecast_blockinstance, inputs={}, restrictions={})
    )
    return select(oper_output, {PARAM: ["167", "151", "131"], STEP: [0, 6, 12], ENSEMBLE: [0, 1, 2, 3, 4]})


@pytest.fixture
def operational_forecast_source_action(
    mock_forecast_preset: pytest.FixtureRequest, operational_forecast_blockinstance: BlockInstance
) -> Action:
    oper_action = OperationalForecastSource().compile(inputs={}, block=operational_forecast_blockinstance).get_or_raise()
    return oper_action.select({PARAM: ["167", "151", "131"], STEP: [0, 6, 12], ENSEMBLE: [0, 1, 2, 3, 4]}, expand=True)


@pytest.fixture
def ensemble_statistics_configuration() -> BlockInstance:
    return BlockInstance.from_block(
        BlockFactoryId("ensembleStatistics"),
        BlockInstanceBase(
            input_ids={"dataset": BlockInstanceId("source_output")},
            configuration_values={
                STATISTIC: ["mean"],
            },
        ),
        EnsembleStatistics.configuration_options,
    )
