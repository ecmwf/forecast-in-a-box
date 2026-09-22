# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""modelForecast scenario.

Downloads the ECMWF AIFS o48 checkpoint (if not already locally available) and runs a short
forecast entirely from a "dummy" initial-conditions source -- so, beyond the one-off checkpoint
download, this needs no MARS/opendata credentials or network access for the actual inference. It
then selects a single surface parameter/step and writes the result to a zarr store.

Assumptions (see also README.md):
 - the backend is already running and reachable (see common.base_url()),
 - the fiab_plugin_ecmwf plugin is already installed, exposing the `anemoiSource`/`select`/
   `zarrSink` block factories under *some* plugin id (resolved dynamically, see
   common.find_plugin_id -- never hardcoded).

Does not assume it is the only thing running against the backend:
 - the artifact download is idempotent/progress-tracked by the backend itself (concurrent callers
   share the same download), so no client-side locking is needed here,
 - the zarr sink path is templated with the intrinsic ${runId}/${attemptCount} glyphs, so
   concurrent/repeated runs of this very scenario never collide with each other on disk.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone

import httpx
from common import find_plugin_id, retry_until, wait_for_backend_ready

logger = logging.getLogger("forecastbox.tests.runner")

CHECKPOINT = "ecmwf:aifs-global-o48"
ARTIFACT_STORE_ID, ARTIFACT_LOCAL_ID = CHECKPOINT.split(":", 1)

# The o48 checkpoint's timestep is 6h; lead_time must be a positive multiple of it.
LEAD_TIME_HOURS = 12
SELECTED_STEP = "6"


def _ensure_model_downloaded(client: httpx.Client) -> None:
    """POST /artifacts/download_model until the checkpoint is available.

    Submitting the same download concurrently (from this scenario running more than once, or from
    another user/scenario) is safe: the backend tracks a single ongoing download per artifact and
    every caller just observes its progress.
    """
    composite_id = {"artifact_store_id": ARTIFACT_STORE_ID, "artifact_local_id": ARTIFACT_LOCAL_ID}

    def do_action() -> httpx.Response:
        return client.post("/artifacts/download_model", json=composite_id, timeout=30)

    def verify_ok(response: httpx.Response) -> dict | None:
        if response.status_code != 200:
            # Transient: eg the artifact catalog refresh (kicked off at backend startup) hasn't
            # finished yet, or the artifact manager's lock is momentarily held. Keep retrying.
            logger.debug(f"download_model not ready yet: {response.status_code} {response.text}")
            return None
        data = response.json()
        if data["status"] == "available":
            return data
        logger.info(f"model download in progress: {data}")
        return None

    retry_until(
        do_action,
        verify_ok,
        attempts=600,
        sleep=3.0,
        error_msg=f"model {CHECKPOINT} did not become available in time",
    )


def _build_blueprint_builder(plugin: dict[str, str]) -> dict:
    """Build the BlueprintBuilder payload (list-of-blocks wire format) directly as a dict.

    Mirrors: anemoiSource -> select(param) -> select(step) -> select(levtype) -> zarrSink, i.e. the
    same shape as a hand-built blueprint in the UI, just with a "dummy" input source and a
    ${runId}/${attemptCount}-templated output path so this scenario is self-contained and
    concurrency-safe.
    """
    base_time = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0).strftime("%Y-%m-%dT%H:%M:%S")

    def block(instance_id: str, factory: str, configuration_values: dict[str, str], input_ids: dict[str, str]) -> dict:
        return {
            "instance_id": instance_id,
            "plugin": plugin,
            "factory": factory,
            "instance": {"configuration_values": configuration_values, "input_ids": input_ids},
        }

    return {
        "blocks": [
            block(
                "source",
                "anemoiSource",
                {
                    "checkpoint": CHECKPOINT,
                    "input_source": "dummy",
                    "lead_time": str(LEAD_TIME_HOURS),
                    "base_time": base_time,
                    "number": "1",
                },
                {},
            ),
            block("selectParam", "select", {"dimension": "param", "values": "2t"}, {"dataset": "source"}),
            block("selectStep", "select", {"dimension": "step", "values": SELECTED_STEP}, {"dataset": "selectParam"}),
            block("selectLevtype", "select", {"dimension": "levtype", "values": "sfc"}, {"dataset": "selectStep"}),
            block(
                "sink",
                "zarrSink",
                # Intrinsic glyphs, resolved by the backend at execution time -- unique per run/attempt.
                {"path": "/tmp/${runId}.${attemptCount}"},
                {"dataset": "selectLevtype"},
            ),
        ],
        "environment": None,
        "local_glyphs": {},
    }


def _ensure_run_completed(client: httpx.Client, run_id: str, *, attempts: int = 900, sleep: float = 2.0) -> dict:
    def do_action() -> httpx.Response:
        return client.get("/run/get", params={"run_id": run_id}, timeout=10)

    def verify_ok(response: httpx.Response) -> dict | None:
        response.raise_for_status()
        data = response.json()
        status = data["status"]
        if status == "failed":
            raise AssertionError(f"run {run_id} failed: {data.get('error')}")
        assert status in {"submitted", "preparing", "running", "completed"}, f"unexpected status {status!r}: {data}"
        return data if status == "completed" else None

    return retry_until(do_action, verify_ok, attempts=attempts, sleep=sleep, error_msg=f"run {run_id} did not complete in time")


def run(client: httpx.Client) -> None:
    wait_for_backend_ready(client)

    plugin = find_plugin_id(client, "anemoiSource")
    logger.info(f"resolved fiab_plugin_ecmwf as plugin id {plugin}")

    logger.info(f"ensuring model {CHECKPOINT} is downloaded (this can take a while on a cold cache)")
    _ensure_model_downloaded(client)

    builder = _build_blueprint_builder(plugin)
    save_response = client.post(
        "/blueprint/create",
        json={"builder": builder, "display_name": "largeE2E modelForecast"},
        timeout=30,
    )
    save_response.raise_for_status()
    blueprint_id = save_response.json()["blueprint_id"]
    logger.info(f"saved blueprint {blueprint_id}")

    run_response = client.post("/run/create", json={"blueprint_id": blueprint_id}, timeout=30)
    run_response.raise_for_status()
    run_data = run_response.json()
    run_id, attempt_count = run_data["run_id"], run_data["attempt_count"]
    logger.info(f"submitted run {run_id} (attempt {attempt_count})")

    _ensure_run_completed(client, run_id)

    # NOTE this assumes the runner and the backend share a filesystem (true for both `just dev`
    # and a `scripts/fiab.sh`-started backend on the same host, which is all this scenario supports).
    output_path = f"/tmp/{run_id}.{attempt_count}"
    assert os.path.exists(output_path), f"expected zarr output at {output_path!r}, not found"
    logger.info(f"modelForecast scenario completed successfully, output at {output_path}")
