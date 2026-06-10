# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

from cascade.low.func import Either
from earthkit.workflows.fluent import Action
from fiab_core.fable import (
    ActionLookup,
    BlockConfigurationOption,
    BlockInstance,
    BlockInstanceId,
    BlockInstanceOutput,
    ConfigurationOptionId,
    NoOutput,
    QubedOutput,
)
from fiab_core.plugin import BlockValidation, Error
from fiab_core.tools.blocks import Product, Sink, Transform

DIR = ConfigurationOptionId("dir")
PARAM = ConfigurationOptionId("param")


class _DemoTransform(Transform):
    configuration_options: dict[ConfigurationOptionId, BlockConfigurationOption] = {}
    inputs: list[str] = ["dataset"]

    def validate(self, block: BlockInstance, inputs: dict[str, QubedOutput]) -> BlockValidation:
        dataset = inputs.get("dataset")
        if dataset is None:
            return BlockValidation(Either.error("Missing input 'dataset'"))
        return BlockValidation(Either.ok(dataset))

    def compile(
        self,
        inputs: ActionLookup,
        block_id: BlockInstanceId,
        block: BlockInstance,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        return Either.ok(inputs[block.input_ids["dataset"]])

    def intersect(self, other: QubedOutput) -> bool:
        return True


class _DemoProduct(Product):
    configuration_options: dict[ConfigurationOptionId, BlockConfigurationOption] = {}
    inputs: list[str] = ["dataset"]

    def validate(self, block: BlockInstance, inputs: dict[str, QubedOutput]) -> BlockValidation:
        dataset = inputs.get("dataset")
        if dataset is None:
            return BlockValidation(Either.error("Missing input 'dataset'"))
        return BlockValidation(Either.ok(dataset))

    def compile(
        self,
        inputs: ActionLookup,
        block_id: BlockInstanceId,
        block: BlockInstance,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        return Either.ok(inputs[block.input_ids["dataset"]])

    def intersect(self, other: QubedOutput) -> bool:
        return True


class _DemoSink(Sink):
    configuration_options: dict[ConfigurationOptionId, BlockConfigurationOption] = {}
    inputs: list[str] = ["dataset"]

    def validate(self, block: BlockInstance, inputs: dict[str, QubedOutput]) -> BlockValidation:
        if "dataset" not in inputs:
            return BlockValidation(Either.error("Missing input 'dataset'"))
        return BlockValidation(Either.ok(NoOutput()))

    def compile(
        self,
        inputs: ActionLookup,
        block_id: BlockInstanceId,
        block: BlockInstance,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        return Either.ok(inputs[block.input_ids["dataset"]])

    def intersect(self, other: QubedOutput) -> bool:
        return True


class NetCDFOutputSink(_DemoSink):
    title: str = "NetCDF Output"
    description: str = "Placeholder sink for writing dataset output as NetCDF."
    configuration_options: dict[ConfigurationOptionId, BlockConfigurationOption] = {
        DIR: BlockConfigurationOption(
            title="Directory",
            description="Output directory (e.g. '/path/to/output')",
            value_type="str",
        )
    }


class GRIBOutputSink(_DemoSink):
    title: str = "GRIB Output"
    description: str = "Placeholder sink for writing dataset output as GRIB."
    configuration_options: dict[ConfigurationOptionId, BlockConfigurationOption] = {
        DIR: BlockConfigurationOption(
            title="Directory",
            description="Output directory (e.g. '/path/to/output')",
            value_type="str",
        )
    }


class FilterParam(_DemoTransform):
    title: str = "Filter Parameters"
    description: str = "Placeholder transform for selecting specific parameters."
    configuration_options: dict[ConfigurationOptionId, BlockConfigurationOption] = {
        PARAM: BlockConfigurationOption(
            title="Parameters",
            description="Parameters to select and plot (e.g. '2t', 'msl')",
            value_type="list[str]",
        )
    }


class InterpolationTransform(_DemoTransform):
    title: str = "Interpolation"
    description: str = "Placeholder transform for interpolating datasets."
    configuration_options: dict[ConfigurationOptionId, BlockConfigurationOption] = {
        PARAM: BlockConfigurationOption(
            title="Grid",
            description="GridSpec to interpolate",
            value_type="str",
        )
    }


class WeeklyMeanTransform(_DemoTransform):
    title: str = "Weekly Mean"
    description: str = "Placeholder transform for computing weekly means."


class MonthlyMeanTransform(_DemoTransform):
    title: str = "Monthly Mean"
    description: str = "Placeholder transform for computing monthly means."


class EnsembleProbabilityTransform(_DemoTransform):
    title: str = "Ensemble Probability"
    description: str = "Placeholder transform for computing ensemble probabilities."


class ExtremeIndexProduct(_DemoProduct):
    title: str = "Extreme Index"
    description: str = "Placeholder product for computing extreme indices."


class TropicalCycloneProduct(_DemoProduct):
    title: str = "Tropical Cyclone"
    description: str = "Placeholder product for tropical cyclone products."
