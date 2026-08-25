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

from cascade.low.func import Either
from earthkit.workflows.fluent import Action, Payload
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
from fiab_core.tools.blocks import BlockInstanceRich, Sink
from fiab_core.types import StringType

from ..block_utils import _extract_dataset
from ..constants import (
    LEVEL,
    PARAM,
    PATH,
    STEP,
)
from ..qubed_utils import dimensions

logger = logging.getLogger(__name__)

GRIB_ALIASES = {
    "shortName": PARAM,
    "paramId": PARAM,
    "stepRange": STEP,
    "level": LEVEL,
}

GRIB_MIME = "text/plain; fiab-format=gribdir"

PLOT_FORMAT_TO_MIME: dict[str, str] = {
    "png": "image/png",
    "pdf": "application/pdf",
    "svg": "image/svg+xml",
}


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
