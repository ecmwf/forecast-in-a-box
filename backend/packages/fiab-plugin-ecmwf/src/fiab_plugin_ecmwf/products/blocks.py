# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import logging
from importlib.resources import path

import numpy as np
from cascade.low.func import Either
from earthkit.workflows.fluent import Action, merge
from earthkit.workflows.nodetree import datacubes as nodetree_datacubes
from earthkit.workflows.nodetree import nodetree_arrays
from earthkit.workflows.plugins.pproc.fluent import Action as PProcAction
from fiab_core.fable import (
    ActionLookup,
    BlockConfigurationOption,
    BlockInstanceOutput,
    ConfigurationOptionId,
    ConfigurationOptionRestriction,
    QubedOutput,
)
from fiab_core.plugin import Error
from fiab_core.tools.blocks import BlockInstanceRich, Product
from fiab_core.types import ClosedEnumType, ListType, ParameterType, StringType
from ppcore.products import action_from_outputs
from ppcore.schema.exceptions import PProcDatasetError
from ppcore.schema.forecast import ForecastDefinition
from ppcore.schema.schema import Schema
from qubed import Qube

from fiab_plugin_ecmwf.block_utils import (
    COMPARISON,
    ENSEMBLE,
    PARAM,
    STATISTIC,
    STEP,
    THRESHOLD,
    TYPE,
    _axis_value_strings,
    _extract_dataset,
    _param_id_to_param_key,
    _param_key_to_param_id,
)
from fiab_plugin_ecmwf.qubed_utils import axes, collapse, contains, coxpand, datacubes, select

logger = logging.getLogger(__name__)


def load_pproc_schema(cache_size: int) -> Schema:
    with path("fiab_plugin_ecmwf.products.pproc", "schema.yaml") as pproc_schema:
        return Schema.from_file(str(pproc_schema), matching_cache_size=cache_size)


PPROC_RECONSTRUCT_CACHE_SIZE = 50
PPROC_SCHEMA = load_pproc_schema(PPROC_RECONSTRUCT_CACHE_SIZE)


