# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import logging
from typing import get_args

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
from fiab_core.types import (
    BoundingBoxWSENType,
    GeoDomainSingleType,
    GeoDomainType,
    GridType,
    UnionType,
    UnrestrictedGeoDomainAlias,
    UnrestrictedGeoDomainLiteral,
)

from ..block_utils import (
    _extract_dataset,
)
from ..constants import (
    DOMAIN,
    GRID,
)
from ..qubed_utils import coxpand, expand

logger = logging.getLogger(__name__)

AreaType = UnionType([UnrestrictedGeoDomainAlias, BoundingBoxWSENType(), GeoDomainSingleType()])


class GeographicalTransform(Transform):
    title: str = "GeographicalTransform"
    description: str = "Transform the data to a different grid or area"
    configuration_options: dict[ConfigurationOptionId, BlockConfigurationOption] = {
        GRID: BlockConfigurationOption(
            title="Grid",
            description="Resolution to regrid to, e.g. '0.25/0.25' for 0.25 degree resolution, or a named grid (e.g. 'N320')",
            value_type=GridType(),
            default_value="auto",
        ),
        DOMAIN: BlockConfigurationOption(
            title="Domain",
            description="Area to cut out: auto (fit the data), global, a named region/country (select several to union), or a drawn bounding box",
            value_type=GeoDomainType(),
            default_value="auto",
        ),
    }
    inputs: list[str] = ["dataset"]

    def validate(
        self, block: BlockInstanceRich, inputs: dict[str, QubedOutput], restrictions: ConfigurationOptionRestriction
    ) -> BlockInstanceOutput:
        input_dataset = _extract_dataset(inputs, "dataset")

        output = input_dataset
        if grid := block.config_as_grid(GRID):
            output = expand(output, {GRID: [grid]})

        if domain := block.config_as_geodomain(DOMAIN):
            if isinstance(domain.value, list) and len(domain.value) > 0 and isinstance(next(iter(domain.value)), str):
                if len(domain.value) > 1:
                    raise ValueError("Only one string domain can be selected for cutout")
                domain = domain.value[0]
            else:
                domain = str(domain.with_bbox_mars().value)
            output = coxpand(input_dataset, DOMAIN, {DOMAIN: [domain]})
        return output

    def compile(
        self,
        inputs: ActionLookup,
        block: BlockInstanceRich,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        input_task = block.input_ids["dataset"]

        grid = block.config_as_grid(GRID)
        domain = block.config_as_geodomain(DOMAIN).with_bbox_mars().value

        if domain in get_args(UnrestrictedGeoDomainLiteral):
            domain = None

        if isinstance(domain, list) and len(domain) > 0 and isinstance(next(iter(domain)), str):
            domain = domain[0]

        action = inputs[input_task].map(
            Payload(
                "fiab_plugin_ecmwf.geography.runtime.regrid",
                kwargs={"grid": grid, "domain": domain, "fmt_if_list": "nwse"},
                metadata={"environment": ["mir-python", "earthkit-plots<1.0.0"]},
            )
        )
        return Either.ok(action)

    def intersect(self, other: QubedOutput) -> bool:
        return True  # TODO: implement a check
