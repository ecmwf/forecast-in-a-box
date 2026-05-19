# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import logging
from typing import Any, cast
import os
import re

import numpy as np
from cascade.low.func import Either
from earthkit.workflows.fluent import Action, Payload, from_source
from fiab_core.fable import (
    ActionLookup,
    BlockConfigurationOption,
    BlockInstanceId,
    BlockInstanceOutput,
    ConfigurationOptionId,
    ConfigurationOptionRestriction,
    NoOutput,
    QubedOutput,
    RawOutput,
)
from fiab_core.plugin import Error
from fiab_core.tools.blocks import BlockInstanceRich as BlockInstance
from fiab_core.tools.blocks import Product, Sink, Source, Transform
from fiab_core.types import ClosedEnumType, ListType
from qubed import Qube

from .qubed_utils import axes, contains, coxpand, dimensions

SOURCE = ConfigurationOptionId("source")
DATE = ConfigurationOptionId("date")
EXPVER = ConfigurationOptionId("expver")
STATISTIC = ConfigurationOptionId("statistic")
PATH = ConfigurationOptionId("path")
DOMAIN = ConfigurationOptionId("domain")
FORMAT = ConfigurationOptionId("format")
PARAM = ConfigurationOptionId("param")
ENSEMBLE = ConfigurationOptionId("number")
STEP = ConfigurationOptionId("step")

IFS_REQUEST = {
    "class": "od",
    "stream": "enfo",
    "param": [
        "10u",
        "10v",
        "2d",
        "2t",
        "msl",
        "skt",
        "sp",
        "stl1",
        "stl2",
        "tcw",
        "msl",
    ],
    "levtype": "sfc",
    "step": list(range(0, 61, 6)),
    "type": "pf",
    "number": list(range(1, 6)),
}

GRIB_ALIASES = {
    "shortName": PARAM_DIM,
    "paramId": PARAM_DIM,
    "stepRange": "step",
    "level": "levelist",
}

logger = logging.getLogger(__name__)

PLOT_FORMAT_TO_MIME: dict[str, str] = {
    "png": "image/png",
    "pdf": "application/pdf",
    "svg": "image/svg+xml",
}


