# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Shared helpers for the largeE2E scenario scripts.

Deliberately depends on nothing beyond the standard library and `httpx` -- these scripts are meant
to run via `uvx --with httpx python run_scenarios.py`, entirely independent of the backend's own
virtual environment, so they can be pointed at *any* already-running, already-configured backend
(a CI-managed one started via `scripts/start_backend.sh`, or a developer's own `just dev` instance).

Request bodies are plain dicts/JSON matching the wire contract of the relevant `forecastbox` routes
-- we never import `forecastbox`/`fiab_core` pydantic models here, see README.md for why.
"""

from __future__ import annotations

import io
import logging
import os
import re
import time
import zipfile
from collections.abc import Callable
from typing import Any, TypeVar

import httpx

LOGGER_NAME = "forecastbox.tests.runner"
logger = logging.getLogger(LOGGER_NAME)

T = TypeVar("T")

DEFAULT_BASE_URL = "http://localhost:8000/api/v1"
"""Matches BackendSettings.uvicorn_port's default (8000), used by both `scripts/fiab.sh run` and
`just dev`. Override with FIAB_E2E_BASE_URL to point at a differently configured instance."""


def configure_logging() -> None:
    """Configure logging with the same line format the backend itself uses (see
    `cascade.executor.config.logging_config`'s "default" formatter), just under our own logger
    name so runner log lines are easy to tell apart from the backend's own, should the two ever
    end up interleaved (e.g. when the backend was started with FIAB_LOGSTDOUT=yea).
    """
    logging.basicConfig(
        level=logging.INFO,
        style="{",
        format="{asctime}:{levelname}:{name}:{process}:{message}",
    )
    logging.getLogger(LOGGER_NAME).setLevel(logging.INFO)


def base_url() -> str:
    return os.environ.get("FIAB_E2E_BASE_URL", DEFAULT_BASE_URL)


def make_client(timeout: float = 30.0) -> httpx.Client:
    return httpx.Client(base_url=base_url(), follow_redirects=True, timeout=timeout)


def retry_until(
    do_action: Callable[[], Any],
    verify_ok: Callable[[Any], T | None],
    *,
    attempts: int = 20,
    sleep: float = 0.5,
    error_msg: str = "Max attempts exceeded",
) -> T:
    """Repeatedly call do_action() and pass the result to verify_ok().

    verify_ok should return None to indicate "not yet done", raise to signal an error, or return
    any truthy value to indicate success -- which is then returned by retry_until. Raises
    AssertionError after exhausting all attempts.
    """
    for _ in range(attempts):
        ok = None
        try:
            result = do_action()
            ok = verify_ok(result)
        except httpx.ReadTimeout:
            pass
        if ok is not None:
            return ok
        time.sleep(sleep)
    raise AssertionError(error_msg)


def wait_for_backend_ready(client: httpx.Client, attempts: int = 150, sleep: float = 2.0) -> dict:
    """Poll GET /status until the backend is reachable, plugins are loaded ("ok"), and the cascade
    gateway is reachable ("up").

    Deliberately does *not* install or fix anything -- an environment that never reaches this state
    signals that its own setup (fiab.sh / `just dev` / a developer's plugin install) is broken or
    still in progress, which scenarios should surface loudly rather than paper over.
    """

    def do_action() -> httpx.Response | httpx.HTTPError:
        try:
            return client.get("/status", timeout=5)
        except httpx.HTTPError as e:
            return e

    def verify_ok(response: httpx.Response | httpx.HTTPError) -> dict | None:
        if isinstance(response, httpx.HTTPError):
            return None
        if response.status_code != 200:
            return None
        data = response.json()
        return data if data.get("plugins") == "ok" and data.get("cascade") == "up" else None

    return retry_until(
        do_action,
        verify_ok,
        attempts=attempts,
        sleep=sleep,
        error_msg=f"backend at {client.base_url} did not become ready (status/plugins/cascade) in time",
    )


_PLUGIN_KEY_RE = re.compile(r"^store='(?P<store>[^']*)' local='(?P<local>[^']*)'$")


def find_plugin_id(client: httpx.Client, factory_id: str) -> dict[str, str]:
    """Return {"store": ..., "local": ...} for the single installed plugin exposing `factory_id`
    in its block catalogue. Raises AssertionError if zero or more than one plugin matches.

    We resolve the plugin id this way, rather than hardcoding a composite id (e.g.
    "ecmwf:ecmwf-base"), because the same plugin package can be installed under an arbitrary
    store/local pair -- a fresh `fiab.sh` install uses "ecmwf:ecmwf-base" by default, but a
    developer's own environment could have the same plugin installed as e.g. "localTest2:single".

    NOTE: GET /blueprint/catalogue returns a `dict[PluginCompositeId, ...]`; FastAPI/pydantic
    serialises that dict's keys using PluginCompositeId's default str()/repr representation
    (`"store='<store>' local='<local>'"`), not `PluginCompositeId.to_str()`. We depend on this
    internal detail only because we deliberately avoid importing `forecastbox`/`fiab_core` here
    (see module docstring) -- if it ever changes, this will fail loudly (the regex simply won't
    match), not silently.
    """
    response = client.get("/blueprint/catalogue", timeout=10)
    response.raise_for_status()
    catalogue: dict[str, Any] = response.json()

    matches: list[dict[str, str]] = []
    for key, entry in catalogue.items():
        if factory_id in entry.get("factories", {}):
            m = _PLUGIN_KEY_RE.match(key)
            if m is None:
                raise AssertionError(f"could not parse plugin composite id from catalogue key {key!r}")
            matches.append({"store": m.group("store"), "local": m.group("local")})

    if len(matches) != 1:
        raise AssertionError(f"expected exactly one installed plugin exposing factory {factory_id!r}, found {len(matches)}: {matches}")
    return matches[0]


def resolve_checkpoint(client: httpx.Client, checkpoint: str, *, attempts: int = 60, sleep: float = 2.0) -> str:
    """Return the "<store>:<local id>" checkpoint id for `checkpoint`.

    A checkpoint already given as "<store>:<local id>" is returned unchanged. A bare local id is
    looked up in GET /artifacts/list_models across all configured stores; when several stores have
    it, a store where it is already downloaded is preferred, then the first store in name order.
    """
    if ":" in checkpoint:
        return checkpoint

    def do_action() -> httpx.Response:
        return client.get("/artifacts/list_models", timeout=30)

    def verify_ok(response: httpx.Response) -> list[dict] | None:
        # an empty list means the catalog refresh kicked off at backend startup has not finished yet
        return (response.json() or None) if response.status_code == 200 else None

    models = retry_until(do_action, verify_ok, attempts=attempts, sleep=sleep, error_msg="the backend's artifact catalog stayed empty")
    matches = [m for m in models if m["composite_id"]["artifact_local_id"] == checkpoint]
    if not matches:
        known = sorted(f"{m['composite_id']['artifact_store_id']}:{m['composite_id']['artifact_local_id']}" for m in models)
        raise AssertionError(f"model {checkpoint!r} is in none of the configured artifact stores, known models: {known}")
    best = sorted(matches, key=lambda m: (not m["is_available"], m["composite_id"]["artifact_store_id"]))[0]
    resolved = f"{best['composite_id']['artifact_store_id']}:{checkpoint}"
    if len(matches) > 1:
        logger.info(f"model {checkpoint} is in stores {sorted(m['composite_id']['artifact_store_id'] for m in matches)}, using {resolved}")
    return resolved


def ensure_model_downloaded(client: httpx.Client, checkpoint: str, *, attempts: int = 600, sleep: float = 3.0) -> None:
    """POST /artifacts/download_model until the checkpoint ("<store>:<local id>") is available.

    Submitting the same download concurrently (from a scenario running more than once, or from
    another user/scenario) is safe: the backend tracks a single ongoing download per artifact and
    every caller just observes its progress.
    """
    store_id, local_id = checkpoint.split(":", 1)
    composite_id = {"artifact_store_id": store_id, "artifact_local_id": local_id}

    def do_action() -> httpx.Response:
        return client.post("/artifacts/download_model", json=composite_id, timeout=30)

    def verify_ok(response: httpx.Response) -> dict | None:
        if response.status_code != 200:
            if "not found" in response.text.casefold():
                raise AssertionError(f"model {checkpoint} is not in the backend's artifact catalog: {response.text}")
            # Transient: eg the artifact catalog refresh (kicked off at backend startup) hasn't
            # finished yet, or the artifact manager's lock is momentarily held. Keep retrying.
            logger.debug(f"download_model not ready yet: {response.status_code} {response.text}")
            return None
        data = response.json()
        if data["status"] == "available":
            return data
        logger.info(f"model {checkpoint} download in progress: {data}")
        return None

    retry_until(
        do_action,
        verify_ok,
        attempts=attempts,
        sleep=sleep,
        error_msg=f"model {checkpoint} did not become available in time",
    )


def create_and_submit_run(client: httpx.Client, builder: dict, display_name: str) -> tuple[str, int]:
    """Save `builder` as a blueprint, submit a run of it, and return (run_id, attempt_count)."""
    save_response = client.post("/blueprint/create", json={"builder": builder, "display_name": display_name}, timeout=30)
    save_response.raise_for_status()
    blueprint_id = save_response.json()["blueprint_id"]
    logger.info(f"saved blueprint {blueprint_id} ({display_name})")

    run_response = client.post("/run/create", json={"blueprint_id": blueprint_id}, timeout=30)
    run_response.raise_for_status()
    run_data = run_response.json()
    logger.info(f"submitted run {run_data['run_id']} (attempt {run_data['attempt_count']})")
    return run_data["run_id"], run_data["attempt_count"]


def ensure_run_completed(client: httpx.Client, run_id: str, *, attempts: int = 900, sleep: float = 2.0) -> dict:
    """Poll GET /run/get until the run completes, returning its detail. Raises AssertionError if it fails."""

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


_TASK_MARKER_RE = re.compile(r"task=(.*);action=(task_started|task_computed);at=(\d+)")


def run_phase_timings(client: httpx.Client, run_id: str, attempt_count: int, phases: dict[str, str]) -> dict[str, float | None]:
    """Return the wall time in seconds of each phase of a completed run, from its cascade task tracing markers.

    A phase is the set of tasks whose id contains the given substring (e.g. an entrypoint name). Its wall
    time spans from the first of these tasks starting to the last one computed, so tasks running in parallel
    on several workers are not double counted. A phase without any matching task maps to None.
    """
    response = client.get("/run/logs", params={"run_id": run_id, "attempt_count": attempt_count}, timeout=60)
    response.raise_for_status()
    events: dict[str, dict[str, int]] = {}
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        for name in archive.namelist():
            if not name.endswith(".logs.txt"):
                continue
            for line in archive.read(name).decode(errors="replace").splitlines():
                if match := _TASK_MARKER_RE.search(line):
                    events.setdefault(match.group(1), {})[match.group(2)] = int(match.group(3))

    timings: dict[str, float | None] = {}
    for phase, substring in phases.items():
        tasks = [e for task, e in events.items() if substring in task and "task_started" in e and "task_computed" in e]
        if not tasks:
            timings[phase] = None
            continue
        timings[phase] = (max(e["task_computed"] for e in tasks) - min(e["task_started"] for e in tasks)) / 1e9
    return timings


def stop_run_if_active(client: httpx.Client, run_id: str, attempt_count: int, *, attempts: int = 90, sleep: float = 2.0) -> None:
    """Stop a run that is still submitted, preparing or running, eg after waiting for it timed out, and wait until it is over.

    Cascade tears the job down in the background, and a run submitted meanwhile fails with an infrastructure error, so this
    returns only once the run is no longer active (or raises after `attempts` polls).
    """

    def status() -> str:
        response = client.get("/run/get", params={"run_id": run_id}, timeout=10)
        response.raise_for_status()
        return response.json()["status"]

    current = status()
    if current not in {"submitted", "preparing", "running", "stopping"}:
        return
    if current != "stopping":
        logger.info(f"stopping run {run_id} (status {current!r})")
        client.post("/run/stop", json={"run_id": run_id, "attempt_count": attempt_count}, timeout=30).raise_for_status()
    retry_until(
        status,
        lambda s: s if s not in {"submitted", "preparing", "running", "stopping"} else None,
        attempts=attempts,
        sleep=sleep,
        error_msg=f"run {run_id} did not stop in time",
    )
    logger.info(f"run {run_id} is over")


def format_seconds(value: float | None) -> str:
    """Format a duration in seconds, or `-` when unknown."""
    return "-" if value is None else f"{value:.0f}s"
