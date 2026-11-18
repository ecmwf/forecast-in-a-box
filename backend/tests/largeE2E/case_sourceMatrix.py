# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""sourceMatrix scenario.

Runs the demo checkpoints (the `demo` preset of case_checkpointMatrix) against the input sources in
SOURCES, to find out which sources work. Each (input source, checkpoint) combination
is a separate anemoiSource -> gribSink run, checked like in case_checkpointMatrix but without plots,
as the input source has no bearing on plotting. All combinations are attempted, each for at most
RUN_ATTEMPTS polls (a run still active then is stopped), and the results are summarised with their
timings per run phase; the scenario fails at the end if any combination failed.

Opt-in: nothing runs unless FIAB_E2E_SOURCES is set, since several sources need credentials (polytope)
or network access. The variable is either `all`, for every input source in SOURCES, or a `,`-separated
list of input sources. SOURCES leaves out `mars`, which needs a MARS client on the backend host, the
AWS open data mirror, which is too slow to be useful, and `dummy`, which does not run with
anemoi-inference>=0.13. A warning is logged when SOURCES and the input sources offered by the
anemoiSource block differ.

Input data caching: the input fetch times measure the sources only when the input data is actually
downloaded, so the scenario is meant to run against a backend that does not cache input data (the
earthkit-data cache policy `off`, its default, eg EARTHKIT_DATA_CACHE_POLICY=off in the backend
environment). Every combination uses the same base time. The use of the earthkit-data cache
(FIAB_E2E_EARTHKIT_CACHE_DIR, by default /tmp/earthkit-data-$USER) is logged per combination, as the
size of the data added to it and the number of cache hits, read from its index, and a warning is
logged when runs hit it, as their input fetch times then do not reflect the source. The log ends with
the sources ranked by their mean input fetch time, slowest first.

