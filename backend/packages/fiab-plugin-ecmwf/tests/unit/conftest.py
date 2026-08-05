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
from fiab_core.fable import (
    BlockFactoryId,
    BlockInstanceId,
    QubedOutput,
)
from fiab_core.fable import (
    BlockInstance as BlockInstanceBase,
)
from fiab_core.tools.blocks import BlockInstanceRich as BlockInstance

from fiab_plugin_ecmwf.block_utils import (
    BASETIME,
    ENSEMBLE,
    FORECAST,
    PARAM,
    SOURCE,
    STATISTIC,
    STEP,
)
from fiab_plugin_ecmwf.blocks import (
    OperationalForecastSource,
)
from fiab_plugin_ecmwf.products.blocks import EnsembleStatistics
from fiab_plugin_ecmwf.qubed_utils import select


@pytest.fixture(params=["aifs-ens", "ifs-ens"])
def dataset(request: pytest.FixtureRequest) -> str:
    return request.param


@pytest.fixture
def dummy_blockinstance(dataset: str) -> BlockInstance:
    return BlockInstance.from_block(
        BlockFactoryId("dummy"),
        BlockInstanceBase(
            input_ids={},
            configuration_values={
                SOURCE: "ecmwf-open-data",
                BASETIME: datetime(2024, 1, 1),
                FORECAST: dataset,
            },
        ),
        OperationalForecastSource.configuration_options,
    )


@pytest.fixture
def dummy_blockinstance_output() -> QubedOutput:
    return QubedOutput()


@pytest.fixture
def operational_forecast_source_output(dummy_blockinstance: BlockInstance) -> QubedOutput:
    oper_output = cast(QubedOutput, OperationalForecastSource().validate(block=dummy_blockinstance, inputs={}, restrictions={}))
    return select(oper_output, {PARAM: ["167", "151", "131"], STEP: [0, 6, 12], ENSEMBLE: [0, 1, 2, 3, 4]})


@pytest.fixture
def operational_forecast_source_action(dummy_blockinstance: BlockInstance) -> Action:
    oper_action = OperationalForecastSource().compile(inputs={}, block=dummy_blockinstance).get_or_raise()
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