class EnsembleStatistics(Product):
    title: str = "Ensemble Mean and Standard Deviation"
    description: str = "Computes ensemble mean or standard deviation"
    configuration_options: dict[ConfigurationOptionId, BlockConfigurationOption] = {
        STATISTIC: BlockConfigurationOption(
            title="Statistic",
            description="Statistic to compute over the ensemble",
            value_type=ListType(ClosedEnumType(["mean", "std"])),
        ),
    }
    inputs: list[str] = ["dataset"]

    @classmethod
    def stat_type(cls, stat: str, step: int | str) -> str:
        steps = str(step).split("-")
        prefix = "" if len(steps) == 1 else "ta"
        if stat == "mean":
            tp = "em"
        else:
            tp = "es"
        return f"{prefix}{tp}"

    def validate(
        self, block: BlockInstanceRich, inputs: dict[str, QubedOutput], restrictions: ConfigurationOptionRestriction
    ) -> BlockInstanceOutput:
        input_dataset = _extract_dataset(inputs, "dataset")
        coords = axes(input_dataset)
        steps = _axis_value_strings(coords[STEP])
        stats = block.config_as_list(STATISTIC, str, allow_empty=False)
        output = coxpand(select(input_dataset, {ENSEMBLE: 1}), [ENSEMBLE, TYPE], {TYPE: [self.stat_type(stat, steps[0]) for stat in stats]})
        return output

    def compile(
        self,
        inputs: ActionLookup,
        block: BlockInstanceRich,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        input_task = block.input_ids["dataset"]
        input_task_action = inputs[input_task]
        stats = block.config_as_list(STATISTIC, str, allow_empty=False)

        requests = []
        for _, narray in nodetree_arrays(input_task_action.nodes):
            coords = {dim: values.data.tolist() for dim, values in narray.sel({ENSEMBLE: 1}).coords.items()}
            coords.pop(ENSEMBLE)
            step_values = coords[STEP]
            requests.append(
                {
                    **coords,
                    PARAM: coords[PARAM],
                    TYPE: [self.stat_type(stat, step_values[0]) for stat in stats],
                }
            )

        action = action_from_outputs(
            requests=requests,
            pproc_schema=PPROC_SCHEMA,
            forecast=input_task_action.as_action(PProcAction),
        )
        return Either.ok(action)

    def intersect(self, other: QubedOutput) -> bool:
        if not contains(other, STEP):
            return False
        coords = axes(other)
        steps = coords[STEP]
        step_lengths = [str(x).split("-") for x in steps]
        if not all([len(x) == len(step_lengths[0]) for x in step_lengths]):
            return False
        return contains(other, ENSEMBLE) and len(coords[ENSEMBLE]) > 1 and contains(other, PARAM)


class PredefinedThresholdProbability(Product):
    title: str = "Predefined Threshold Probability"
    description: str = "Computes probability of ensemble members being above/below a predefined threshold"
    configuration_options: dict[ConfigurationOptionId, BlockConfigurationOption] = {
        PARAM: BlockConfigurationOption(
            title="Parameter",
            description="Parameter to compute",
            value_type=ParameterType(),
        ),
        STEP: BlockConfigurationOption(
            title="Steps",
            description="Steps to compute",
            value_type=ListType(StringType()),
        ),
    }
    inputs: list[str] = ["dataset"]
    stat_type: str = "ep"

    def validate(
        self, block: BlockInstanceRich, inputs: dict[str, QubedOutput], restrictions: ConfigurationOptionRestriction
    ) -> BlockInstanceOutput:
        input_dataset = _extract_dataset(inputs, "dataset")
        prob_qube = Qube.empty()
        cubes = list(datacubes(input_dataset))
        sample_axes = axes(collapse(select(input_dataset, {ENSEMBLE: 1}), ENSEMBLE))
        unperturbed = axes(select(input_dataset, {ENSEMBLE: 0}))
        coords = {dim: list(values) for dim, values in sample_axes.items() if (len(values) == 1 and dim not in [ENSEMBLE, PARAM])}
        for output, _ in PPROC_SCHEMA.outputs_from_inputs(
            forecast=ForecastDefinition(
                datacubes=cubes, unperturbed={dim: unperturbed[dim] for dim in ["stream", "type", "number"] if dim in unperturbed}
            ),
            output_template={**coords, TYPE: self.stat_type, "selection": "default"},
        ):
            prob_qube = prob_qube | Qube.from_datacube(output)
        restrictions[PARAM] = ClosedEnumType([_param_id_to_param_key(paramid) for paramid in axes(prob_qube)[PARAM]])

        selected_param_id = _param_key_to_param_id(block.config_as_str(PARAM))
        param_qube = prob_qube.select({PARAM: selected_param_id})
        restrictions[STEP] = ListType(ClosedEnumType(_axis_value_strings(axes(param_qube)[STEP])))

        steps = block.config_as_list(STEP, str, allow_empty=False)
        return QubedOutput(dataqube=param_qube.select({STEP: steps}))

    def compile(
        self,
        inputs: ActionLookup,
        block: BlockInstanceRich,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        input_task = block.input_ids["dataset"]
        input_task_action = inputs[input_task]
        selected_param_id = _param_key_to_param_id(block.config_as_str(PARAM))
        steps = block.config_as_list(STEP, str, allow_empty=False)

        actions = []
        for npath, narray in nodetree_arrays(input_task_action.nodes):
            coords = {dim: values.data.tolist() for dim, values in narray.sel({ENSEMBLE: 1}).coords.items()}
            coords.pop(ENSEMBLE)
            try:
                actions.append(
                    action_from_outputs(
                        requests=[
                            {
                                **coords,
                                PARAM: [selected_param_id],
                                TYPE: self.stat_type,
                                STEP: steps,
                                "selection": "default",
                            }
                        ],
                        pproc_schema=PPROC_SCHEMA,
                        forecast=input_task_action.sel(path=npath).as_action(PProcAction),
                    )
                )
            except PProcDatasetError as e:
                logger.debug(e)
                pass
        assert len(actions) > 0, (
            f"No valid actions could be constructed for the given parameter from {input_task_action.nodes} for param {selected_param_id} and steps {steps}"
        )
        return Either.ok(merge(*actions))

    def intersect(self, other: QubedOutput) -> bool:
        if not contains(other, ENSEMBLE) or len(axes(other)[ENSEMBLE]) <= 1:
            return False
        cubes = list(datacubes(other))
        sample_axes = axes(collapse(select(other, {ENSEMBLE: 1}), ENSEMBLE))
        unperturbed = axes(select(other, {ENSEMBLE: 0}))
        coords = {dim: list(values) for dim, values in sample_axes.items() if (len(values) == 1 and dim not in [ENSEMBLE, PARAM])}
        try:
            for _ in PPROC_SCHEMA.outputs_from_inputs(
                forecast=ForecastDefinition(
                    datacubes=cubes, unperturbed={dim: unperturbed[dim] for dim in ["stream", "type", "number"] if dim in unperturbed}
                ),
                output_template={**coords, TYPE: self.stat_type, "selection": "default"},
                method="dfs",
            ):
                return True
        except Exception as e:
            logger.debug(e)
        return False


class CustomThresholdProbability(Product):
    title: str = "Custom Threshold Probability"
    description: str = "Computes probability of ensemble members being above/below the configured threshold"
    configuration_options: dict[ConfigurationOptionId, BlockConfigurationOption] = {
        COMPARISON: BlockConfigurationOption(
            title="Comparison",
            description="Comparison operator for threshold",
            value_type="enumClosed['>=', '<=', '>', '<']",
        ),
        THRESHOLD: BlockConfigurationOption(
            title="Threshold",
            description="Threshold value to compute probability for",
            value_type="float",
        ),
    }
    inputs: list[str] = ["dataset"]
    stat_type: str = "ep"

    def validate(
        self, block: BlockInstanceRich, inputs: dict[str, QubedOutput], restrictions: ConfigurationOptionRestriction
    ) -> BlockInstanceOutput:
        input_dataset = _extract_dataset(inputs, "dataset")
        output = coxpand(input_dataset, [ENSEMBLE, TYPE], {TYPE: [self.stat_type]})
        return output

    def compile(
        self,
        inputs: ActionLookup,
        block: BlockInstanceRich,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        input_task = block.input_ids["dataset"]
        input_task_action = inputs[input_task]

        requests = []
        for _, narray in nodetree_arrays(input_task_action.nodes):
            coords = {dim: values.data.tolist() for dim, values in narray.sel({ENSEMBLE: 1}).coords.items()}
            coords.pop(ENSEMBLE)
            requests.append(
                {
                    **coords,
                    TYPE: self.stat_type,
                    THRESHOLD: block.config_as_float(THRESHOLD),
                    COMPARISON: block.config_as_str(COMPARISON),
                    "selection": "custom",
                }
            )

        action = action_from_outputs(
            requests=requests,
            pproc_schema=PPROC_SCHEMA,
            forecast=input_task_action.as_action(PProcAction),
        )
        return Either.ok(action)

    def intersect(self, other: QubedOutput) -> bool:
        return contains(other, ENSEMBLE) and len(axes(other)[ENSEMBLE]) > 1 and contains(other, PARAM)


class ThermalIndices(Product):
    title: str = "Thermal Indices"
    description: str = "Computes thermal indices"
    configuration_options: dict[ConfigurationOptionId, BlockConfigurationOption] = {
        PARAM: BlockConfigurationOption(
            title="Parameters",
            description="Parameters to compute",
            value_type="list[str]",
        ),
        STEP: BlockConfigurationOption(
            title="Steps",
            description="Steps to compute",
            value_type="list[str]",
        ),
    }
    inputs: list[str] = ["dataset"]
    thermo_params: list[str] = [
        "261001",
        "261014",
        "261015",
        "260004",
        "260242",
        "261016",
        "260005",
        "260255",
        "261018",
        "261002",
        "261023",
    ]
    stat_type: list[str] = ["cf", "pf", "fc"]

    def validate(
        self, block: BlockInstanceRich, inputs: dict[str, QubedOutput], restrictions: ConfigurationOptionRestriction
    ) -> BlockInstanceOutput:
        input_dataset = _extract_dataset(inputs, "dataset")
        surface_cubes = select(input_dataset, {"levtype": "sfc"})
        coords = {dim: list(values) for dim, values in axes(surface_cubes).items() if len(values) == 1}
        thermo_qube = Qube.empty()
        for output, _ in PPROC_SCHEMA.outputs_from_inputs(
            forecast=ForecastDefinition(datacubes=list(datacubes(surface_cubes))),
            output_template={**coords, PARAM: self.thermo_params, TYPE: list(axes(surface_cubes)[TYPE])},
        ):
            thermo_qube = thermo_qube | Qube.from_datacube(output)

        restrictions[PARAM] = ListType(ClosedEnumType([_param_id_to_param_key(paramid) for paramid in axes(thermo_qube)[PARAM]]))
        selected_param_ids = [_param_key_to_param_id(x) for x in block.config_as_list(PARAM, str, allow_empty=False)]
        param_qube = thermo_qube.select({PARAM: selected_param_ids})

        allowed_steps = set.intersection(*[set(x[STEP]) for x in datacubes(param_qube)])
        restrictions[STEP] = ListType(ClosedEnumType(_axis_value_strings(allowed_steps)))
        steps = block.config_as_list(STEP, str, allow_empty=False)

        # Select from input qube to ensure other keys, like ENSEMBLE = 0, are properly preserved in
        # output that might be missing in the output mars keys emitted by PProc
        output_qube = Qube.empty()
        for datacube in param_qube.select({STEP: steps}).datacubes():
            datacube.pop(PARAM, None)
            output_qube = output_qube | select(input_dataset, datacube).dataqube
        return coxpand(QubedOutput(dataqube=output_qube), [PARAM], {PARAM: selected_param_ids})

    def compile(
        self,
        inputs: ActionLookup,
        block: BlockInstanceRich,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        input_task = block.input_ids["dataset"]
        input_task_action = inputs[input_task].select({"levtype": "sfc"})
        selected_param_ids = [_param_key_to_param_id(x) for x in block.config_as_list(PARAM, str, allow_empty=False)]
        steps = block.config_as_list(STEP, str, allow_empty=False)
        surface_cubes = nodetree_datacubes(input_task_action.nodes)
        coords = {
            dim: surface_cubes[0][dim]
            for dim in surface_cubes[0].keys()
            if all(surface_cubes[0][dim] == cube.get(dim, None) for cube in surface_cubes)
        }

        outputs = [
            output
            for output, _ in PPROC_SCHEMA.outputs_from_inputs(
                forecast=ForecastDefinition(datacubes=nodetree_datacubes(input_task_action.nodes)),
                output_template={**coords, PARAM: selected_param_ids, STEP: steps, TYPE: [cube[TYPE] for cube in surface_cubes]},
            )
        ]
        action = action_from_outputs(
            requests=outputs,
            pproc_schema=PPROC_SCHEMA,
            forecast=input_task_action.as_action(PProcAction),
        )
        return Either.ok(action)

    def intersect(self, other: QubedOutput) -> bool:
        surface_cubes = select(other, {"levtype": "sfc"})
        # Thermal indices can only be computed from forecast outputs
        fc_types = set.intersection(axes(surface_cubes).get(TYPE, set()), self.stat_type)
        if len(fc_types) == 0:
            return False

        coords = {dim: list(values) for dim, values in axes(surface_cubes).items() if len(values) == 1}
        try:
            for _ in PPROC_SCHEMA.outputs_from_inputs(
                forecast=ForecastDefinition(datacubes=list(datacubes(surface_cubes))),
                output_template={**coords, PARAM: self.thermo_params, TYPE: list(fc_types)},
                method="dfs",
            ):
                return True
        except Exception as e:
            logger.debug(e)
            pass
        return False
