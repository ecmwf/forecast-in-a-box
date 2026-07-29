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
    FORECAST_SOURCE,
    GRIB_OUTPUT_PATH,
    MAP_FORMAT,
    OUTPUT_ROOT,
    YESTERDAY_MIDNIGHT,
    map_area,
)

template = BlueprintTemplate(
    display_name="IFS Ensemble Statistics",
    display_description="Mean or standard deviation of 2 m temperature at +72 h, as a map plot over the area you choose and a GRIB file.",
    tags=["IFS Ensemble", "Mean or Std", "Map plot + GRIB"],
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
        # Ensemble Statistics handles one parameter at a time.
        BlockInstanceId("selectParam"): BlueprintTemplateBlock(
            factory_id=BlockFactoryId("select"),
            instance=BlockInstance(
                configuration_values={
                    ConfigurationOptionId("dimension"): "param",
                    ConfigurationOptionId("values"): "2t",
                },
                input_ids={
                    "dataset": BlockInstanceId("source"),
                },
            ),
        ),
        BlockInstanceId("selectStep"): BlueprintTemplateBlock(
            factory_id=BlockFactoryId("select"),
            instance=BlockInstance(
                configuration_values={
                    ConfigurationOptionId("dimension"): "step",
                    ConfigurationOptionId("values"): "72",
                },
                input_ids={
                    "dataset": BlockInstanceId("selectParam"),
                },
            ),
        ),
        BlockInstanceId("ensembleStatistic"): BlueprintTemplateBlock(
            factory_id=BlockFactoryId("ensembleStatistics"),
            instance=BlockInstance(
                configuration_values={
                    ConfigurationOptionId("param"): "2t",
                    ConfigurationOptionId("statistic"): "${statistic}",
                },
                input_ids={
                    "dataset": BlockInstanceId("selectStep"),
                },
            ),
        ),
        BlockInstanceId("mapPlot"): BlueprintTemplateBlock(
            factory_id=BlockFactoryId("mapPlotSink"),
            instance=BlockInstance(
                configuration_values={
                    ConfigurationOptionId("param"): "2t",
                    ConfigurationOptionId("domain"): "${area}",
                    ConfigurationOptionId("format"): "${plotFormat}",
                    ConfigurationOptionId("groupby"): "none",
                    # A single field at a single step leaves nothing to split on.
                    ConfigurationOptionId("splitby"): "none",
                },
                input_ids={
                    "dataset": BlockInstanceId("ensembleStatistic"),
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
                    "dataset": BlockInstanceId("ensembleStatistic"),
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
        "statistic": BlueprintTemplateExampleInput(
            example_value="mean",
            display_name="Ensemble Statistic",
            display_description="Statistic to compute over the ensemble",
            type_hint=ClosedEnumType(["mean", "std"]),
        ),
    },
)
