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

template = BlueprintTemplate(
    display_name="Prototype Template",
    display_description="A simple fetch of a recent forecast, selection of temperature, and saving of a grib",
    blocks={
        BlockInstanceId("block_1784116163887_4my2dcp"): BlueprintTemplateBlock(
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
        BlockInstanceId("block_1784116184409_sdaoh52"): BlueprintTemplateBlock(
            factory_id=BlockFactoryId("select"),
            instance=BlockInstance(
                configuration_values={
                    ConfigurationOptionId("dimension"): "param",
                    ConfigurationOptionId("values"): "2t",
                },
                input_ids={
                    "dataset": BlockInstanceId("block_1784116163887_4my2dcp"),
                },
            ),
        ),
        BlockInstanceId("block_1784116202433_qaqj75m"): BlueprintTemplateBlock(
            factory_id=BlockFactoryId("gribSink"),
            instance=BlockInstance(
                configuration_values={
                    ConfigurationOptionId("path"): "${outputRoot}/${runId}.${attemptCount}",
                },
                input_ids={
                    "dataset": BlockInstanceId("block_1784116184409_sdaoh52"),
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
            type_hint="str",
        ),
        "forecastSource": BlueprintTemplateExampleInput(
            example_value="ecmwf-open-data",
            display_name="Forecast Source",
            display_description="Where to download the forecast from",
            type_hint="enumClosed[mars,ecmwf-open-data]",
        ),
    },
)
