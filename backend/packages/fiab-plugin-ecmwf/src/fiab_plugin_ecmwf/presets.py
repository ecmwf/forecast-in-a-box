# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""ECMWF plugin preset definitions.

Defines the four ECMWF-specific presets that ship with ``fiab-plugin-ecmwf``
as :class:`~fiab_core.presets.PluginPresetDefinition` objects.  These are
served in-memory by the plugin and never persisted to the database.
"""

from __future__ import annotations

from fiab_core.fable import (
    BlockFactoryId,
    BlockInstance,
    BlockInstanceId,
    PluginBlockFactoryId,
    PluginCompositeId,
    PluginId,
    PluginStoreId,
)
from fiab_core.presets import PluginPresetDefinition, PluginPresetParameter

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

_ECMWF_PLUGIN = PluginCompositeId(store=PluginStoreId("ecmwf"), local=PluginId("ecmwf-base"))
"""Composite plugin identity for all blocks in this plugin."""


def _ecmwf_block(factory: str, config: dict, inputs: dict | None = None) -> BlockInstance:
    """Construct a :class:`BlockInstance` for a factory in this plugin."""
    return BlockInstance(
        factory_id=PluginBlockFactoryId(
            plugin=_ECMWF_PLUGIN,
            factory=BlockFactoryId(factory),
        ),
        configuration_values=config,
        input_ids={BlockInstanceId(k): BlockInstanceId(v) for k, v in (inputs or {}).items()},
    )


# ---------------------------------------------------------------------------
# Preset definitions
# ---------------------------------------------------------------------------


def _quick_temperature_map() -> PluginPresetDefinition:
    """Quick Temperature Map — intermediate, featured.

    Fetches forecast data from ECMWF Open Data using a configurable model,
    computes the ensemble mean for 2 m temperature at multiple lead times,
    and writes map plots as PNG files.
    """
    return PluginPresetDefinition(
        preset_id="quick-temperature-map",
        name="Quick Temperature Map",
        description="Generate a global 2 m temperature ensemble-mean map from ECMWF Open Data with a configurable forecast model.",
        long_description=(
            "Fetches forecast data from the publicly available ECMWF Open Data stream using a "
            "configurable model (AIFS ensemble, AIFS deterministic, IFS ensemble, or IFS HRES), "
            "computes the ensemble mean for 2 m temperature across lead times of 24 h, 48 h, 72 h, "
            "and 360 h, and produces a global PNG map plot."
        ),
        difficulty="intermediate",
        tags=["featured", "ensemble", "open-data", "map-plot"],
        icon="Thermometer",
        blocks={
            BlockInstanceId("source_1"): _ecmwf_block(
                "operationalForecastSource",
                {
                    "source": "ecmwf-open-data",
                    "forecast": "${model}",
                    "base_time": "${submitDatetime | floor_day}",
                    "param": "2t",
                    "step": "24,48,72,360",
                    "number": "1,2,3,4,5,6",
                },
            ),
            BlockInstanceId("product_1"): _ecmwf_block(
                "ensembleStatistics",
                {
                    "param": "2t",
                    "statistic": "mean",
                },
                inputs={"dataset": "source_1"},
            ),
            BlockInstanceId("TemperaturePlot"): _ecmwf_block(
                "mapPlotSink",
                {
                    "param": "2t",
                    "domain": "global",
                    "format": "png",
                    "groupby": "none",
                    "splitby": "step",
                },
                inputs={"dataset": "product_1"},
            ),
        },
        parameters=[
            PluginPresetParameter(
                glyph_key="model",
                label="Forecast Model",
                description="ECMWF Open Data forecast model to retrieve data from.",
                value_type="ref://catalogue/ecmwf/ecmwf-base/operationalForecastSource/forecast",
                default_value="aifs-ens",
            ),
        ],
    )


def _regional_surface_forecast() -> PluginPresetDefinition:
    """Regional Surface Forecast — intermediate, featured.

    Ported from the ``aifs-forecast`` frontend preset with parameterised
    model, region, lead_time, and output_format glyphs.
    """
    return PluginPresetDefinition(
        preset_id="regional-surface-forecast",
        name="Regional Surface Forecast",
        description="Run an AIFS surface forecast over a selectable region and lead time, with map plot output.",
        long_description=(
            "Uses a configurable AIFS forecast model to produce a surface forecast over any "
            "supported region.  Two map-plot sinks are wired up: one for 10 m wind speed over "
            "the chosen region, and one for 2 m temperature and mean sea-level pressure globally.  "
            "Adjust the model, region, lead time, and output format to suit your needs."
        ),
        difficulty="intermediate",
        tags=["featured", "aifs", "regional", "map-plot"],
        icon="Map",
        blocks={
            BlockInstanceId("source_1"): _ecmwf_block(
                "anemoiSource",
                {
                    "checkpoint": "${model}",
                    "input_source": "opendata",
                    "lead_time": "${lead_time}",
                    "base_time": "${submitDatetime | floor_day}",
                    "number": "1",
                },
            ),
            BlockInstanceId("PrecipPlot"): _ecmwf_block(
                "mapPlotSink",
                {
                    "param": "tp",
                    "domain": "${region}",
                    "format": "${output_format}",
                    "groupby": "none",
                    "splitby": "step",
                },
                inputs={"dataset": "source_1"},
            ),
            BlockInstanceId("TemperaturePlot"): _ecmwf_block(
                "mapPlotSink",
                {
                    "param": "2t,msl",
                    "domain": "${region}",
                    "format": "${output_format}",
                    "groupby": "valid_datetime",
                    "splitby": "step",
                },
                inputs={"dataset": "source_1"},
            ),
        },
        parameters=[
            PluginPresetParameter(
                glyph_key="model",
                label="Forecast Model",
                description="Model variant to run.",
                value_type="ref://catalogue/ecmwf/ecmwf-base/anemoiSource/checkpoint",
                default_value="ecmwf:aifs-global-o48",
            ),
            PluginPresetParameter(
                glyph_key="region",
                label="Region",
                description="Geographical domain for the primary map plot.",
                value_type="enumClosed[global,Europe,Asia,North America,South America,Africa,Australia]",
                default_value="Europe",
            ),
            PluginPresetParameter(
                glyph_key="lead_time",
                label="Lead Time (hours)",
                description="Number of forecast hours to run the model forward.",
                value_type="int",
                default_value="72",
            ),
            PluginPresetParameter(
                glyph_key="output_format",
                label="Output Format",
                description="File format for the map plot images.",
                value_type="enumClosed[png,pdf,svg]",
                default_value="png",
            ),
        ],
    )


def _global_ensemble_statistics() -> PluginPresetDefinition:
    """Global Ensemble Statistics — intermediate, featured.

    With parameterised model, param, statistic, and members glyphs.
    """
    return PluginPresetDefinition(
        preset_id="global-ensemble-statistics",
        name="Global Ensemble Statistics",
        description="Compute ensemble statistics (mean, spread, etc.) for a chosen parameter and save to Zarr.",
        long_description=(
            "Retrieves AIFS ensemble members from ECMWF Open Data for a user-selected parameter, "
            "applies a chosen ensemble statistic (e.g. mean, standard deviation), and writes the "
            "result to a Zarr store.  Useful for post-processing ensemble output into a compact "
            "statistical summary."
        ),
        difficulty="intermediate",
        tags=["featured", "ensemble", "statistics", "zarr"],
        icon="BarChart2",
        blocks={
            BlockInstanceId("source_1"): _ecmwf_block(
                "operationalForecastSource",
                {
                    "source": "ecmwf-open-data",
                    "forecast": "${model}",
                    "base_time": "${submitDatetime | floor_day}",
                    "param": "${param}",
                    "step": "0",
                    "number": "${members}",
                },
            ),
            BlockInstanceId("product_1"): _ecmwf_block(
                "ensembleStatistics",
                {
                    "param": "${param}",
                    "statistic": "${statistic}",
                },
                inputs={"dataset": "source_1"},
            ),
            BlockInstanceId("ZarrSink"): _ecmwf_block(
                "zarrSink",
                {
                    "path": "/tmp/${runId}_${attemptCount}/ensemble-statistics.zarr",
                },
                inputs={"dataset": "product_1"},
            ),
        },
        parameters=[
            PluginPresetParameter(
                glyph_key="model",
                label="Forecast Model",
                description="ECMWF Open Data forecast model to retrieve data from.",
                value_type="ref://catalogue/ecmwf/ecmwf-base/operationalForecastSource/forecast",
                default_value="aifs-ens",
            ),
            PluginPresetParameter(
                glyph_key="param",
                label="Parameter",
                description="Meteorological parameter to retrieve and process.",
                value_type="enumClosed[2t,10u,10v,msl,tp,z]",
                default_value="2t",
            ),
            PluginPresetParameter(
                glyph_key="statistic",
                label="Statistic",
                description="Ensemble statistic to compute across members.",
                value_type="enumClosed[mean,std,min,max,median]",
                default_value="mean",
            ),
            PluginPresetParameter(
                glyph_key="members",
                label="Ensemble Members",
                description="Ensemble member numbers to include.",
                value_type="list[int]",
                default_value="1,2,3,4,5,6",
            ),
        ],
    )


def _aifs_ensemble_to_grib() -> PluginPresetDefinition:
    """Sample AIFS Forecast to GRIB — intermediate, featured, weather-forecast.

    Runs the AIFS model and writes the output directly to a GRIB file.  Parameterised model
    checkpoint, lead time, and base time glyphs give users control over the
    key run settings.
    """
    return PluginPresetDefinition(
        preset_id="aifs-to-grib",
        name="Sample AIFS Forecast to GRIB",
        description="Run a sample AIFS forecast and export the output as a GRIB file.",
        long_description=(
            "Runs using a configurable AIFS checkpoint and lead time, "
            "then writes the full output to a GRIB file.  The output path embeds the run ID "
            "and attempt count so that repeated runs never overwrite each other."
        ),
        difficulty="intermediate",
        tags=["featured", "aifs", "grib", "export"],
        icon="FileArchive",
        blocks={
            BlockInstanceId("source_1"): _ecmwf_block(
                "anemoiSource",
                {
                    "checkpoint": "${model}",
                    "input_source": "opendata",
                    "lead_time": "${lead_time}",
                    "base_time": "${base_time}",
                    "number": "1",
                },
            ),
            BlockInstanceId("gribSink"): _ecmwf_block(
                "gribSink",
                {
                    "path": "/tmp/${runId}_${attemptCount}/forecast.grib",
                },
                inputs={"dataset": "source_1"},
            ),
        },
        parameters=[
            PluginPresetParameter(
                glyph_key="model",
                label="Model Checkpoint",
                description="AIFS global model checkpoint to run.",
                value_type="ref://catalogue/ecmwf/ecmwf-base/anemoiSource/checkpoint",
                default_value="ecmwf:aifs-global-o48",
            ),
            PluginPresetParameter(
                glyph_key="lead_time",
                label="Lead Time (hours)",
                description="Number of forecast hours to run the model forward.",
                value_type="int",
                default_value="72",
            ),
            PluginPresetParameter(
                glyph_key="base_time",
                label="Base Time",
                description="Forecast initialisation date-time (ISO 8601). Defaults to today at midnight UTC.",
                value_type="datetime",
                default_value="${submitDatetime | floor_day}",
            ),
        ],
    )


# ---------------------------------------------------------------------------
# Exported list of all ECMWF presets
# ---------------------------------------------------------------------------

ECMWF_PRESETS: list[PluginPresetDefinition] = [
    _quick_temperature_map(),
    _regional_surface_forecast(),
    _global_ensemble_statistics(),
    _aifs_ensemble_to_grib(),
]
"""All four ECMWF plugin presets in display order."""
