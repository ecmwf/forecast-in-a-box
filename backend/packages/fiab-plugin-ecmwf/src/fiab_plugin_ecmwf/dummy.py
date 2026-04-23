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
    NoOutput,
    QubedOutput,
)
from fiab_core.plugin import Error
from fiab_core.tools.blocks import Product, Sink, Transform


class _DummyTransform(Transform):
    configuration_options: dict[str, BlockConfigurationOption] = {}
    inputs: list[str] = ["dataset"]

    def validate(self, block: BlockInstance, inputs: dict[str, QubedOutput]) -> Either[BlockInstanceOutput, Error]:  # type:ignore[invalid-argument] # semigroup
        dataset = inputs.get("dataset")
        if dataset is None:
            return Either.error("Missing input 'dataset'")
        return Either.ok(dataset)

    def compile(
        self,
        inputs: ActionLookup,
        block_id: BlockInstanceId,
        block: BlockInstance,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        return Either.ok(inputs[block.input_ids["dataset"]])

    def intersect(self, other: QubedOutput) -> bool:
        return True


class _DummyProduct(Product):
    configuration_options: dict[str, BlockConfigurationOption] = {}
    inputs: list[str] = ["dataset"]

    def validate(self, block: BlockInstance, inputs: dict[str, QubedOutput]) -> Either[BlockInstanceOutput, Error]:  # type:ignore[invalid-argument] # semigroup
        dataset = inputs.get("dataset")
        if dataset is None:
            return Either.error("Missing input 'dataset'")
        return Either.ok(dataset)

    def compile(
        self,
        inputs: ActionLookup,
        block_id: BlockInstanceId,
        block: BlockInstance,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        return Either.ok(inputs[block.input_ids["dataset"]])

    def intersect(self, other: QubedOutput) -> bool:
        return True


class _DummySink(Sink):
    configuration_options: dict[str, BlockConfigurationOption] = {}
    inputs: list[str] = ["dataset"]

    def validate(self, block: BlockInstance, inputs: dict[str, QubedOutput]) -> Either[BlockInstanceOutput, Error]:  # type:ignore[invalid-argument] # semigroup
        if "dataset" not in inputs:
            return Either.error("Missing input 'dataset'")
        return Either.ok(NoOutput())

    def compile(
        self,
        inputs: ActionLookup,
        block_id: BlockInstanceId,
        block: BlockInstance,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        return Either.ok(inputs[block.input_ids["dataset"]])

    def intersect(self, other: QubedOutput) -> bool:
        return True


class NetCDFOutputSink(_DummySink):
    title: str = "NetCDF Output"
    description: str = "Placeholder sink for writing dataset output as NetCDF."
    configuration_options: dict[str, BlockConfigurationOption] = {
        "dir": BlockConfigurationOption(
            title="Directory",
            description="Output directory (e.g. '/path/to/output')",
            value_type="str",
        )
    }


class GRIBOutputSink(_DummySink):
    title: str = "GRIB Output"
    description: str = "Placeholder sink for writing dataset output as GRIB."
    configuration_options: dict[str, BlockConfigurationOption] = {
        "dir": BlockConfigurationOption(
            title="Directory",
            description="Output directory (e.g. '/path/to/output')",
            value_type="str",
        )
    }


class FilterParam(_DummyTransform):
    title: str = "Filter Parameters"
    description: str = "Placeholder transform for selecting specific parameters."
    configuration_options: dict[str, BlockConfigurationOption] = {
        "param": BlockConfigurationOption(
            title="Parameters",
            description="Parameters to select and plot (e.g. '2t', 'msl')",
            value_type="list[str]",
        )
    }


class InterpolationTransform(_DummyTransform):
    title: str = "Interpolation"
    description: str = "Placeholder transform for interpolating datasets."
    configuration_options: dict[str, BlockConfigurationOption] = {
        "param": BlockConfigurationOption(
            title="Grid",
            description="GridSpec to interpolate",
            value_type="str",
        )
    }


class WeeklyMeanTransform(_DummyTransform):
    title: str = "Weekly Mean"
    description: str = "Placeholder transform for computing weekly means."


class MonthlyMeanTransform(_DummyTransform):
    title: str = "Monthly Mean"
    description: str = "Placeholder transform for computing monthly means."


class EnsembleProbabilityTransform(_DummyTransform):
    title: str = "Ensemble Probability"
    description: str = "Placeholder transform for computing ensemble probabilities."


class ExtremeIndexProduct(_DummyProduct):
    title: str = "Extreme Index"
    description: str = "Placeholder product for computing extreme indices."


class TropicalCycloneProduct(_DummyProduct):
    title: str = "Tropical Cyclone"
    description: str = "Placeholder product for tropical cyclone products."
