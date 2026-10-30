# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""checkpointMatrix scenario.

Runs a series of checkpoints, each against a list of input sources, through a simple workflow:
anemoiSource -> gribSink, and anemoiSource -> mapPlotSink for 2t, msl and tp (skipped for models with
plot=False, whose output cannot be plotted yet). Every
(checkpoint, input source) combination is a separate run; all combinations are attempted and the
scenario fails at the end if any of them failed.

Opt-in: nothing runs unless FIAB_E2E_CHECKPOINTS is set, since the combinations need real input
data (opendata, polytope credentials, ...) and some checkpoints need a large GPU. The variable is a
`;`-separated list of entries, each either
 - a checkpoint listed in MODELS, eg `aifs-global-o48`, run against its listed sources,
 - `<checkpoint>=<source>,<source>`, eg `graceful-gazelle-v2=polytope:mars`, to run any checkpoint
   the backend knows about against the given sources,
 - a preset from PRESETS: `oper` for every checkpoint listed in MODELS, `demo` for the small demo
   checkpoints only.
A checkpoint is given either as its local id, looked up across the backend's artifact stores, or
as `<store>:<local id>` to pick the store, eg `local:aifs-global-o48`.

Assumptions (see also README.md):
 - the backend is already running and reachable (see common.base_url()),
 - the fiab_plugin_ecmwf plugin is already installed, exposing the `anemoiSource`/`gribSink`/
   `mapPlotSink` block factories,
 - the runner and the backend share a filesystem, for checking the grib files.

Does not assume it is the only thing running against the backend: grib outputs are written below a
${runId}/${attemptCount}-templated directory, and plots are run outputs held by the backend.
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta, timezone

import httpx
from common import (
    create_and_submit_run,
    ensure_model_downloaded,
    ensure_run_completed,
    find_plugin_id,
    format_seconds,
    resolve_checkpoint,
    run_phase_timings,
    stop_run_if_active,
    wait_for_backend_ready,
)

logger = logging.getLogger("forecastbox.tests.runner")

CHECKPOINTS_ENV = "FIAB_E2E_CHECKPOINTS"

# 2t, msl and tp, as the paramIds the mapPlotSink param option expects
PLOT_PARAMS = {"167": "2t", "151": "msl", "228": "tp"}
GRIB_ROOT = "/tmp/fiab-largeE2E-checkpointMatrix"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
# Run phases timed from the cascade task tracing markers, by a substring of the task ids; "total" is the run wall time,
# from submission to completion as seen by the scenario
PHASES = {
    "input": "anemoi.inference._get_initial_conditions",
    "model": "anemoi.inference.run_as_earthkit",
    "grib": "output.runtime.write_grib",
    "plot": "plotting.runtime.map_plot",
}


@dataclass(frozen=True)
class ModelCase:
    sources: list[str]
    lead_time_hours: int = 12
    plot_domain: str = "datadefined"
    plot: bool = True
    run_attempts: int = 1800  # polls of 2s, ie up to an hour per run


# Keyed by the checkpoint's local id, the store it is in is looked up in the backend (see common.resolve_checkpoint)
MODELS: dict[str, ModelCase] = {
    "aifs-global-o48": ModelCase(sources=["opendata:ecmwf:lowres"], plot_domain="global"),
    "BRIS-Europe-2025.10": ModelCase(sources=["opendata:ecmwf:lowres"]),
    "graceful-gazelle": ModelCase(sources=["opendata:ecmwf:highres"]),
    "aifs-single-mse-2.0": ModelCase(sources=["opendata:ecmwf:lowres"]),
    "aila-v2": ModelCase(sources=["opendata:ecmwf:highres"]),
    "BRIS-2025.10": ModelCase(sources=["opendata:ecmwf:highres"]),
}

# Named sets of MODELS, usable as FIAB_E2E_CHECKPOINTS entries
PRESETS: dict[str, list[str]] = {
    "oper": list(MODELS),
    "demo": ["aifs-global-o48", "BRIS-Europe-2025.10"],
}


def _local_id(checkpoint: str) -> str:
    return checkpoint.split(":", 1)[-1]


