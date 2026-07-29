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
    ConfigurationOptionId,
)

from fiab_plugin_ecmwf.templates.common import (
    FORECAST_SOURCE,
    GRIB_OUTPUT_PATH,
    MAP_FORMAT,
    OUTPUT_ROOT,
    YESTERDAY_MIDNIGHT,
    map_area,
)

template = BlueprintTemplate(
    display_name="IFS Single-Member Snapshot",
    display_description="One member of the IFS ensemble: 2 m temperature and mean sea-level pressure at +24 h, as map plots over the area you choose and a GRIB file.",
    tags=["IFS Ensemble", "2t + msl", "Map plot + GRIB"],
    blocks={
        BlockInstanceId("source"): BlueprintTemplateBlock(
            factory_id=BlockFactoryId("operationalForecastSource"),
            instance=BlockInstance(
                configuration_values={
                    ConfigurationOptionId("source"): "${forecastSource}",
                    ConfigurationOptionId("forecast"): "ifs-ens",
                    ConfigurationOptionId("base_time"): YESTERDAY_MIDNIGHT,
                },
                input_ids={},
            ),
        ),
        BlockInstanceId("selectParam"): BlueprintTemplateBlock(
            factory_id=BlockFactoryId("select"),
            instance=BlockInstance(
                configuration_values={
                    ConfigurationOptionId("dimension"): "param",
                    ConfigurationOptionId("values"): "2t,msl",
                },
                input_ids={
                    "dataset": BlockInstanceId("source"),
                },
            ),
        ),
        BlockInstanceId("selectNumber"): BlueprintTemplateBlock(
            factory_id=BlockFactoryId("select"),
            instance=BlockInstance(
                configuration_values={
                    ConfigurationOptionId("dimension"): "number",
                    ConfigurationOptionId("values"): "0",
                },
                input_ids={
                    "dataset": BlockInstanceId("selectParam"),
                },
            ),
        ),
        BlockInstanceId("selectStep"): BlueprintTemplateBlock(
            factory_id=BlockFactoryId("select"),
            instance=BlockInstance(
                configuration_values={
                    ConfigurationOptionId("dimension"): "step",
                    ConfigurationOptionId("values"): "24",
                },
                input_ids={
                    "dataset": BlockInstanceId("selectNumber"),
                },
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
                    # A single step leaves nothing else to split on.
                    ConfigurationOptionId("splitby"): "param",
                },
                input_ids={
                    "dataset": BlockInstanceId("selectStep"),
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
                    "dataset": BlockInstanceId("selectStep"),
                },
            ),
        ),
    },
    environment=None,
    local_glyphs={},
    example_glyphs={
        "outputRoot": OUTPUT_ROOT,
        "forecastSource": FORECAST_SOURCE,
        "area": map_area("global"),
        "plotFormat": MAP_FORMAT,
    },
)
