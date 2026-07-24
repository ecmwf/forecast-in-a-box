# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import logging
import os
import re
from typing import Any, cast

import numpy as np
from cascade.low.func import Either
from earthkit.workflows.fluent import Action, Payload, from_source, merge
from earthkit.workflows.nodetree import nodetree_dimensions, nodetree_new_dimension
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
from fiab_core.tools.blocks import BlockInstanceConfigurationError, BlockInstanceRich, Product, Sink, Source, Transform
from fiab_core.types import ClosedEnumType, DatetimeType, GeoDomainType, ListType, StringType
from qubed import Qube

from .datasets import load_datasets
from .qubed_utils import axes, common_dimensions, contains, coxpand, dimensions, select

SOURCE = ConfigurationOptionId("source")
BASETIME = ConfigurationOptionId("base_time")
STATISTIC = ConfigurationOptionId("statistic")
PATH = ConfigurationOptionId("path")
DOMAIN = ConfigurationOptionId("domain")
FORMAT = ConfigurationOptionId("format")
PARAM = ConfigurationOptionId("param")
ENSEMBLE = ConfigurationOptionId("number")
STEP = ConfigurationOptionId("step")
LEVTYPE = ConfigurationOptionId("levtype")
LEVEL = ConfigurationOptionId("levelist")
DIMENSION = ConfigurationOptionId("dimension")
VALUES = ConfigurationOptionId("values")
GROUPBY = ConfigurationOptionId("groupby")
SPLITBY = ConfigurationOptionId("splitby")
FORECAST = ConfigurationOptionId("forecast")

GRIB_ALIASES = {
    "shortName": PARAM,
    "paramId": PARAM,
    "stepRange": STEP,
    "level": LEVEL,
}

GRIB_MIME = "text/plain; fiab-format=gribdir"

logger = logging.getLogger(__name__)

PLOT_FORMAT_TO_MIME: dict[str, str] = {
    "png": "image/png",
    "pdf": "application/pdf",
    "svg": "image/svg+xml",
}

FORECAST_DATASETS = load_datasets()


def _extract_dataset(inputs: dict[str, QubedOutput], name: str) -> QubedOutput:
    input_dataset = inputs.get(name)
    if not isinstance(input_dataset, QubedOutput):
        actual_type = type(input_dataset).__name__ if input_dataset is not None else "None"
        raise BlockInstanceConfigurationError(f"Unsupported input type for '{name}': expected QubedOutput, got {actual_type}")
    return input_dataset


def _is_empty_qube(qube: Qube) -> bool:
    return next(iter(qube.datacubes()), None) is None


def _restriction_value_strings(axis_values: set[Any], item_python_type: type[str] | type[int]) -> list[str]:
    if item_python_type is str:
        return sorted(value for value in axis_values if isinstance(value, str))
    if item_python_type is int:
        return [str(value) for value in sorted(value for value in axis_values if type(value) is int)]
    raise TypeError(f"Unsupported select value type {item_python_type!r}")


def _axis_value_strings(axis_values: set[Any]) -> list[str]:
    if all(isinstance(value, str) for value in axis_values):
        return _restriction_value_strings(axis_values, str)
    if all(type(value) is int for value in axis_values):
        return _restriction_value_strings(axis_values, int)
    return sorted(str(value) for value in axis_values)