def selected_models() -> dict[str, ModelCase]:
    """Parse FIAB_E2E_CHECKPOINTS into the checkpoints to run, see the module docstring."""
    raw = os.environ.get(CHECKPOINTS_ENV, "").strip()
    selected: dict[str, ModelCase] = {}
    for entry in filter(None, (e.strip() for e in raw.split(";"))):
        if entry in PRESETS:
            selected.update((checkpoint, MODELS[checkpoint]) for checkpoint in PRESETS[entry])
        elif "=" in entry:
            checkpoint, sources = (part.strip() for part in entry.split("=", 1))
            base = MODELS.get(_local_id(checkpoint), ModelCase(sources=[]))
            source_list = [s.strip() for s in sources.split(",") if s.strip()]
            if not source_list:
                raise ValueError(f"{CHECKPOINTS_ENV} entry {entry!r} lists no sources")
            selected[checkpoint] = replace(base, sources=source_list)
        elif _local_id(entry) in MODELS:
            selected[entry] = MODELS[_local_id(entry)]
        else:
            raise ValueError(
                f"{CHECKPOINTS_ENV} entry {entry!r} is neither in MODELS nor a preset {sorted(PRESETS)}, give its sources as '{entry}=<source>,<source>'"
            )
    return selected


def default_base_time() -> datetime:
    """Yesterday 00 UTC, available from both opendata and polytope."""
    return (datetime.now(timezone.utc) - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)


def build_blueprint_builder(plugin: dict[str, str], checkpoint: str, source: str, model: ModelCase, base_time: datetime) -> dict:
    """anemoiSource -> gribSink, and anemoiSource -> mapPlotSink (one png per param and step) unless model.plot is False."""

    def block(instance_id: str, factory: str, configuration_values: dict[str, str], input_ids: dict[str, str]) -> dict:
        return {
            "instance_id": instance_id,
            "plugin": plugin,
            "factory": factory,
            "instance": {"configuration_values": configuration_values, "input_ids": input_ids},
        }

    blocks = [
        block(
            "source",
            "anemoiSource",
            {
                "checkpoint": checkpoint,
                "input_source": source,
                "lead_time": str(model.lead_time_hours),
                "base_time": base_time.strftime("%Y-%m-%dT%H:%M:%S"),
                "number": "1",
            },
            {},
        ),
        block(
            "grib",
            "gribSink",
            {"path": GRIB_ROOT + "/${runId}__${attemptCount}/[shortName].grib"},
            {"dataset": "source"},
        ),
    ]
    if model.plot:
        blocks.append(
            block(
                "plot",
                "mapPlotSink",
                {
                    "param": ",".join(PLOT_PARAMS),
                    "domain": model.plot_domain,
                    "format": "png",
                    "groupby": "none",
                    "splitby": "step,param",
                    "style": "ECMWF",
                },
                {"dataset": "source"},
            )
        )
    return {"blocks": blocks, "environment": None, "local_glyphs": {}}


def verify_outputs(client: httpx.Client, detail: dict, model: ModelCase) -> None:
    run_id, attempt_count = detail["run_id"], detail["attempt_count"]
    outputs: dict[str, dict] = (detail.get("outputs") or {}).get("outputs", {})

    unavailable = [task for task, output in outputs.items() if not output["is_available"]]
    assert not unavailable, f"outputs not available: {unavailable}"

    if model.plot:
        plots = {task: output for task, output in outputs.items() if output["original_block"] == "plot"}
        steps = model.lead_time_hours // 6
        assert len(plots) >= len(PLOT_PARAMS), f"expected at least {len(PLOT_PARAMS)} plots, got {len(plots)}: {list(plots)}"
        logger.info(f"{len(plots)} plots for {len(PLOT_PARAMS)} params, lead time {model.lead_time_hours}h ({steps} steps of 6h)")
        task, output = next(iter(plots.items()))
        assert output["mime_type"] == "image/png", f"unexpected plot mime type {output['mime_type']!r}"
        content = client.get(
            "/run/outputContent", params={"run_id": run_id, "attempt_count": attempt_count, "dataset_id": task}, timeout=60
        )
        content.raise_for_status()
        assert content.content.startswith(PNG_SIGNATURE), f"plot {task} is not a png"

    grib_dir = f"{GRIB_ROOT}/{run_id}__{attempt_count}"
    assert os.path.isdir(grib_dir), f"expected grib output directory {grib_dir!r}, not found"
    grib_files = sorted(f for f in os.listdir(grib_dir) if f.endswith(".grib"))
    missing = [name for name in PLOT_PARAMS.values() if f"{name}.grib" not in grib_files]
    assert not missing, f"grib files for {missing} not found in {grib_dir}, found {grib_files}"
    logger.info(f"{len(grib_files)} grib files in {grib_dir}")


