# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import logging

import numpy as np
from cascade.low.func import Either
from earthkit.workflows.fluent import Action, Payload, from_source, merge
from fiab_core.fable import (
    ActionLookup,
    BlockConfigurationOption,
    BlockInstanceOutput,
    ConfigurationOptionId,
    ConfigurationOptionRestriction,
    QubedOutput,
    RawOutput,
)
from fiab_core.plugin import Error
from fiab_core.tools.blocks import BlockInstanceConfigurationError, BlockInstanceRich, Sink, Source, Transform
from fiab_core.types import ClosedEnumType, DatetimeType, GeoDomainType, ListType, ParameterType, StringType
from pymetkit import ParamDB
from qubed import Qube

from .block_utils import (
    _axis_value_strings,
    _extract_dataset,
    _is_empty_qube,
    _param_id_to_param_key,
    _param_key_to_param_id,
    _parse_axis_value,
)
from .constants import (
    BASE_TIME,
    DIMENSION,
    DOMAIN,
    ENSEMBLE,
    FORECAST,
    FORMAT,
    GROUPBY,
    LEVEL,
    LEVTYPE,
    PARAM,
    PATH,
    SOURCE,
    SPLITBY,
    STEP,
    VALUES,
)
from .datasets import load_datasets
from .qubed_utils import axes, common_dimensions, contains, dimensions, expand, select

logger = logging.getLogger(__name__)

FORECAST_DATASETS = load_datasets()