def _parse_axis_value(value: str) -> str | int:
    try:
        int_value = int(value)
    except ValueError:
        return value
    return int_value if str(int_value) == value else value


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
        BASETIME: BlockConfigurationOption(
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
        basetime = block.config_as_datetime(BASETIME)
        time = self._convert_time(basetime.time().hour)

        ifs_qoutput = QubedOutput(dataqube=FORECAST_DATASETS[forecast].as_qube(ens_dim=ENSEMBLE, include_member_zero=True))
        if not contains(ifs_qoutput, {"time": time}):
            raise ValueError(f"Invalid time: must be in {axes(ifs_qoutput)['time']}")

        return select(ifs_qoutput, {"time": time})

    def compile(
        self,
        inputs: ActionLookup,
        block: BlockInstanceRich,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        forecast = block.config_as_str(FORECAST)
        fc_preset = FORECAST_DATASETS[forecast]
        fc_qube = fc_preset.as_qube(ens_dim=ENSEMBLE)

        basetime = block.config_as_datetime(BASETIME)
        date = basetime.date().isoformat()
        time = self._convert_time(basetime.time().hour)

        subqube = fc_qube.select({"time": time}).compress()
        actions = []
        for levtype in subqube.axes()[LEVTYPE]:
            path = f"levtype={levtype}"
            levtype_actions = {}
            ens_branches = set()
            for index, datacube in enumerate(subqube.select({LEVTYPE: levtype}).datacubes()):
                ens_branch = f"{path}/{datacube[PARAM]}"
                datacube_path = f"{ens_branch}/{index}"
                expansion_datacube = datacube.copy()
                coords = {PARAM: datacube[PARAM]}
                if fc_preset.is_member_zero(datacube):
                    coords[ENSEMBLE] = 0
                ens_branches.add(ens_branch)

                levtype_actions[datacube_path] = from_source(
                    np.asarray(
                        [
                            Payload(
                                "fiab_plugin_ecmwf.runtime.source.earthkit_source",
                                [block.config_as_str(SOURCE)],
                                {
                                    "requests": [
                                        dict(
                                            {k: (v if len(v) > 1 else v[0]) for k, v in datacube.items()},
                                            date=date,
                                            time=time,
                                            param=p,
                                        )
                                    ],
                                },
                            )
                            for p in datacube[PARAM]
                        ]
                    ),
                    dims=[PARAM],
                    coords=coords,
                ).expand_as_qube(Qube.from_datacube(expansion_datacube), dims=[STEP, ENSEMBLE, LEVTYPE, LEVEL])
            merged = merge(**levtype_actions)
            for branch in ens_branches:
                merged = merged.combine_branches(dim=ENSEMBLE, path=branch)
            actions.append(merged)
        final_action = merge(*actions)
        return Either.ok(final_action)


class EnsembleStatistics(Product):
    title: str = "Ensemble Statistics"
    description: str = "Computes ensemble mean or standard deviation"
    configuration_options: dict[ConfigurationOptionId, BlockConfigurationOption] = {
        PARAM: BlockConfigurationOption(title="Parameter", description="Parameter name like '2t'", value_type=StringType()),
        STATISTIC: BlockConfigurationOption(
            title="Statistic",
            description="Statistic to compute over the ensemble",
            value_type=ClosedEnumType(["mean", "std"]),
        ),
    }
    inputs: list[str] = ["dataset"]

    def validate(
        self, block: BlockInstanceRich, inputs: dict[str, QubedOutput], restrictions: ConfigurationOptionRestriction
    ) -> BlockInstanceOutput:
        input_dataset = _extract_dataset(inputs, "dataset")

        param = block.config_as_str(PARAM)
        if not contains(input_dataset, {PARAM: param}):
            raise ValueError(f"param {param} is not in the input parameters: {axes(input_dataset).get(PARAM, [])}")

        output = coxpand(input_dataset, [PARAM, ENSEMBLE], {PARAM: [param]})
        return output

    def compile(
        self,
        inputs: ActionLookup,
        block: BlockInstanceRich,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        input_task = block.input_ids["dataset"]
        input_task_action = inputs[input_task]
        stat = block.config_as_str(STATISTIC)
        param = input_task_action.select({PARAM: block.config_as_str(PARAM)})
        if stat == "mean":
            action = param.mean(dim=ENSEMBLE)
        elif stat == "std":
            action = param.std(dim=ENSEMBLE)
        else:
            return Either.error(f"Unsupported statistic '{stat}'")
        return Either.ok(action)

    def intersect(self, other: QubedOutput) -> bool:
        return contains(other, ENSEMBLE) and contains(other, PARAM)


class TemporalStatistics(Product):
    title: str = "Temporal Statistics"
    description: str = "Computes temporal statistics"
    configuration_options: dict[ConfigurationOptionId, BlockConfigurationOption] = {
        PARAM: BlockConfigurationOption(title=PARAM, description="Param name like '2t'", value_type=StringType()),
        STATISTIC: BlockConfigurationOption(
            title="Statistic",
            description="Statistic to compute over steps",
            value_type=ClosedEnumType(["mean", "std", "min", "max"]),
        ),
    }
    inputs: list[str] = ["dataset"]

    def validate(
        self, block: BlockInstanceRich, inputs: dict[str, QubedOutput], restrictions: ConfigurationOptionRestriction
    ) -> BlockInstanceOutput:
        input_dataset = _extract_dataset(inputs, "dataset")

        param = block.config_as_str(PARAM)
        if not contains(input_dataset, {PARAM: param}):
            raise ValueError(f"param {param} is not in the input parameters: {axes(input_dataset).get(PARAM, [])}")
        output = coxpand(input_dataset, [PARAM, STEP], {PARAM: [param]})
        return output

    def compile(
        self,
        inputs: ActionLookup,
        block: BlockInstanceRich,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        input_task = block.input_ids["dataset"]
        input_task_action = inputs[input_task]
        stat = block.config_as_str(STATISTIC)
        param = input_task_action.select({PARAM: block.config_as_str(PARAM)})
        if stat == "mean":
            action = param.mean(dim=STEP)
        elif stat == "std":
            action = param.std(dim=STEP)
        elif stat == "min":
            action = param.min(dim=STEP)
        elif stat == "max":
            action = param.max(dim=STEP)
        else:
            return Either.error(f"Unsupported temporal statistic: {stat}")
        return Either.ok(action)

    def intersect(self, other: QubedOutput) -> bool:
        return contains(other, STEP) and contains(other, PARAM)


class ZarrSink(Sink):
    title: str = "Zarr Sink"
    description: str = "Write dataset to a zarr on the local filesystem"
    configuration_options: dict[ConfigurationOptionId, BlockConfigurationOption] = {
        PATH: BlockConfigurationOption(
            title="Zarr Path",
            description="Filesystem path where the zarr should be written",
            value_type=StringType(),
        )
    }
    inputs: list[str] = ["dataset"]

    def validate(
        self, block: BlockInstanceRich, inputs: dict[str, QubedOutput], restrictions: ConfigurationOptionRestriction
    ) -> BlockInstanceOutput:
        _extract_dataset(inputs, "dataset")
        return RawOutput(type_fqn="bytes", mime_type="text/plain")

    def compile(
        self,
        inputs: ActionLookup,
        block: BlockInstanceRich,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        input_task = block.input_ids["dataset"]

        temp_dim = nodetree_new_dimension(inputs[input_task].nodes)
        action = (
            inputs[input_task]
            .flatten(new_dim=temp_dim, reset_coords=True)
            .combine_branches(dim=temp_dim)
            .concatenate(dim=temp_dim)
            .map(
                Payload(
                    "fiab_plugin_ecmwf.runtime.sinks.write_zarr",
                    kwargs={"path": block.config_as_str(PATH)},
                    metadata={"environment": ["zarr"]},
                )
            )
        )
        return Either.ok(action)

    def intersect(self, other: QubedOutput) -> bool:
        return bool(dimensions(other))


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

        input_dimensions = sorted(dimensions(input_dataset))
        if input_dimensions:
            restrictions[DIMENSION] = ClosedEnumType(input_dimensions)

        dimension = self._selected_dimension(block)

        input_axes = axes(input_dataset)
        axis_values = input_axes.get(dimension)
        if axis_values is None:
            raise ValueError(f"dimension {dimension} is not in the input dimensions: {input_dimensions}")

        input_values = _axis_value_strings(axis_values)
        if input_values:
            restrictions[VALUES] = ListType(ClosedEnumType(input_values))

        selected_values = [_parse_axis_value(value) for value in self._selected_values(block)]

        missing_values = [value for value in selected_values if value not in axis_values]
        if missing_values:
            raise ValueError(f"values {missing_values} are not in dimension {dimension}: {input_values}")

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
        values = [_parse_axis_value(value) for value in self._selected_values(block)]
        selected = inputs[input_task].select({dimension: values if len(values) > 1 else values[0]})
        return Either.ok(selected)

    def intersect(self, other: QubedOutput) -> bool:
        return bool(dimensions(other))


class GribSink(Sink):
    title: str = "GRIB Sink"
    description: str = "Write dataset to a GRIB file on the local filesystem"
    configuration_options: dict[ConfigurationOptionId, BlockConfigurationOption] = {
        PATH: BlockConfigurationOption(
            title="GRIB Path",
            description="Filesystem path where the GRIB file should be written. Filename can contain template values from metadata in [] brackets.",
            value_type=StringType(),
        )
    }
    inputs: list[str] = ["dataset"]

    def _find_template_values(cls, path: str) -> list[str]:
        return re.findall(r"\[(.*?)\]", path)

    def validate(
        self, block: BlockInstanceRich, inputs: dict[str, QubedOutput], restrictions: ConfigurationOptionRestriction
    ) -> BlockInstanceOutput:
        _extract_dataset(inputs, "dataset")  # check format of input and existence of dataset
        path = block.config_as_str(PATH)
        dirname = os.path.dirname(path)
        if len(self._find_template_values(dirname)) != 0:
            raise ValueError("Invalid filepath: directory path can not contain template values")
        return RawOutput(type_fqn="bytes", mime_type=GRIB_MIME)

    def compile(
        self,
        inputs: ActionLookup,
        block: BlockInstanceRich,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        input_task = block.input_ids["dataset"]
        path_dims = self._find_template_values(block.config_as_str(PATH))
        action_dims = nodetree_dimensions(inputs[input_task].nodes)
        keep_dims = []
        for dim in path_dims:
            mapped_dim = GRIB_ALIASES.get(dim, dim)
            if mapped_dim in action_dims and mapped_dim not in keep_dims:
                keep_dims.append(mapped_dim)
        temp_dim = nodetree_new_dimension(inputs[input_task].nodes)
        action = inputs[input_task].flatten(new_dim=temp_dim, keep_dims=keep_dims, reset_coords=True).concatenate(dim=temp_dim)
        try:
            if PARAM in keep_dims:
                action = action.combine_branches(dim=PARAM)
            else:
                action = action.combine_branches(dim=temp_dim).concatenate(dim=temp_dim)
        except:
            pass

        action = action.map(
            Payload(
                "fiab_plugin_ecmwf.runtime.sinks.write_grib",
                kwargs={"path": block.config_as_str(PATH)},
            )
        )
        return Either.ok(action)

    def intersect(self, other: QubedOutput) -> bool:
        return bool(dimensions(other))


class MapPlotSink(Sink):
    title: str = "Map Plot"
    description: str = "Render a geographic map using earthkit-plots"
    configuration_options: dict[ConfigurationOptionId, BlockConfigurationOption] = {
        PARAM: BlockConfigurationOption(
            title="Parameters",
            description="Parameters to select and plot (e.g. '2t', 'msl')",
            value_type=ListType(StringType()),
        ),
        DOMAIN: BlockConfigurationOption(
            title="Domain",
            description="Area to display: auto (fit the data), global, a named region/country (select several to union), or a drawn bounding box",
            value_type=GeoDomainType(),
            default_value="global",
        ),
        FORMAT: BlockConfigurationOption(
            title="Format",
            description="Output image format",
            value_type=ClosedEnumType(["png", "pdf", "svg"]),
            default_value="png",
        ),
        GROUPBY: BlockConfigurationOption(
            title="Group By",
            description="Dimension to create subplots over",
            value_type=ClosedEnumType(["valid_datetime", "step", "number", "none"]),
            default_value="none",
        ),
        SPLITBY: BlockConfigurationOption(
            title="Split By",
            description="Dimensions to separate plots by",
            value_type=ListType(StringType()),
            default_value="step",
        ),
        # ConfigurationOptionId("style_schema"): BlockConfigurationOption(
        #     title="Style Schema",
        #     description="earthkit-plots schema identifier",
        #     value_type=StringType(),
        # ),
    }
    inputs: list[str] = ["dataset"]

    def validate(
        self, block: BlockInstanceRich, inputs: dict[str, QubedOutput], restrictions: ConfigurationOptionRestriction
    ) -> BlockInstanceOutput:
        input_dataset = _extract_dataset(inputs, "dataset")

        input_axes = axes(input_dataset)
        input_param_values = input_axes.get(PARAM, set())
        param_values = [value for value in input_param_values if isinstance(value, str)]
        if param_values:
            restrictions[PARAM] = ListType(ClosedEnumType(sorted(param_values)))

        common = common_dimensions(input_dataset).intersection({PARAM, STEP, ENSEMBLE, LEVEL})
        splitby = [x for x in common if len(input_axes[x]) > 1]
        restrictions[SPLITBY] = ListType(ClosedEnumType(sorted(splitby) + ["none"]))

        params = block.config_as_list(PARAM, str, allow_empty=False)
        splitby_value = block.config_as_list(SPLITBY, str, allow_empty=True)
        fmt = block.config_as_str(FORMAT)

        missing_params = [param for param in params if param not in input_param_values]
        if missing_params:
            raise ValueError(f"params {missing_params} are not in the input parameters: {_axis_value_strings(input_param_values)}")

        if "none" in splitby_value and len(splitby_value) != 1:
            raise ValueError("Invalid splitby value: if none is selected, no other dimensions can be present")

        mime_type = PLOT_FORMAT_TO_MIME.get(fmt)
        if mime_type is None:
            raise ValueError(f"Unsupported output format: {fmt}")
        return RawOutput(type_fqn="bytes", mime_type=mime_type)

    def compile(
        self,
        inputs: ActionLookup,
        block: BlockInstanceRich,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        input_task = block.input_ids["dataset"]
        params = block.config_as_list(PARAM, str, allow_empty=False)
        groupby = block.config_as_str(GROUPBY)
        splitby = block.config_as_list(SPLITBY, str, allow_empty=True)
        if "none" in splitby:
            splitby = []

        selected = (
            inputs[input_task]
            .combine_branches(dim=PARAM, force=True)
            .select({PARAM: params if len(params) > 1 else params[0]})
            .flatten(new_dim="temp_dim", keep_dims=splitby, reset_coords=True)
            .concatenate(dim="temp_dim")
        )

        action = selected.map(
            Payload(
                "fiab_plugin_ecmwf.runtime.plots.map_plot",
                kwargs={
                    "domain": block.config_as_geodomain(DOMAIN).with_bbox_earthkitplots().value or None,
                    "format": block.config_as_str(FORMAT),
                    "groupby": None if groupby == "none" else groupby,
                    # "style_schema": block.config_as_str("style_schema") or "inbuilt://fiab",
                },
                metadata={"environment": ["earthkit-plots<1.0.0", "earthkit-regrid<1.0.0", "matplotlib<3.11"]},
            )
        )
        return Either.ok(action)

    def intersect(self, other: QubedOutput) -> bool:
        return contains(other, PARAM)
