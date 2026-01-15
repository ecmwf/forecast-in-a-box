# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

from typing import cast

import earthkit.data
from cascade.low.func import Either
from earthkit.workflows.fluent import Payload, from_source
from fiab_core.fable import (
    BlockConfigurationOption,
    BlockFactory,
    BlockFactoryCatalogue,
    BlockFactoryId,
    BlockInstance,
    BlockInstanceId,
    BlockInstanceOutput,
    DataPartitionLookup,
    XarrayOutput,
)
from fiab_core.plugin import Error, Plugin

IFS_REQUEST = {
    "class": "od",
    "stream": "enfo",
    "param": ["10u", "10v", "2d", "2t", "msl", "skt", "sp", "stl1", "stl2", "tcw", "msl"],
    "levtype": "sfc",
    "step": list[range(0, 361, 6)],
    "type": "pf",
    "number": list(range(1, 51)),
}
ENSEMBLE_DIM = "number"
STEP_DIM = "step"


ekdSource = BlockFactory(
    kind="source",
    title="Earthkit Data Source",
    description="Fetch data from mars or ecmwf open data",
    configuration_options={
        "source_name": BlockConfigurationOption(
            title="Source", description="Top level source for earthkit data", value_type="enum['mars', 'ecmwf-open-data']"
        ),
        "date": BlockConfigurationOption(title="Date", description="The date dimension of the data", value_type="date-iso8601"),
        "expver": BlockConfigurationOption(title="Expver", description="The expver value of the forecast", value_type="str"),
    },
    inputs=[],
)

# Product types:
# - derived parameters (e.g. wind speed, thermal indices) [param]
# - temporal statistics (e.g. weekly or monthly means) [step]
# - ensemble statistics (e.g. ensms, probabilities, significance) [param?, step?, number]
# Chaining allows building complex products (e.g. monthly ensemble mean of wind speed)
# How product is produced depends on the forecast - so can not be statically defined
ensembleStatistics = BlockFactory(
    kind="product",
    title="Ensemble Statistics",
    description="Computes ensemble mean or standard deviation",
    configuration_options={
        "variable": BlockConfigurationOption(title="Variable", description="Variable name like '2t'", value_type="str"),
        "statistic": BlockConfigurationOption(
            title="Statistic", description="Statistic to compute over the ensemble", value_type="enum['mean', 'std']"
        ),
    },
    inputs=["dataset"],
)

catalogue = BlockFactoryCatalogue(
    factories={
        "ekdSource": ekdSource,
        "ensembleStatistics": ensembleStatistics,
    },
)


def validator(block: BlockInstance, inputs: dict[str, BlockInstanceOutput]) -> Either[BlockInstanceOutput, Error]:  # type: ignore[invalid-argument] # semigroup
    output: XarrayOutput
    match block.factory_id.factory:
        case "ekdSource":
            output = XarrayOutput(variables=IFS_REQUEST["param"], coords={x: IFS_REQUEST[x] for x in [STEP_DIM, ENSEMBLE_DIM]})
        case "ensembleStatistics":
            input_dataset = cast(XarrayOutput, inputs["dataset"])  # type:ignore[redundant-cast] # NOTE the warning is correct but we expect more
            variable = block.configuration_values["variable"]
            if variable not in input_dataset.variables:
                return Either.error(f"variable {variable} is not in the input variables: {input_dataset.variables}")
            output = XarrayOutput(variables=[variable], coords=[STEP_DIM])
        case unmatched:
            raise TypeError(f"unexpected factory id {unmatched}")
    return Either.ok(output)


def expander(block: BlockInstanceOutput) -> list[BlockFactoryId]:
    products = []
    if isinstance(block, XarrayOutput):
        if ENSEMBLE_DIM in block.coords:
            products.append("ensembleStatistics")
    return products


def compiler(partitions: DataPartitionLookup, block_id: BlockInstanceId, block: BlockInstance) -> Either[DataPartitionLookup, Error]:  # type: ignore[invalid-argument] # semigroup
    match block.factory_id.factory:
        case "ekdSource":
            action = (
                from_source(
                    [
                        Payload(
                            earthkit.data.from_source,
                            [block.configuration_values["source"]],
                            {"request": {**IFS_REQUEST, "param": param}},
                        )
                        for param in IFS_REQUEST["param"]
                    ],
                    coords={x: IFS_REQUEST[x] for x in ["param"]},
                )
                .expand((ENSEMBLE_DIM, IFS_REQUEST["number"]), "number")
                .expand((STEP_DIM, IFS_REQUEST["step"]), "step")
            )
        case "ensembleStatistics":
            input_task = block.input_ids["dataset"]
            input_task_action = partitions[input_task]
            stat = block.configuration_values["statistic"]
            param = input_task_action.select(param=block.configuration_values["variable"])
            if stat == "mean":
                action = param.mean(dim=ENSEMBLE_DIM)
            elif stat == "std":
                action = param.std(dim=ENSEMBLE_DIM)
        case unmatched:
            raise TypeError(f"unexpected factory id {unmatched}")

    partitions[block_id] = action
    return Either.ok(partitions)


plugin = Plugin(
    catalogue=catalogue,
    validator=validator,
    expander=expander,
    compiler=compiler,
)