@dataclass
class CombinationResult:
    error: str | None
    # wall time in seconds of each of PHASES and of the whole run ("total"), None when unknown
    timings: dict[str, float | None] = field(default_factory=dict)

    def describe_timings(self) -> str:
        return ", ".join(f"{name} {format_seconds(self.timings.get(name))}" for name in TIMING_COLUMNS)


TIMING_COLUMNS = [*PHASES, "total"]


def run_combination(
    client: httpx.Client, plugin: dict[str, str], checkpoint: str, source: str, model: ModelCase, base_time: datetime, scenario: str
) -> CombinationResult:
    """Run and verify one combination; failures are returned as the result error, with the timings known so far.

    A run still active when the scenario stops waiting for it is stopped. The timings are logged once the run is over.
    """
    run_id, attempt_count, error = None, 1, None
    start = time.monotonic()
    try:
        builder = build_blueprint_builder(plugin, checkpoint, source, model, base_time)
        run_id, attempt_count = create_and_submit_run(client, builder, f"largeE2E {scenario} {checkpoint} {source}")
        detail = ensure_run_completed(client, run_id, attempts=model.run_attempts)
        verify_outputs(client, detail, model)
    except Exception as e:
        logger.exception(f"{checkpoint} with {source} failed")
        error = repr(e)
    total = time.monotonic() - start

    timings: dict[str, float | None] = dict.fromkeys(PHASES)
    if run_id is not None:
        if error is not None:
            try:
                stop_run_if_active(client, run_id, attempt_count)
            except Exception as e:
                logger.warning(f"could not stop run {run_id}: {e!r}")
        try:
            timings = run_phase_timings(client, run_id, attempt_count, PHASES)
        except Exception as e:
            logger.warning(f"could not determine the phase timings of run {run_id}: {e!r}")
    result = CombinationResult(error=error, timings={**timings, "total": total})
    logger.info(f"{checkpoint} with {source} timings: {result.describe_timings()}")
    return result


def timings_table(rows: list[tuple[str, CombinationResult]], extra: dict[str, list[str]] | None = None) -> str:
    """Format a table with one row per labelled result: the timings, optional extra columns and the outcome."""
    extra = extra or {}
    width = max(len(label) for label, _ in rows)
    widths = {name: max(len(name), *(len(v) for v in values)) for name, values in extra.items()}
    header = (
        f"  {'':<{width}}  " + " ".join(f"{name:>7}" for name in TIMING_COLUMNS) + "".join(f"  {name:>{widths[name]}}" for name in extra)
    )
    lines = [header]
    for index, (label, result) in enumerate(rows):
        cells = " ".join(f"{format_seconds(result.timings.get(name)):>7}" for name in TIMING_COLUMNS)
        cells += "".join(f"  {values[index]:>{widths[name]}}" for name, values in extra.items())
        outcome = "ok" if result.error is None else "FAILED: " + result.error[:300]
        lines.append(f"  {label:<{width}}  {cells}  {outcome}")
    return (
        "wall time per phase, from the first of its tasks starting to the last one computed (phases can overlap, and the total "
        "also includes installing the run environments and scheduling):\n" + "\n".join(lines)
    )


def run(client: httpx.Client) -> None:
    models = selected_models()
    if not models:
        logger.info(
            f"{CHECKPOINTS_ENV} not set, skipping (see the module docstring); listed checkpoints: {list(MODELS)}, presets: {PRESETS}"
        )
        return

    wait_for_backend_ready(client)
    plugin = find_plugin_id(client, "anemoiSource")
    logger.info(f"resolved fiab_plugin_ecmwf as plugin id {plugin}")

    base_time = default_base_time()
    results: list[tuple[str, CombinationResult]] = []
    for requested, model in models.items():
        checkpoint = requested
        try:
            checkpoint = resolve_checkpoint(client, requested)
            logger.info(f"ensuring model {checkpoint} is downloaded (this can take a while on a cold cache)")
            ensure_model_downloaded(client, checkpoint)
        except Exception as e:
            results.extend((f"{checkpoint} {source}", CombinationResult(error=f"model not available: {e!r}")) for source in model.sources)
            continue
        for source in model.sources:
            logger.info(f"--- {checkpoint} with {source} ---")
            result = run_combination(client, plugin, checkpoint, source, model, base_time, "checkpointMatrix")
            logger.info(f"--- {checkpoint} with {source} {'PASSED' if result.error is None else 'FAILED'} ---")
            results.append((f"{checkpoint} {source}", result))

    logger.info("checkpointMatrix results; " + timings_table(results))
    failed = [label for label, result in results if result.error is not None]
    assert not failed, f"{len(failed)}/{len(results)} combinations failed: {failed}"