Assumptions as in case_checkpointMatrix, in particular the runner and the backend share a filesystem.
"""

from __future__ import annotations

import getpass
import logging
import os
import re
import sqlite3
from dataclasses import replace
from pathlib import Path

import httpx
from case_checkpointMatrix import MODELS, PRESETS, CombinationResult, default_base_time, run_combination, timings_table
from common import ensure_model_downloaded, find_plugin_id, format_seconds, resolve_checkpoint, wait_for_backend_ready

logger = logging.getLogger("forecastbox.tests.runner")

SOURCES_ENV = "FIAB_E2E_SOURCES"
CACHE_DIR_ENV = "FIAB_E2E_EARTHKIT_CACHE_DIR"
CHECKPOINTS = PRESETS["demo"]
# The input sources run against, in this order. Left out:
#  - `mars`, which needs a MARS client on the backend host,
#  - the `opendata:aws` mirror, from which downloads crawled at a few kB/s (a 36 MB file was at 1 MB after 4 minutes),
#  - `dummy`: its input state has all latitudes and longitudes at 0, which anemoi-inference>=0.13 rejects against the
#    checkpoint coordinates, and nested checkpoints fail as their per-region input options do not apply to it
SOURCES = [
    "opendata:ecmwf:lowres",
    "opendata:ecmwf:highres",
    "opendata:google:lowres",
    "opendata:google:highres",
    "polytope:mars",
    "polytope:test",
]
# polls of 2s, ie up to 45 minutes per run, as fetching high resolution data from some sources takes over 15 minutes:
# a source that cannot deliver (eg mars without a MARS client) can hang instead of failing, and is then stopped
RUN_ATTEMPTS = 1350

_ENUM_VALUE_RE = re.compile(r"'([^']*)'")


def available_sources(client: httpx.Client, plugin: dict[str, str]) -> list[str]:
    """Return the input sources listed in the anemoiSource block's input_source option.

    The option's value_type is an enum rendered as `enumOpen[str]('mars','dummy',...)`.
    """
    response = client.get("/blueprint/catalogue", timeout=10)
    response.raise_for_status()
    for key, entry in response.json().items():
        if f"store='{plugin['store']}'" in key and f"local='{plugin['local']}'" in key:
            value_type = entry["factories"]["anemoiSource"]["configuration_options"]["input_source"]["value_type"]
            sources = _ENUM_VALUE_RE.findall(value_type)
            assert sources, f"could not parse the input sources from {value_type!r}"
            return sources
    raise AssertionError(f"plugin {plugin} not found in the catalogue")


def selected_sources(client: httpx.Client, plugin: dict[str, str]) -> list[str]:
    """Parse FIAB_E2E_SOURCES into the input sources to run, see the module docstring."""
    raw = os.environ.get(SOURCES_ENV, "").strip()
    sources = SOURCES if raw == "all" else [s.strip() for s in raw.split(",") if s.strip()]
    offered = available_sources(client, plugin)
    if not_offered := [s for s in sources if s not in offered]:
        logger.warning(f"sources not offered by the anemoiSource block, trying them anyway: {not_offered}")
    if not_listed := [s for s in offered if s not in SOURCES]:
        logger.info(f"sources offered by the anemoiSource block but not in SOURCES: {not_listed}")
    return sources


def _cache_dir() -> Path:
    return Path(os.environ.get(CACHE_DIR_ENV, f"/tmp/earthkit-data-{getpass.getuser()}"))


def _cache_state(path: Path) -> tuple[int, int, int]:
    """Return the total size in bytes, number of entries and number of accesses recorded in the earthkit-data cache index.

    An entry is accessed once when created and once per cache hit. All zero when the cache directory or index does not exist.
    """
    size = entries = accesses = 0
    for index in path.glob("cache-*.db") if path.is_dir() else []:
        with sqlite3.connect(f"file:{index}?mode=ro", uri=True) as db:
            count, total_size, total_accesses = db.execute("SELECT COUNT(*), SUM(size), SUM(accesses) FROM cache").fetchone()
        entries, size, accesses = entries + count, size + (total_size or 0), accesses + (total_accesses or 0)
    return size, entries, accesses


def _mean(values: list[float | None]) -> float | None:
    known = [v for v in values if v is not None]
    return sum(known) / len(known) if known else None


def _source_ranking(sources: list[str], results: list[tuple[str, str, CombinationResult, int, int]]) -> str:
    """Rank the sources by the mean input fetch time of their successful runs, slowest first.

    Each line also gives the mean total run time and the use of the earthkit-data cache, as data served from the
    cache is fetched faster; sources without a successful run are listed last.
    """
    timed, failed = [], []
    for source in sources:
        runs = [(result, added, hits) for s, _, result, added, hits in results if s == source]
        ok = [(result, added, hits) for result, added, hits in runs if result.error is None]
        if not ok:
            failed.append(f"  {source}: no successful run ({len(runs)} failed)")
            continue
        input_time = _mean([result.timings.get("input") for result, _, _ in ok])
        total_time = _mean([result.timings.get("total") for result, _, _ in ok])
        added, hits = sum(a for _, a, _ in ok), sum(h for _, _, h in ok)
        timed.append((input_time if input_time is not None else -1.0, source, total_time, len(ok), len(runs), added, hits))
    width = max(len(source) for source in sources)
    lines = [
        f"  {source:<{width}}  input {format_seconds(None if input_time < 0 else input_time):>6}  total {format_seconds(total_time):>6}"
        f"  ({successes}/{count} runs ok; cache: {added / 1e6:.0f} MB added, {hits} hits)"
        for input_time, source, total_time, successes, count, added, hits in sorted(timed, reverse=True)
    ]
    return "sources by mean input fetch time over their successful runs, slowest first:\n" + "\n".join(lines + failed)


def run(client: httpx.Client) -> None:
    if not os.environ.get(SOURCES_ENV, "").strip():
        logger.info(f"{SOURCES_ENV} not set, skipping (see the module docstring); checkpoints: {CHECKPOINTS}")
        return

    wait_for_backend_ready(client)
    plugin = find_plugin_id(client, "anemoiSource")
    sources = selected_sources(client, plugin)
    logger.info(f"input sources: {sources}; checkpoints: {CHECKPOINTS}")

    checkpoints: dict[str, str] = {}
    unavailable: dict[str, str] = {}
    for requested in CHECKPOINTS:
        try:
            checkpoint = resolve_checkpoint(client, requested)
            ensure_model_downloaded(client, checkpoint)
            checkpoints[requested] = checkpoint
        except Exception as e:
            unavailable[requested] = f"model not available: {e}"

    base_time = default_base_time()
    cache_dir = _cache_dir()
    cache_start = _cache_state(cache_dir)
    logger.info(
        f"base time {base_time:%Y-%m-%dT%H:%MZ} for all runs; earthkit-data cache {cache_dir}: "
        f"{cache_start[0] / 1e6:.0f} MB in {cache_start[1]} entries"
    )

    # per result: the size in bytes of the data added to the cache, and the number of cache hits
    results: list[tuple[str, str, CombinationResult, int, int]] = []
    for source in sources:
        for requested in CHECKPOINTS:
            if requested in unavailable:
                results.append((source, requested, CombinationResult(error=unavailable[requested]), 0, 0))
                continue
            checkpoint = checkpoints[requested]
            model = replace(MODELS[requested], sources=[source], plot=False, run_attempts=RUN_ATTEMPTS)
            logger.info(f"--- {source} with {checkpoint} ---")
            size, entries, accesses = _cache_state(cache_dir)
            result = run_combination(client, plugin, checkpoint, source, model, base_time, "sourceMatrix")
            new_size, new_entries, new_accesses = _cache_state(cache_dir)
            added, hits = new_size - size, (new_accesses - accesses) - (new_entries - entries)
            logger.info(
                f"--- {source} with {checkpoint} {'PASSED' if result.error is None else 'FAILED'}, earthkit-data cache: "
                f"{added / 1e6:.0f} MB added, {hits} hits ---"
            )
            results.append((source, requested, result, added, hits))

    cache_end = _cache_state(cache_dir)
    if cached := [f"{source} {requested}" for source, requested, _, _, hits in results if hits > 0]:
        logger.warning(
            f"runs read input data from the earthkit-data cache {cache_dir}, so their input fetch times do not reflect the source: "
            f"{cached}; run the backend with EARTHKIT_DATA_CACHE_POLICY=off to measure the sources"
        )

    rows = [(f"{source} {requested}", result) for source, requested, result, _, _ in results]
    added = [f"{size / 1e6:.0f}MB" for _, _, _, size, _ in results]
    hits = [str(count) for _, _, _, _, count in results]
    logger.info("sourceMatrix results (plots are not run); " + timings_table(rows, extra={"cache added": added, "cache hits": hits}))
    logger.info(
        f"earthkit-data cache {cache_dir}: {(cache_end[0] - cache_start[0]) / 1e6:.0f} MB added, "
        f"{(cache_end[2] - cache_start[2]) - (cache_end[1] - cache_start[1])} hits over the scenario"
    )
    logger.info(_source_ranking(sources, results))

    failed = [(s, c) for s, c, result, _, _ in results if result.error is not None]
    assert not failed, f"{len(failed)}/{len(results)} combinations failed: {failed}"
