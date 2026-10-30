# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""sourceMatrix scenario.

Runs the demo checkpoints (the `demo` preset of case_checkpointMatrix) against every input source the
anemoiSource block offers, to find out which sources work. Each (input source, checkpoint) combination
is a separate anemoiSource -> gribSink run, checked like in case_checkpointMatrix but without plots,
as the input source has no bearing on plotting. All combinations are attempted, each for at most
RUN_ATTEMPTS polls (a run still active then is stopped), and the results are summarised with their
timings per run phase; the scenario fails at the end if any combination failed.

Opt-in: nothing runs unless FIAB_E2E_SOURCES is set, since several sources need credentials (polytope,
mars) or network access. The variable is either `all`, for every input source listed in the
anemoiSource block's input_source option, or a `,`-separated list of input sources.

Input data caching: the scenario is meant to run against a backend whose earthkit-data cache policy is
`user` (EARTHKIT_DATA_CACHE_POLICY=user in the backend environment), so that downloaded input data is
reused rather than fetched again. To make the most of it:
 - every combination uses the same base time, so identical requests hit the cache, across checkpoints
   and across repeated runs of the scenario on the same day,
 - combinations are ordered by input source, so the checkpoints fetching from the same source run back
   to back,
 - the growth of the earthkit-data cache directory (FIAB_E2E_EARTHKIT_CACHE_DIR, by default
   /tmp/earthkit-data-$USER) is logged per combination, with a warning when it never grows, as that
   means the backend is not caching.

Assumptions as in case_checkpointMatrix, in particular the runner and the backend share a filesystem.
"""

from __future__ import annotations

import getpass
import logging
import os
import re
import time
from dataclasses import replace
from pathlib import Path

import httpx
from case_checkpointMatrix import MODELS, PRESETS, CombinationResult, default_base_time, run_combination, timings_table
from common import ensure_model_downloaded, find_plugin_id, resolve_checkpoint, wait_for_backend_ready

logger = logging.getLogger("forecastbox.tests.runner")

SOURCES_ENV = "FIAB_E2E_SOURCES"
CACHE_DIR_ENV = "FIAB_E2E_EARTHKIT_CACHE_DIR"
CHECKPOINTS = PRESETS["demo"]
# polls of 2s, ie up to 20 minutes per run: a source that cannot deliver (eg mars without a MARS client) can hang
# instead of failing, and is then stopped
RUN_ATTEMPTS = 600

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
    available = available_sources(client, plugin)
    if raw == "all":
        return available
    requested = [s.strip() for s in raw.split(",") if s.strip()]
    unknown = [s for s in requested if s not in available]
    if unknown:
        logger.warning(f"{SOURCES_ENV} lists sources the block does not offer, trying them anyway: {unknown}; offered: {available}")
    return requested


def _cache_dir() -> Path:
    return Path(os.environ.get(CACHE_DIR_ENV, f"/tmp/earthkit-data-{getpass.getuser()}"))


def _cache_size(path: Path) -> int:
    """Total size in bytes of the files in the earthkit-data cache directory, 0 if it does not exist."""
    if not path.is_dir():
        return 0
    return sum(f.stat().st_size for f in path.iterdir() if f.is_file())


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
    cache_start = _cache_size(cache_dir)
    logger.info(f"base time {base_time:%Y-%m-%dT%H:%MZ} for all runs; earthkit-data cache {cache_dir}: {cache_start / 1e6:.0f} MB")

    results: list[tuple[str, str, CombinationResult, int]] = []
    for source in sources:
        for requested in CHECKPOINTS:
            if requested in unavailable:
                results.append((source, requested, CombinationResult(error=unavailable[requested]), 0))
                continue
            checkpoint = checkpoints[requested]
            model = replace(MODELS[requested], sources=[source], plot=False, run_attempts=RUN_ATTEMPTS)
            logger.info(f"--- {source} with {checkpoint} ---")
            size_before = _cache_size(cache_dir)
            result = run_combination(client, plugin, checkpoint, source, model, base_time, "sourceMatrix")
            growth = _cache_size(cache_dir) - size_before
            logger.info(
                f"--- {source} with {checkpoint} {'PASSED' if result.error is None else 'FAILED'}, earthkit-data cache grew by {growth / 1e6:.0f} MB ---"
            )
            results.append((source, requested, result, growth))

    cache_growth = _cache_size(cache_dir) - cache_start
    if cache_growth == 0 and any(result.error is None for _, _, result, _ in results):
        logger.warning(
            f"the earthkit-data cache {cache_dir} did not grow although runs succeeded: the backend is probably not caching "
            "input data, set EARTHKIT_DATA_CACHE_POLICY=user in its environment (or point "
            f"{CACHE_DIR_ENV} at its cache directory)"
        )

    rows = [(f"{source} {requested}", result) for source, requested, result, _ in results]
    cache = [f"{growth / 1e6:.0f}MB" for _, _, _, growth in results]
    logger.info("sourceMatrix results (plots are not run); " + timings_table(rows, extra={"cache": cache}))
    logger.info(f"earthkit-data cache {cache_dir} grew by {cache_growth / 1e6:.0f} MB over the scenario")

    failed = [(s, c) for s, c, result, _ in results if result.error is not None]
    assert not failed, f"{len(failed)}/{len(results)} combinations failed: {failed}"
