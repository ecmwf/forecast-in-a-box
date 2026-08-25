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

import logging
import os
import re
import time
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
        result = do_action()
        ok = verify_ok(result)
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