class EkdSource(Source):
    title: str = "Earthkit Data Source"
    description: str = "Fetch data from mars or ecmwf open data"
    configuration_options: dict[ConfigurationOptionId, BlockConfigurationOption] = {
        SOURCE: BlockConfigurationOption(
            title="Source",
            description="Top level source for earthkit data",
            value_type="enumClosed['mars', 'ecmwf-open-data']",
        ),
        DATE: BlockConfigurationOption(
            title="Date",
            description="The date dimension of the data",
            value_type="date",
        ),
        EXPVER: BlockConfigurationOption(
            title="Expver",
            description="The expver value of the forecast",
            value_type="str",
        ),
        PARAM: BlockConfigurationOption(
            title="Parameters",
            description="Parameters to select and plot (e.g. '2t', 'msl')",
            value_type="list[str]",
        ),
        STEP: BlockConfigurationOption(
            title="Steps",
            description="Forecast steps to select (e.g. '0,6,12,...')",
            value_type="list[int]",
        ),
        ENSEMBLE: BlockConfigurationOption(
            title="Ensemble Members",
            description="Ensemble members to select (e.g. '1,2,3,...')",
            value_type="list[int]",
        ),
    }
    inputs: list[str] = []

    def validate(self, block: BlockInstance, inputs: dict[str, QubedOutput]) -> Either[BlockInstanceOutput, Error]:  # type:ignore[invalid-argument] # semigroup
        param = block.config_as_list(PARAM, str, allow_empty=False)
        step = block.config_as_list(STEP, int)
        ensemble = block.config_as_list(ENSEMBLE, int)

        output = QubedOutput(
            dataqube=Qube.from_datacube(
                {
                    PARAM: param,
                    ENSEMBLE: ensemble,
                    STEP: step,
                }
            )
        )
        return Either.ok(output)

    def compile(
        self,
        inputs: ActionLookup,
        block_id: BlockInstanceId,
        block: BlockInstance,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        param = block.config_as_list(PARAM, str, allow_empty=False)
        step = block.config_as_list(STEP, int)
        ensemble = block.config_as_list(ENSEMBLE, int)

        action = (
            from_source(
                np.asarray(
                    [
                        Payload(
                            "fiab_plugin_ecmwf.runtime.source.earthkit_source",
                            [block.config_as_str(SOURCE)],
                            {
                                "request": {
                                    **IFS_REQUEST,
                                    "date": block.config_as_date(DATE).isoformat(),
                                    "expver": block.config_as_str(EXPVER),
                                    PARAM: p,
                                    ENSEMBLE: ensemble,
                                    STEP: step,
                                }
                            },
                        )
                        for p in param
                    ]
                ),
                coords={PARAM: param},
            )
            .expand(
                (ENSEMBLE, ensemble),
                "number",
                dim_size=len(ensemble),
                backend_kwargs={"method": "isel"},
            )
            .expand(
                (STEP, step),
                "step",
                dim_size=len(step),
                backend_kwargs={"method": "isel"},
            )
        )
        return Either.ok(action)


class EnsembleStatistics(Product):
    title: str = "Ensemble Statistics"
    description: str = "Computes ensemble mean or standard deviation"
    configuration_options: dict[ConfigurationOptionId, BlockConfigurationOption] = {
        PARAM: BlockConfigurationOption(title="Parameter", description="Parameter name like '2t'", value_type="str"),
        STATISTIC: BlockConfigurationOption(
            title="Statistic",
            description="Statistic to compute over the ensemble",
            value_type="enumClosed['mean', 'std']",
        ),
    }
    inputs: list[str] = ["dataset"]

    def validate(self, block: BlockInstance, inputs: dict[str, QubedOutput]) -> Either[BlockInstanceOutput, Error]:  # type:ignore[invalid-argument] # semigroup
        input_dataset = inputs["dataset"]

        param = block.config_as_str(PARAM)
        if not contains(input_dataset, {PARAM: param}):
            return Either.error(f"param {param} is not in the input parameters: {axes(input_dataset).get(PARAM, [])}")

        output = coxpand(input_dataset, [PARAM, ENSEMBLE], {PARAM: [param]})
        return Either.ok(output)

    def compile(
        self,
        inputs: ActionLookup,
        block_id: BlockInstanceId,
        block: BlockInstance,
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
        PARAM: BlockConfigurationOption(title=PARAM, description="Param name like '2t'", value_type="str"),
        STATISTIC: BlockConfigurationOption(
            title="Statistic",
            description="Statistic to compute over steps",
            value_type="enumClosed['mean', 'std', 'min', 'max']",
        ),
    }
    inputs: list[str] = ["dataset"]

    def validate(self, block: BlockInstance, inputs: dict[str, QubedOutput]) -> Either[BlockInstanceOutput, Error]:  # type:ignore[invalid-argument] # semigroup
        input_dataset = inputs["dataset"]

        param = block.config_as_str(PARAM)
        if not contains(input_dataset, {PARAM: param}):
            return Either.error(f"param {param} is not in the input parameters: {axes(input_dataset).get(PARAM, [])}")
        output = coxpand(input_dataset, [PARAM, STEP], {PARAM: [param]})
        return Either.ok(output)

    def compile(
        self,
        inputs: ActionLookup,
        block_id: BlockInstanceId,
        block: BlockInstance,
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
            value_type="str",
        )
    }
    inputs: list[str] = ["dataset"]

    def validate(self, block: BlockInstance, inputs: dict[str, QubedOutput]) -> Either[BlockInstanceOutput, Error]:  # type:ignore[invalid-argument] # semigroup
        return Either.ok(RawOutput(type_fqn="bytes", mime_type="text/plain"))

    def compile(
        self,
        inputs: ActionLookup,
        block_id: BlockInstanceId,
        block: BlockInstance,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        input_task = block.input_ids["dataset"]

        action = (
            inputs[input_task]
            .flatten(new_dim="**temp1**", reset_coords=True)
            .combine_branches(dim="**temp1**")
            .concatenate(dim="**temp1**")
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


SelectAxisValue = str | int


class SelectDimension(Transform):
    inputs: list[str] = ["dataset"]

    def __init__(
        self,
        *,
        option_id: ConfigurationOptionId,
        item_python_type: type[str] | type[int],
        selection_label: str,
    ) -> None:
        label_title = selection_label.title()
        label_sentence = selection_label[:1].upper() + selection_label[1:]

        self.title = f"Select {label_title}"
        self.description = f"Select {selection_label} from the input dataset"
        self.option_id = option_id
        self.item_python_type = item_python_type
        self.selection_label = selection_label
        self.configuration_options = {
            option_id: BlockConfigurationOption(
                title=label_title,
                description=f"{label_sentence} to select from the dataset",
                value_type=f"list[{self._value_type_name()}]",
            )
        }

    def _value_type_name(self) -> str:
        if self.item_python_type is str:
            return "str"
        if self.item_python_type is int:
            return "int"
        raise TypeError(f"Unsupported select value type {self.item_python_type!r}")

    def _selected_values(self, block: BlockInstance) -> list[SelectAxisValue]:
        if self.item_python_type is str:
            return cast(list[SelectAxisValue], block.config_as_list(self.option_id, str, allow_empty=False))
        if self.item_python_type is int:
            return cast(list[SelectAxisValue], block.config_as_list(self.option_id, int, allow_empty=False))
        raise TypeError(f"Unsupported select value type {self.item_python_type!r}")

    def validate(self, block: BlockInstance, inputs: dict[str, QubedOutput]) -> Either[BlockInstanceOutput, Error]:  # type:ignore[invalid-argument] # semigroup
        input_dataset = inputs.get("dataset")
        if not isinstance(input_dataset, QubedOutput):
            actual_type = type(input_dataset).__name__ if input_dataset is not None else "None"
            return Either.error(f"Unsupported input type for 'dataset': expected QubedOutput, got {actual_type}")

        selected_values = self._selected_values(block)
        if not contains(input_dataset, {self.option_id: selected_values}):
            return Either.error(
                f"{self.selection_label} {selected_values} are not in the input "
                f"{self.selection_label}: {axes(input_dataset).get(self.option_id, [])}"
            )

        output = coxpand(input_dataset, self.option_id, {self.option_id: selected_values})
        return Either.ok(output)

    def compile(
        self,
        inputs: ActionLookup,
        block_id: BlockInstanceId,
        block: BlockInstance,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        input_task = block.input_ids["dataset"]
        selected_values = self._selected_values(block)
        selected = inputs[input_task].select({self.option_id: selected_values if len(selected_values) > 1 else selected_values[0]})
        return Either.ok(selected)

    def _restriction_value_strings(self, axis_values: set[Any]) -> list[str]:
        if self.item_python_type is str:
            return sorted(value for value in axis_values if isinstance(value, str))
        if self.item_python_type is int:
            return [str(value) for value in sorted(value for value in axis_values if type(value) is int)]
        raise TypeError(f"Unsupported select value type {self.item_python_type!r}")

    def restrictions(self, other: QubedOutput) -> ConfigurationOptionRestriction:
        values = self._restriction_value_strings(axes(other).get(self.option_id, set()))
        return {self.option_id: ListType(ClosedEnumType(values))} if values else {}

    def intersect(self, other: QubedOutput) -> bool:
        return contains(other, self.option_id)


class GribSink(Sink):
    title: str = "GRIB Sink"
    description: str = "Write dataset to a GRIB file on the local filesystem"
    configuration_options: dict[ConfigurationOptionId, BlockConfigurationOption] = {
        PATH: BlockConfigurationOption(
            title="GRIB Path",
            description="Filesystem path where the GRIB file should be written",
            value_type="str",
        )
    }
    inputs: list[str] = ["dataset"]

    def _find_template_values(cls, path: str) -> list[str]:
        return re.findall(r"\{(.*?)\}", path)

    def validate(self, block: BlockInstance, inputs: dict[str, QubedOutput]) -> Either[BlockInstanceOutput, Error]:  # type:ignore[invalid-argument] # semigroup
        input_dataset = inputs.get("dataset")
        if not isinstance(input_dataset, QubedOutput):
            actual_type = type(input_dataset).__name__ if input_dataset is not None else "None"
            return Either.error(f"Unsupported input type for 'dataset': expected QubedOutput, got {actual_type}")
        path = block.config_as_str(PATH)
        dirname = os.path.dirname(path)
        if len(self._find_template_values(dirname)) != 0:
            return Either.error(f"Invalid filepath: directory path can not contain template values")
        path_templates = self._find_template_values(path)
        allowed_templates = dimensions(input_dataset).union(
            set([alias for alias, dim in GRIB_ALIASES.items() if contains(input_dataset, dim)])
        )
        if not all([dim in allowed_templates for dim in path_templates]):
            return Either.error(f"Invalid filename: template values in filename must be one of {allowed_templates}")
        return Either.ok(RawOutput(type_fqn="bytes", mime_type="text/plain"))

    def compile(
        self,
        inputs: ActionLookup,
        block_id: BlockInstanceId,
        block: BlockInstance,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        input_task = block.input_ids["dataset"]
        path_dims = self._find_template_values(block.config_as_str(PATH))
        keep_dims = []
        for dim in path_dims:
            mapped_dim = GRIB_ALIASES.get(dim, dim)
            if mapped_dim not in keep_dims:
                keep_dims.append(mapped_dim)
        action = inputs[input_task].flatten(new_dim="**temp**", keep_dims=keep_dims, reset_coords=True).concatenate(dim="**temp**")
        try:
            if PARAM_DIM in keep_dims:
                action = action.combine_branches(dim=PARAM_DIM)
            else:
                action = action.combine_branches(dim="**temp**").concatenate(dim="**temp**")
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
            value_type="list[str]",
        ),
        DOMAIN: BlockConfigurationOption(
            title="Domain",
            description="Geographic domain: global, europe, or a named region",
            value_type="str",
        ),
        FORMAT: BlockConfigurationOption(
            title="Format",
            description="Output image format",
            value_type="enumClosed['png', 'pdf', 'svg']",
        ),
        # Disabled for now
        # "groupby": BlockConfigurationOption(
        #     title="Group By",
        #     description="Dimension to create subplots over",
        #     value_type="enum['valid_datetime', 'step', 'number', 'none']",
        # ),
        # "style_schema": BlockConfigurationOption(
        #     title="Style Schema",
        #     description="earthkit-plots schema identifier",
        #     value_type="str",
        # ),
    }
    inputs: list[str] = ["dataset"]

    def validate(self, block: BlockInstance, inputs: dict[str, BlockInstanceOutput]) -> Either[BlockInstanceOutput, Error]:  # type:ignore[invalid-argument] # semigroup
        input_dataset = inputs.get("dataset")
        if not isinstance(input_dataset, QubedOutput):
            actual_type = type(input_dataset).__name__ if input_dataset is not None else "None"
            return Either.error(f"Unsupported input type for 'dataset': expected QubedOutput, got {actual_type}")

        params = block.config_as_list(PARAM, str, allow_empty=False)
        missing = [p for p in params if not contains(input_dataset, {PARAM: p})]
        if missing:
            return Either.error(f"params {missing} are not in the input parameters: {axes(input_dataset).get(PARAM, [])}")

        # Disabled for now
        # groupby_value = block.configuration_values["groupby"]
        # if groupby_value not in ("valid_datetime", "step", "number", "none"):
        #     return Either.error(
        #         f"Invalid groupby value: {groupby_value}, must be one of {set(['valid_datetime', 'step', 'number', 'none']).intersection(dimensions(input_dataset))}"
        #     )
        # if groupby_value != "none" and groupby_value not in dimensions(input_dataset):
        #     return Either.error(
        #         f"Invalid groupby value: {groupby_value}, must be one of {set(['valid_datetime', 'step', 'number', 'none']).intersection(dimensions(input_dataset))}"
        #     )

        fmt = block.config_as_str(FORMAT)
        mime_type = PLOT_FORMAT_TO_MIME.get(fmt)
        if mime_type is None:
            return Either.error(f"Unsupported output format: {fmt}")
        return Either.ok(RawOutput(type_fqn="bytes", mime_type=mime_type))

    def compile(
        self,
        inputs: ActionLookup,
        block_id: BlockInstanceId,
        block: BlockInstance,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        input_task = block.input_ids["dataset"]
        params = block.config_as_list(PARAM, str, allow_empty=False)
        selected = inputs[input_task].select({PARAM: params if len(params) > 1 else params[0]})

        # Disabled for now
        # groupby = block.configuration_values["groupby"] or "valid_datetime"

        # if groupby != "none":
        #     selected = selected.concatenate(groupby)

        action = selected.map(
            Payload(
                "fiab_plugin_ecmwf.runtime.plots.map_plot",
                kwargs={
                    "domain": block.config_as_str(DOMAIN) or None,
                    "format": block.config_as_str(FORMAT),
                    # "groupby": block.configuration_values["groupby"] or "valid_datetime",
                    # "style_schema": block.configuration_values["style_schema"] or "inbuilt://fiab",
                },
                metadata={"environment": ["earthkit-plots<1.0.0", "earthkit-regrid<1.0.0"]},
            )
        )
        return Either.ok(action)

    def restrictions(self, other: QubedOutput) -> ConfigurationOptionRestriction:
        values = [value for value in axes(other).get(PARAM, set()) if isinstance(value, str)]
        return {PARAM: ListType(ClosedEnumType(sorted(values)))} if values else {}

    def intersect(self, other: QubedOutput) -> bool:
        return contains(other, PARAM)
