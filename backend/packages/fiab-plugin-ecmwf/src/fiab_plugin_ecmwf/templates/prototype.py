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
from fiab_core.types import ClosedEnumType, StringType

template = BlueprintTemplate(
    display_name="Prototype Template",
    display_description="Fetch recent forecast, select temperature in a day by one ensemble member, save as a grib",
    blocks={
        BlockInstanceId("source"): BlueprintTemplateBlock(
            factory_id=BlockFactoryId("operationalForecastSource"),
            instance=BlockInstance(
                configuration_values={
                    ConfigurationOptionId("source"): "${forecastSource}",
                    ConfigurationOptionId("forecast"): "ifs-ens",
                    ConfigurationOptionId("base_time"): "${submitDatetime |floor_day}",
                },
                input_ids={},
            ),
        ),
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
        BlockInstanceId("sink"): BlueprintTemplateBlock(
            factory_id=BlockFactoryId("gribSink"),
            instance=BlockInstance(
                configuration_values={
                    ConfigurationOptionId("path"): "${outputRoot}/${runId}.${attemptCount}",
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
        "outputRoot": BlueprintTemplateExampleInput(
            example_value="/tmp/outputRoot",
            display_name="Output Root Location",
            display_description="The GRIB files will be saved to a {runId}.{attemptCount} folder in here",
            type_hint=StringType(),
        ),
        "forecastSource": BlueprintTemplateExampleInput(
            example_value="ecmwf-open-data",
            display_name="Forecast Source",
            display_description="Where to download the forecast from",
            type_hint=ClosedEnumType(["mars", "ecmwf-open-data"]),
        ),
    },
)
