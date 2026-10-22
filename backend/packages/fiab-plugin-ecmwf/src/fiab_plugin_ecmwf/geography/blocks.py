# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import logging
from decimal import Decimal
from typing import cast, get_args

from cascade.low.func import Either
from earthkit.workflows.fluent import Action, create_task_instance
from earthkit.workflows.metadata import NodeMetadata, Requirements
from fiab_core.fable import (
    ActionLookup,
    BlockConfigurationOption,
    BlockInstanceOutput,
    ConfigurationOptionId,
    ConfigurationOptionRestriction,
    QubedOutput,
)
from fiab_core.plugin import Error
from fiab_core.tools.blocks import BlockInstanceConfigurationError, BlockInstanceRich, Transform
from fiab_core.tools.convert import GeoDomainRuntimeType
from fiab_core.types import (
    BoundingBoxWSENType,
    GeoDomainSingleType,
    GeoDomainType,
    GridType,
    GridValue,
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
from ..qubed_utils import collapse, coxpand, dimensions, expand

logger = logging.getLogger(__name__)

AreaType = UnionType([UnrestrictedGeoDomainAlias, BoundingBoxWSENType(), GeoDomainSingleType()])

NO_CUTOUT_DOMAIN = "auto"
"""The domain axis value for an empty area, which regrids without cutting out."""


def _number_str(value: int | float) -> str:
    return format(Decimal(repr(float(value))).normalize(), "f")


def grid_axis_value(grid: GridValue) -> str:
    """Return the canonical string of a grid for the grid axis.

    A named grid is returned as given, a single resolution as its shortest decimal string without a trailing '.0' (for example
    '0.25' or '1'), and a pair as the two such strings joined by a slash in west-east, south-north order (for example '0.25/0.5').
    """
    if isinstance(grid, str):
        return grid
    if isinstance(grid, list):
        return "/".join(_number_str(resolution) for resolution in grid)
    return _number_str(grid)


def _single_named_domain(domain: list[str]) -> str:
    if len(domain) > 1:
        raise BlockInstanceConfigurationError("Only one string domain can be selected for cutout")
    return domain[0]


def domain_axis_value(domain: GeoDomainRuntimeType) -> str:
    """Return the domain axis value for a domain already ordered as a MARS bounding box.

    The unrestricted values ('auto', 'global', 'datadefined') are returned as given and an empty area is 'auto'. A single named
    region is returned by name and a bounding box as the string of its north, west, south, east list.
    """
    if isinstance(domain, str):
        return domain
    if len(domain) == 0:
        return NO_CUTOUT_DOMAIN
    if isinstance(domain[0], str):
        return _single_named_domain(cast(list[str], domain))
    return str(domain)


def domain_runtime_value(domain: GeoDomainRuntimeType) -> str | list[float] | None:
    """Return the domain passed to the regrid task for a domain already ordered as a MARS bounding box.

    The unrestricted values and an empty area give None, which regrids without cutting out. A single named region is returned
    by name and a bounding box as its north, west, south, east list.
    """
    if isinstance(domain, str):
        return None if domain in get_args(UnrestrictedGeoDomainLiteral) else domain
    if len(domain) == 0:
        return None
    if isinstance(domain[0], str):
        return _single_named_domain(cast(list[str], domain))
    return cast(list[float], domain)


class GeographicalTransform(Transform):
    title: str = "GeographicalTransform"
    description: str = "Transform the data to a different grid or area"
    configuration_options: dict[ConfigurationOptionId, BlockConfigurationOption] = {
        GRID: BlockConfigurationOption(
            title="Grid",
            description=(
                "Grid to regrid to: a resolution in degrees such as '0.25', a west-east/south-north pair such as '0.25/0.5', "
                "or a named Gaussian grid such as 'N320' or 'O96'"
            ),
            value_type=GridType(),
            default_value="auto",
        ),
        DOMAIN: BlockConfigurationOption(
            title="Domain",
            description="Area to cut out: auto (fit the data), global, a single named region/country, or a drawn bounding box; leave empty to regrid without cutting out",
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
        grid = block.config_as_grid(GRID)
        if grid is not None:
            if GRID in dimensions(output):
                output = collapse(output, GRID)
            output = expand(output, {GRID: [grid_axis_value(grid)]})

        domain = block.config_as_geodomain(DOMAIN).with_bbox_mars().value
        return coxpand(output, DOMAIN, {DOMAIN: [domain_axis_value(domain)]})

    def compile(
        self,
        inputs: ActionLookup,
        block: BlockInstanceRich,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        input_task = block.input_ids["dataset"]

        grid = block.config_as_grid(GRID)
        domain = domain_runtime_value(block.config_as_geodomain(DOMAIN).with_bbox_mars().value)

        action = inputs[input_task].map(
            create_task_instance(
                "fiab_plugin_ecmwf.geography.runtime.regrid",
                static_input_kw={"grid": grid, "domain": domain, "fmt_if_list": "nwse"},
            ),
            node_metadata=NodeMetadata(requirements=Requirements(environment=["mir-python", "earthkit-plots<1.0.0"])),
        )
        return Either.ok(action)

    def intersect(self, other: QubedOutput) -> bool:
        return True  # TODO: implement a check
