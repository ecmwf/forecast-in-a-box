# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

from fiab_core.fable import (
    BlockFactoryId,
    BlockInstance,
    BlockInstanceId,
    BlueprintTemplate,
    BlueprintTemplateBlock,
    BlueprintTemplateExampleInput,
    ConfigurationOptionId,
)
from fiab_core.types import ClosedEnumType

from fiab_plugin_ecmwf.templates.common import (
    GRIB_OUTPUT_PATH,
    MAP_FORMAT,
    OUTPUT_ROOT,
    YESTERDAY_MIDNIGHT,
    map_area,
)

# Sinks read the source directly, so any lead time stays valid.
template = BlueprintTemplate(
    display_name="AIFS 72-Hour Forecast",
    display_description="A 72-hour AIFS forecast as map plots of 2 m temperature and mean sea-level pressure over the area you choose, plus the full field set as GRIB.",
    tags=["AIFS", "72 h", "Map plot + GRIB"],
    blocks={
        BlockInstanceId("source"): BlueprintTemplateBlock(
            factory_id=BlockFactoryId("anemoiSource"),
            instance=BlockInstance(
                configuration_values={
                    ConfigurationOptionId("checkpoint"): "ecmwf:aifs-global-o48",
                    ConfigurationOptionId("input_source"): "${initialConditions}",
                    ConfigurationOptionId("lead_time"): "72",
                    ConfigurationOptionId("base_time"): YESTERDAY_MIDNIGHT,
                    ConfigurationOptionId("number"): "1",
                },
                input_ids={},
            ),
        ),
        BlockInstanceId("mapPlot"): BlueprintTemplateBlock(
            factory_id=BlockFactoryId("mapPlotSink"),
            instance=BlockInstance(
                configuration_values={
                    ConfigurationOptionId("param"): "2t,msl",
                    ConfigurationOptionId("domain"): "${area}",
                    ConfigurationOptionId("format"): "${plotFormat}",
                    ConfigurationOptionId("groupby"): "none",
                    # Splitting by param is valid only because two are selected.
                    ConfigurationOptionId("splitby"): "step,param",
                },
                input_ids={
                    "dataset": BlockInstanceId("source"),
                },
            ),
        ),
        BlockInstanceId("gribSink"): BlueprintTemplateBlock(
            factory_id=BlockFactoryId("gribSink"),
            instance=BlockInstance(
                configuration_values={
                    ConfigurationOptionId("path"): GRIB_OUTPUT_PATH,
                },
                input_ids={
                    "dataset": BlockInstanceId("source"),
                },
            ),
        ),
    },
    environment=None,
    local_glyphs={},
    example_glyphs={
        "outputRoot": OUTPUT_ROOT,
        "initialConditions": BlueprintTemplateExampleInput(
            example_value="opendata",
            display_name="Initial Conditions",
            display_description="Source of the initial conditions",
            type_hint=ClosedEnumType(["mars", "opendata", "polytope"]),
        ),
        "area": map_area("europe"),
        "plotFormat": MAP_FORMAT,
    },
)