class OperationalForecastSource(Source):
    title: str = "Operational forecast source"
    description: str = "Fetch operational forecast data from mars or ecmwf open data"
    configuration_options: dict[ConfigurationOptionId, BlockConfigurationOption] = {
        SOURCE: BlockConfigurationOption(
            title="Source",
            description="Top level source for earthkit data",
            value_type=ClosedEnumType(["mars", "ecmwf-open-data"]),
        ),
        FORECAST: BlockConfigurationOption(
            title="Forecast model",
            description="Name of forecast",
            value_type=ClosedEnumType(list(FORECAST_DATASETS)),
            default_value=list(FORECAST_DATASETS.keys())[0],
        ),
        BASE_TIME: BlockConfigurationOption(
            title="Base time",
            description="Base time of the forecast",
            value_type=DatetimeType(),
        ),
    }
    inputs: list[str] = []

    def _convert_time(cls, time: int) -> str:
        return f"{time:02d}00"

    def validate(
        self, block: BlockInstanceRich, inputs: dict[str, QubedOutput], restrictions: ConfigurationOptionRestriction
    ) -> BlockInstanceOutput:
        forecast = block.config_as_str(FORECAST)
        basetime = block.config_as_datetime(BASE_TIME)
        date = basetime.strftime("%Y%m%d")
        time = self._convert_time(basetime.time().hour)

        ifs_qoutput = QubedOutput(dataqube=FORECAST_DATASETS[forecast].as_qube(ens_dim=ENSEMBLE, include_member_zero=True))
        if not contains(ifs_qoutput, {"time": time}):
            raise ValueError(f"Invalid time: must be in {axes(ifs_qoutput)['time']}")

        return expand(select(ifs_qoutput, {"time": time}), {"date": [date]})

    def compile(
        self,
        inputs: ActionLookup,
        block: BlockInstanceRich,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        forecast = block.config_as_str(FORECAST)
        fc_preset = FORECAST_DATASETS[forecast]
        fc_qube = fc_preset.as_qube(ens_dim=ENSEMBLE)
        paramdb = ParamDB()

        basetime = block.config_as_datetime(BASE_TIME)
        date = basetime.strftime("%Y%m%d")
        time = self._convert_time(basetime.time().hour)

        subqube = fc_qube.select({"time": time}).compress()
        actions = []
        for levtype in subqube.axes()[LEVTYPE]:
            path = f"levtype={levtype}"
            levtype_actions = {}
            ens_branches = set()
            for index, datacube in enumerate(subqube.select({LEVTYPE: levtype}).datacubes()):
                ens_branch = f"{path}/{datacube[PARAM]}"
                datacube.update({"date": [date], "time": [time]})
                datacube_path = f"{ens_branch}/{index}"
                ens_branches.add(ens_branch)

                new_action = from_source(
                    np.asarray(
                        [
                            [
                                Payload(
                                    "fiab_plugin_ecmwf.runtime.source.earthkit_source",
                                    [block.config_as_str(SOURCE)],
                                    {
                                        "requests": [
                                            dict(
                                                {k: (v if len(v) > 1 else v[0]) for k, v in datacube.items()},
                                                param=paramdb.param_id_to_shortname(int(p)),
                                                step=step,
                                            )
                                        ],
                                    },
                                )
                                for p in datacube[PARAM]
                            ]
                            for step in datacube[STEP]
                        ]
                    ),
                    dims=[STEP, PARAM],
                    coords={STEP: datacube[STEP], PARAM: datacube[PARAM]},
                )
                expand_dims = [dim for dim, values in datacube.items() if (len(values) > 1 and dim not in [STEP, PARAM])]
                if len(expand_dims) > 0:
                    new_action = new_action.expand_as_qube(
                        Qube.from_datacube(datacube),
                        dims=expand_dims,
                    )
                new_action.set_scalar_coords(
                    {dim: values[0] for dim, values in datacube.items() if (len(values) == 1 and dim not in [STEP, PARAM])}
                )
                if fc_preset.is_member_zero(datacube):
                    new_action.set_scalar_coords({ENSEMBLE: 0}, override=True, make_dim=True)
                levtype_actions[datacube_path] = new_action
            merged = merge(**levtype_actions)
            for branch in ens_branches:
                merged = merged.combine_branches(dim=ENSEMBLE, path=branch)
            actions.append(merged)
        final_action = merge(*actions)
        return Either.ok(final_action)


class Select(Transform):
    title: str = "Select"
    description: str = "Select values from one dimension of the input dataset"
    configuration_options: dict[ConfigurationOptionId, BlockConfigurationOption] = {
        DIMENSION: BlockConfigurationOption(
            title="Dimension",
            description="Dimension to select from the dataset",
            value_type=StringType(),
        ),
        VALUES: BlockConfigurationOption(
            title="Values",
            description="Values to select from the chosen dimension",
            value_type=ListType(StringType()),
        ),
    }
    inputs: list[str] = ["dataset"]

    def _selected_dimension(self, block: BlockInstanceRich) -> ConfigurationOptionId:
        dimension = ConfigurationOptionId(block.config_as_str(DIMENSION))
        if not dimension:
            raise BlockInstanceConfigurationError(f"Configuration option '{DIMENSION}' must be provided")
        return dimension

    def _selected_values(self, block: BlockInstanceRich) -> list[str]:
        return block.config_as_list(VALUES, str, allow_empty=False)

    def validate(
        self, block: BlockInstanceRich, inputs: dict[str, QubedOutput], restrictions: ConfigurationOptionRestriction
    ) -> BlockInstanceOutput:
        input_dataset = _extract_dataset(inputs, "dataset")

        input_axes = axes(input_dataset)
        input_dimensions = sorted(dim for dim, values in input_axes.items() if len(values) > 1)
        if input_dimensions:
            restrictions[DIMENSION] = ClosedEnumType(input_dimensions)

        dimension = self._selected_dimension(block)

        axis_values = input_axes.get(dimension)
        if axis_values is None:
            raise ValueError(f"dimension {dimension} is not in the input dimensions: {input_dimensions}")

        input_values = _axis_value_strings(axis_values)
        if dimension == PARAM:
            axis_values = [_param_id_to_param_key(paramid) for paramid in axis_values]
            input_values = axis_values
        if input_values:
            restrictions[VALUES] = ListType(ClosedEnumType(input_values))

        selected_values = [_parse_axis_value(value) for value in self._selected_values(block)]

        missing_values = [value for value in selected_values if value not in axis_values]
        if missing_values:
            raise ValueError(f"values {missing_values} are not in dimension {dimension}: {input_values}")

        if dimension == PARAM:
            selected_values = [_param_key_to_param_id(str(value)) for value in selected_values]
        output = select(input_dataset, {dimension: selected_values})
        if output.dataqube is None or _is_empty_qube(output.dataqube):
            raise ValueError(f"selection of values {selected_values} from dimension {dimension} produced an empty dataset")

        return output

    def compile(
        self,
        inputs: ActionLookup,
        block: BlockInstanceRich,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        input_task = block.input_ids["dataset"]
        dimension = self._selected_dimension(block)
        if dimension == PARAM:
            values = [_param_key_to_param_id(value) for value in self._selected_values(block)]
            selected = inputs[input_task].select({dimension: values}, expand=True)
        else:
            values = [_parse_axis_value(value) for value in self._selected_values(block)]
            selected = inputs[input_task].select({dimension: values if len(values) > 1 else values[0]})
        return Either.ok(selected)

    def intersect(self, other: QubedOutput) -> bool:
        return bool(dimensions(other))
