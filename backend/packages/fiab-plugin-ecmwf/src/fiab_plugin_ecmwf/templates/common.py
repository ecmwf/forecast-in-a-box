# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Values shared by this plugin's blueprint templates."""

from fiab_core.fable import BlueprintTemplateExampleInput
from fiab_core.types import ClosedEnumType, StringType, GeoDomainType

# `[shortName]` is the sink's own metadata templating, not a glyph.
GRIB_OUTPUT_PATH = "${outputRoot}/${runId}__${attemptCount}/[shortName].grib"

# Yesterday's 00Z: today's run is not published until mid-morning.
YESTERDAY_MIDNIGHT = "${submitDatetime |sub_days(1) |floor_day}"

OUTPUT_ROOT = BlueprintTemplateExampleInput(
    example_value="/tmp/outputRoot",
    display_name="Output Root Location",
    display_description="Each attempt writes to its own folder below this path",
    type_hint=StringType(),
)

FORECAST_SOURCE = BlueprintTemplateExampleInput(
    example_value="ecmwf-open-data",
    display_name="Forecast Source",
    display_description="Where to download the forecast from",
    type_hint=ClosedEnumType(["mars", "ecmwf-open-data"]),
)


def map_area(example_value: str) -> BlueprintTemplateExampleInput:
    """Map Area glyph. Templates differ only in which region they open on."""
    return BlueprintTemplateExampleInput(
        example_value=example_value,
        display_name="Map Area",
        display_description="Area the map plot covers",
        type_hint=GeoDomainType(),
    )


MAP_FORMAT = BlueprintTemplateExampleInput(
    example_value="png",
    display_name="Output Format",
    display_description="Image format for the map plot",
    type_hint=ClosedEnumType(["png", "pdf", "svg"]),
)
