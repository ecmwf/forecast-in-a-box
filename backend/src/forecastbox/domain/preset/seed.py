# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Seed data for built-in high-level presets.

Defines the five canonical presets that ship with Forecast-In-A-Box and
provides an idempotent ``seed_presets()`` coroutine that inserts them on
first run.  Running ``seed_presets()`` a second time is a no-op: each preset
is keyed on a stable ``preset_id`` string and is skipped when that id already
exists in the database.

Preset IDs are intentionally stable slug-style strings (not UUIDs) so that
the frontend can reference them by name after the migration away from
hardcoded presets.
"""

from __future__ import annotations

import datetime as dt
import logging

from fiab_core.fable import (
    BlockFactoryId,
    BlockInstance,
    BlockInstanceId,
    PluginBlockFactoryId,
    PluginCompositeId,
    PluginId,
    PluginStoreId,
)

from forecastbox.domain.blueprint.service import BlueprintBuilder
from forecastbox.domain.preset import db as preset_db
from forecastbox.domain.preset.models import HighLevelPreset, PresetDifficulty, PresetParameter
from forecastbox.domain.preset.types import PresetId
from forecastbox.utility.auth import PASSTHROUGH_USER_ID, AuthContext

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

_SEED_AUTHOR = PASSTHROUGH_USER_ID
"""All seed presets are owned by the passthrough / system user."""

_SEED_AUTH = AuthContext(user_id=_SEED_AUTHOR, is_admin=True)


def _plugin(store: str, local: str) -> PluginCompositeId:
    """Construct a PluginCompositeId from store and local identifiers."""
    return PluginCompositeId(store=PluginStoreId(store), local=PluginId(local))


def _factory_id(store: str, local: str, factory: str) -> PluginBlockFactoryId:
    """Construct a PluginBlockFactoryId."""
    return PluginBlockFactoryId(plugin=_plugin(store, local), factory=BlockFactoryId(factory))


def _block(factory_store: str, factory_local: str, factory: str, config: dict, inputs: dict | None = None) -> BlockInstance:
    """Convenience wrapper for constructing a BlockInstance."""
    return BlockInstance(
        factory_id=_factory_id(factory_store, factory_local, factory),
        configuration_values=config,
        input_ids={BlockInstanceId(k): BlockInstanceId(v) for k, v in (inputs or {}).items()},
    )


def _ecmwf_block(factory: str, config: dict, inputs: dict | None = None) -> BlockInstance:
    """Shorthand for blocks from the ``ecmwf:ecmwf-base`` plugin."""
    return _block("ecmwf", "ecmwf-base", factory, config, inputs)


# ---------------------------------------------------------------------------
# Preset definitions
# ---------------------------------------------------------------------------


def _quick_temperature_map() -> HighLevelPreset:
    """Quick Temperature Map — intermediate, featured.

    Fetches forecast data from ECMWF Open Data using a configurable model,
    computes the ensemble mean for 2 m temperature at multiple lead times,
    and writes map plots as PNG files.
    """
    builder = BlueprintBuilder(
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
                    "splitby": "none",
                },
                inputs={"dataset": "product_1"},
            ),
        }
    )
    return HighLevelPreset(
        preset_id=PresetId("quick-temperature-map"),
        version=1,
        name="Quick Temperature Map",
        description="Generate a global 2 m temperature ensemble-mean map from ECMWF Open Data with a configurable forecast model.",
        long_description=(
            "Fetches forecast data from the publicly available ECMWF Open Data stream using a "
            "configurable model (AIFS ensemble, AIFS deterministic, IFS ensemble, or IFS HRES), "
            "computes the ensemble mean for 2 m temperature across lead times of 24 h, 48 h, 72 h, "
            "and 360 h, and produces a global PNG map plot."
        ),
        difficulty=PresetDifficulty.intermediate,
        tags=["featured", "ensemble", "open-data", "map-plot"],
        icon="Thermometer",
        builder_template=builder,
        parameters=[
            PresetParameter(
                glyph_key="model",
                label="Forecast Model",
                description="ECMWF Open Data forecast model to retrieve data from.",
                value_type="ref://catalogue/ecmwf/ecmwf-base/operationalForecastSource/forecast",
                default_value="aifs-ens",
            ),
        ],
        is_published=True,
    )


def _regional_surface_forecast() -> HighLevelPreset:
    """Regional Surface Forecast — intermediate, featured.

    Ported from the ``aifs-forecast`` frontend preset with parameterised
    model, region, lead_time, and output_format glyphs.
    """
    builder = BlueprintBuilder(
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
            BlockInstanceId("WindPlot"): _ecmwf_block(
                "mapPlotSink",
                {
                    "param": "10u",  # TODO Add 10v when plots is fixed
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
                    "groupby": "none",
                    "splitby": "step",
                },
                inputs={"dataset": "source_1"},
            ),
        }
    )
    return HighLevelPreset(
        preset_id=PresetId("regional-surface-forecast"),
        version=1,
        name="Regional Surface Forecast",
        description="Run an AIFS surface forecast over a selectable region and lead time, with map plot output.",
        long_description=(
            "Uses a configurable AIFS forecast model to produce a surface forecast over any "
            "supported region.  Two map-plot sinks are wired up: one for 10 m wind speed over "
            "the chosen region, and one for 2 m temperature and mean sea-level pressure globally.  "
            "Adjust the model, region, lead time, and output format to suit your needs."
        ),
        difficulty=PresetDifficulty.intermediate,
        tags=["featured", "aifs", "regional", "map-plot"],
        icon="Map",
        builder_template=builder,
        parameters=[
            PresetParameter(
                glyph_key="model",
                label="Forecast Model",
                description="Model variant to run.",
                value_type="ref://catalogue/ecmwf/ecmwf-base/anemoiSource/checkpoint",
                default_value="ecmwf:aifs-global-o48",
            ),
            PresetParameter(
                glyph_key="region",
                label="Region",
                description="Geographical domain for the primary map plot.",
                value_type="enumClosed[global,europe,asia,north-america,south-america,africa,australia]",
                default_value="europe",
            ),
            PresetParameter(
                glyph_key="lead_time",
                label="Lead Time (hours)",
                description="Number of forecast hours to run the model forward.",
                value_type="int",
                default_value="72",
            ),
            PresetParameter(
                glyph_key="output_format",
                label="Output Format",
                description="File format for the map plot images.",
                value_type="enumClosed[png,pdf,svg]",
                default_value="png",
            ),
        ],
        is_published=True,
    )


def _global_ensemble_statistics() -> HighLevelPreset:
    """Global Ensemble Statistics — intermediate, featured.

    With parameterised model, param, statistic, and members glyphs.
    """
    builder = BlueprintBuilder(
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
        }
    )
    return HighLevelPreset(
        preset_id=PresetId("global-ensemble-statistics"),
        version=1,
        name="Global Ensemble Statistics",
        description="Compute ensemble statistics (mean, spread, etc.) for a chosen parameter and save to Zarr.",
        long_description=(
            "Retrieves AIFS ensemble members from ECMWF Open Data for a user-selected parameter, "
            "applies a chosen ensemble statistic (e.g. mean, standard deviation), and writes the "
            "result to a Zarr store.  Useful for post-processing ensemble output into a compact "
            "statistical summary."
        ),
        difficulty=PresetDifficulty.intermediate,
        tags=["featured", "ensemble", "statistics", "zarr"],
        icon="BarChart2",
        builder_template=builder,
        parameters=[
            PresetParameter(
                glyph_key="model",
                label="Forecast Model",
                description="ECMWF Open Data forecast model to retrieve data from.",
                value_type="ref://catalogue/ecmwf/ecmwf-base/operationalForecastSource/forecast",
                default_value="aifs-ens",
            ),
            PresetParameter(
                glyph_key="param",
                label="Parameter",
                description="Meteorological parameter to retrieve and process.",
                value_type="enumClosed[2t,10u,10v,msl,tp,z]",
                default_value="2t",
            ),
            PresetParameter(
                glyph_key="statistic",
                label="Statistic",
                description="Ensemble statistic to compute across members.",
                value_type="enumClosed[mean,std,min,max,median]",
                default_value="mean",
            ),
            PresetParameter(
                glyph_key="members",
                label="Ensemble Members",
                description="Ensemble member numbers to include.",
                value_type="list[int]",
                default_value="1,2,3,4,5,6",
            ),
        ],
        is_published=True,
    )


def _aifs_ensemble_to_grib() -> HighLevelPreset:
    """Sample AIFS Forecast to GRIB — intermediate, featured, weather-forecast.

    Runs the AIFS model and writes the output directly to a GRIB file.  Parameterised model
    checkpoint, lead time, and base time glyphs give users control over the
    key run settings.
    """
    builder = BlueprintBuilder(
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
        }
    )
    return HighLevelPreset(
        preset_id=PresetId("aifs-to-grib"),
        version=1,
        name="Sample AIFS Forecast to GRIB",
        description="Run a sample AIFS forecast and export the output as a GRIB file.",
        long_description=(
            "Runs using a configurable AIFS checkpoint and lead time, "
            "then writes the full output to a GRIB file.  The output path embeds the run ID "
            "and attempt count so that repeated runs never overwrite each other."
        ),
        difficulty=PresetDifficulty.intermediate,
        tags=["featured", "aifs", "grib", "export"],
        icon="FileArchive",
        builder_template=builder,
        parameters=[
            PresetParameter(
                glyph_key="model",
                label="Model Checkpoint",
                description="AIFS global model checkpoint to run.",
                value_type="ref://catalogue/ecmwf/ecmwf-base/anemoiSource/checkpoint",
                default_value="ecmwf:aifs-global-o48",
            ),
            PresetParameter(
                glyph_key="lead_time",
                label="Lead Time (hours)",
                description="Number of forecast hours to run the model forward.",
                value_type="int",
                default_value="72",
            ),
            PresetParameter(
                glyph_key="base_time",
                label="Base Time",
                description="Forecast initialisation date-time (ISO 8601). Defaults to today at midnight UTC.",
                value_type="datetime",
                default_value="${submitDatetime | floor_day}",
            ),
        ],
        is_published=True,
    )


def _blank_canvas() -> HighLevelPreset:
    """Blank Canvas — advanced, custom.

    Ported from the ``custom-model`` frontend preset.  Returns an empty
    builder so the user can construct a pipeline from scratch in the Fable
    editor.
    """
    builder = BlueprintBuilder(blocks={})
    return HighLevelPreset(
        preset_id=PresetId("blank-canvas"),
        version=1,
        name="Blank Canvas",
        description="Start with an empty pipeline and build your own Fable from scratch.",
        long_description=(
            "Opens the Fable editor with no blocks pre-configured.  Drag sources, products, "
            "and sinks from the catalogue to compose a completely custom pipeline.  "
            "Recommended for advanced users who know exactly what they want to build."
        ),
        difficulty=PresetDifficulty.advanced,
        tags=["featured", "custom", "blank"],
        icon="Layers",
        builder_template=builder,
        parameters=[],
        is_published=True,
    )


# ---------------------------------------------------------------------------
# Ordered list of all seed presets
# ---------------------------------------------------------------------------

SEED_PRESETS: list[HighLevelPreset] = [
    _quick_temperature_map(),
    _regional_surface_forecast(),
    _global_ensemble_statistics(),
    _aifs_ensemble_to_grib(),
    _blank_canvas(),
]
"""All five built-in presets in display order."""


# ---------------------------------------------------------------------------
# Public seeding coroutine
# ---------------------------------------------------------------------------


async def _insert_seed_preset(preset: HighLevelPreset) -> None:
    """Directly insert a single seed preset at version 1.

    This bypasses ``preset_db.create_preset`` to use a stable preset_id from
    the seed data rather than generating a new UUID. For seeding we always
    want to create a fresh row with a stable slug ID and version 1.
    """
    import forecastbox.schemata.jobs as _jobs_module
    from forecastbox.schemata.jobs import HighLevelPreset as HighLevelPresetRow

    ref_time = dt.datetime.now()
    row = HighLevelPresetRow(
        preset_id=preset.preset_id,
        version=1,
        name=preset.name,
        description=preset.description,
        long_description=preset.long_description,
        difficulty=preset.difficulty.value,
        tags=list(preset.tags),
        icon=preset.icon,
        builder_template=preset.builder_template.model_dump(mode="json"),
        parameters=[p.model_dump(mode="json") for p in preset.parameters],
        is_published=preset.is_published,
        created_by=_SEED_AUTHOR,
        created_at=ref_time,
        updated_at=ref_time,
        is_deleted=False,
    )
    async with _jobs_module.async_session_maker() as session:
        session.add(row)
        await session.commit()


async def seed_presets() -> None:
    """Insert all seed presets that do not already exist in the database.

    This function is idempotent: it checks whether each preset's ``preset_id``
    already exists before attempting an insert, so running it multiple times
    (e.g. on every application start-up) is safe and will not create duplicate
    rows.

    Presets are inserted with ``is_published=True`` and owned by the system
    (passthrough) user.  The version stored in the database is always 1 for
    freshly seeded presets.
    """
    for preset in SEED_PRESETS:
        existing = await preset_db.get_preset(preset.preset_id)
        if existing is not None:
            logger.debug("Seed preset %r already exists — skipping.", preset.preset_id)
            continue

        try:
            await _insert_seed_preset(preset)
            logger.info("Seeded preset %r (version 1).", preset.preset_id)
        except Exception:
            logger.exception("Failed to seed preset %r.", preset.preset_id)
            raise
