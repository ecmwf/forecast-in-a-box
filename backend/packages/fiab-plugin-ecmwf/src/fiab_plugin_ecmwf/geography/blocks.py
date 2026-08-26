# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import logging

from cascade.low.func import Either
from earthkit.workflows.fluent import Action, Payload
from fiab_core.fable import (
    ActionLookup,
    BlockConfigurationOption,
    BlockInstanceOutput,
    ConfigurationOptionId,
    ConfigurationOptionRestriction,
    QubedOutput,
)
from fiab_core.plugin import Error
from fiab_core.tools.blocks import BlockInstanceRich, Transform
from fiab_core.types import BoundingBoxWSENType, GeoDomainSingleType, GridType, UnionType

from ..block_utils import (
    _extract_dataset,
)
from ..constants import (
    DOMAIN,
    GRID,
)
from ..qubed_utils import axes, common_dimensions, contains, coxpand, expand

logger = logging.getLogger(__name__)

AreaType = UnionType([BoundingBoxWSENType(), GeoDomainSingleType()])


class Regrid(Transform):
    title: str = "Regrid"
    description: str = "Regrid the input to a different grid"
    configuration_options: dict[ConfigurationOptionId, BlockConfigurationOption] = {
        GRID: BlockConfigurationOption(
            title="Grid",
            description="Resolution to regrid to, e.g. '0.25/0.25' for 0.25 degree resolution, or a named grid (e.g. 'N320')",
            value_type=GridType(),
        ),
    }
    inputs: list[str] = ["dataset"]

    def validate(
        self, block: BlockInstanceRich, inputs: dict[str, QubedOutput], restrictions: ConfigurationOptionRestriction
    ) -> BlockInstanceOutput:
        input_dataset = _extract_dataset(inputs, "dataset")
        output = expand(input_dataset, {GRID: [block.config_as_grid(GRID)]})
        return output

    def compile(
        self,
        inputs: ActionLookup,
        block: BlockInstanceRich,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        input_task = block.input_ids["dataset"]
        grid = block.config_as_grid(DOMAIN)

        action = inputs[input_task].map(
            Payload(
                "fiab_plugin_ecmwf.regridding.runtime.regrid",
                kwargs={
                    "grid": grid,
                },
                metadata={"environment": ["mir-python"]},
            )
        )
        return Either.ok(action)

    def intersect(self, other: QubedOutput) -> bool:
        return True  # TODO: implement a check


class AreaCutout(Transform):
    title: str = "Area Cutout"
    description: str = "Cut out a geographic area from the input"
    configuration_options: dict[ConfigurationOptionId, BlockConfigurationOption] = {
        DOMAIN: BlockConfigurationOption(
            title="Domain",
            description="Area to cut out: auto (fit the data), global, a named region/country (select several to union), or a drawn bounding box",
            value_type=AreaType,
        ),
    }
    inputs: list[str] = ["dataset"]

    def validate(
        self, block: BlockInstanceRich, inputs: dict[str, QubedOutput], restrictions: ConfigurationOptionRestriction
    ) -> BlockInstanceOutput:
        input_dataset = _extract_dataset(inputs, "dataset")
        output = coxpand(input_dataset, DOMAIN, {DOMAIN: str(block.config_as_geodomain(DOMAIN).with_bbox_mars().value)})
        return output

    def compile(
        self,
        inputs: ActionLookup,
        block: BlockInstanceRich,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        input_task = block.input_ids["dataset"]
        domain = block.config_as_geodomain(DOMAIN).with_bbox_mars().value

        action = inputs[input_task].map(
            Payload(
                "fiab_plugin_ecmwf.regridding.runtime.area_cutout",
                kwargs={
                    "domain": domain,
                },
                metadata={"environment": ["mir-python", "earthkit-plots<1.0.0"]},
            )
        )
        return Either.ok(action)

    def intersect(self, other: QubedOutput) -> bool:
        return True  # TODO: implement a check
