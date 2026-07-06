# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

from importlib.resources import path

from cascade.low.func import Either
from earthkit.workflows.fluent import Action, merge
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
from fiab_core.types import ClosedEnumType, ListType
from ppcore.products import action_from_outputs
from ppcore.schema.schema import Schema
from qubed import Qube

from fiab_plugin_ecmwf.qubed_utils import axes, contains, coxpand, datacubes, select
from fiab_plugin_ecmwf.block_utils import (
    STATISTIC,
    ENSEMBLE,
    PARAM,
    STEP,
    TYPE,
    THRESHOLD,
    COMPARISON,
    _axis_value_strings,
    _create_param_key,
    _split_param_key,
    _extract_dataset
)


def load_pproc_schema() -> str:
    with path("fiab_plugin_ecmwf.products.pproc", "schema.yaml") as pproc_schema:
        return str(pproc_schema)
    

PPROC_SCHEMA = load_pproc_schema()
    

class EnsembleStatistics(Product):
    title: str = "Ensemble Mean and Standard Deviation"
    description: str = "Computes ensemble mean or standard deviation"
    configuration_options: dict[ConfigurationOptionId, BlockConfigurationOption] = {
        STATISTIC: BlockConfigurationOption(
            title="Statistic",
            description="Statistic to compute over the ensemble",
            value_type="list[enumClosed['mean', 'std']]",
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
        actions = {}

        for npath, narray in nodetree_arrays(input_task_action.nodes):
            coords = {dim: values.data.tolist() for dim, values in narray.sel({ENSEMBLE: 1}).coords.items()}
            coords.pop(ENSEMBLE)
            step_values = coords[STEP]
            actions[npath] = action_from_outputs(
                requests=[
                    {
                        **coords,
                        PARAM: coords[PARAM],
                        TYPE: [self.stat_type(stat, step_values[0]) for stat in stats],
                    }
                ],
                pproc_schema=PPROC_SCHEMA,
                sources=input_task_action.sel(path=npath).as_action(PProcAction),
            )
        return Either.ok(merge(**actions))

    def intersect(self, other: QubedOutput) -> bool:
        if not contains(other, STEP):
            return False
        coords = axes(other)
        steps = coords[STEP]
        step_lengths = [str(x).split("-") for x in steps]
        if not all([len(x) == len(step_lengths[0]) for x in step_lengths]):
            return False
        return contains(other, ENSEMBLE) and len(coords[ENSEMBLE]) > 1 and contains(other, PARAM)


class PrescribedThresholdProbability(Product):
    title: str = "Prescribed Threshold Probability"
    description: str = "Computes probability of ensemble members being above/below a prescribed threshold"
    configuration_options: dict[ConfigurationOptionId, BlockConfigurationOption] = {
        PARAM: BlockConfigurationOption(
            title="Parameter",
            description="Parameter to compute",
            value_type="str",
        ),
        STEP: BlockConfigurationOption(
            title="Parameter",
            description="Parameter to compute",
            value_type="list[str]",
        ),
    }
    inputs: list[str] = ["dataset"]
    stat_type: str = "ep"

    def validate(
        self, block: BlockInstanceRich, inputs: dict[str, QubedOutput], restrictions: ConfigurationOptionRestriction
    ) -> BlockInstanceOutput:
        input_dataset = _extract_dataset(inputs, "dataset")
        prob_qube = Qube.empty()
        schema = Schema.from_file(PPROC_SCHEMA)
        for output, _ in schema.outputs_from_inputs(
            inputs=list(datacubes(input_dataset)), output_template={TYPE: self.stat_type, "selection": "default"}
        ):
            prob_qube = prob_qube | Qube.from_datacube(output)
        restrictions[PARAM] = ClosedEnumType([_create_param_key(paramid) for paramid in axes(prob_qube)[PARAM]])

        selected_param_id, _ = _split_param_key(block.config_as_str(PARAM))
        param_qube = prob_qube.select({PARAM: selected_param_id})
        restrictions[STEP] = ListType(ClosedEnumType(_axis_value_strings(axes(param_qube)[STEP])))

        steps = block.config_as_list(STEP, str, allow_empty=False)
        output = coxpand(input_dataset, [ENSEMBLE, TYPE, PARAM], {TYPE: [self.stat_type], PARAM: [selected_param_id], STEP: steps})
        return output

    def compile(
        self,
        inputs: ActionLookup,
        block: BlockInstanceRich,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        input_task = block.input_ids["dataset"]
        input_task_action = inputs[input_task]
        selected_param_id, _ = _split_param_key(block.config_as_str(PARAM))
        steps = block.config_as_list(STEP, str, allow_empty=False)
        action = action_from_outputs(
            [{PARAM: [selected_param_id], TYPE: self.stat_type, STEP: steps, "selection": "default"}],
            PPROC_SCHEMA,
            input_task_action.as_action(PProcAction),
        )
        return Either.ok(action)

    def intersect(self, other: QubedOutput) -> bool:
        if not contains(other, ENSEMBLE) or len(axes(other)[ENSEMBLE]) <= 1:
            return False
        schema = Schema.from_file(PPROC_SCHEMA)
        outputs = list(
            schema.outputs_from_inputs(inputs=list(datacubes(other)), output_template={TYPE: self.stat_type, "selection": "default"})
            )
        return len(outputs) > 0


class CustomThresholdProbability(Product):
    title: str = "Custom Threshold Probability"
    description: str = "Computes probability of ensemble members being above/below the configured threshold"
    configuration_options: dict[ConfigurationOptionId, BlockConfigurationOption] = {
        THRESHOLD: BlockConfigurationOption(
            title="Threshold",
            description="Threshold value to compute probability for",
            value_type="float",
        ), 
        COMPARISON: BlockConfigurationOption(
            title="Comparison",
            description="Comparison operator for threshold",
            value_type="enumClosed['>=', '<=', '>', '<']",
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
        actions = {}

        for npath, narray in nodetree_arrays(input_task_action.nodes):
            coords = {dim: values.data.tolist() for dim, values in narray.sel({ENSEMBLE: 1}).coords.items()}
            coords.pop(ENSEMBLE)
            actions[npath] = action_from_outputs(
                requests=[
                    {
                        **coords,
                        TYPE: self.stat_type,
                        THRESHOLD: block.config_as_float(THRESHOLD),
                        COMPARISON: block.config_as_str(COMPARISON),
                        "selection": "custom",
                    }
                ],
                pproc_schema=PPROC_SCHEMA,
                sources=input_task_action.sel(path=npath).as_action(PProcAction),
            )
        return Either.ok(merge(**actions))

    def intersect(self, other: QubedOutput) -> bool:
        return contains(other, ENSEMBLE) and len(axes(other)[ENSEMBLE]) > 1 and contains(other, PARAM)