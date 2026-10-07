# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Process-wide registry of long-lived, reusable `httpx` clients, one sync and one async client per `HttpProfile`.

Lifecycle:
- `start_http_pools()` builds all clients, and must be called on the event loop thread, once, at application
  start (see `forecastbox.entrypoint.initializers`).
- `get_sync` / `get_async` retrieve a client from the registry. Calling them while the registry is not
  started raises `HttpPoolsNotStarted`.
- `stop_http_pools()` removes the clients from the registry, and then closes them. Requests still in flight
  on a sync client at that time fail, which is the cancellation mechanism for long running downloads.

Thread safety:
- `httpx.Client` is thread safe, and `get_sync` may be called from any thread.
- `httpx.AsyncClient` must only be used from the event loop thread on which `start_http_pools` ran.
- the registry is replaced as a whole by start and stop, so readers never observe a partial state.

Callers must not close the retrieved clients, and must not enter them as context managers.
"""

import logging
from dataclasses import dataclass
from enum import StrEnum
from types import MappingProxyType
from typing import Mapping

import httpx

logger = logging.getLogger(__name__)


class HttpProfile(StrEnum):
    """Named client configurations. Each profile has its own connection pool."""

    Default = "default"
    """Short metadata calls (package indexes, catalogs, status probes) to external services."""
    Download = "download"
    """Large streamed bodies, such as artifact downloads."""
    Proxy = "proxy"
    """Transparent forwarding of requests to local services, such as lens instances."""


@dataclass(frozen=True, eq=True, slots=True)
class ProfileSettings:
    timeout: httpx.Timeout
    limits: httpx.Limits
    follow_redirects: bool


_PROFILES: Mapping[HttpProfile, ProfileSettings] = MappingProxyType(
    {
        HttpProfile.Default: ProfileSettings(
            timeout=httpx.Timeout(connect=10.0, read=30.0, write=30.0, pool=30.0),
            limits=httpx.Limits(max_connections=50, max_keepalive_connections=20),
            follow_redirects=True,
        ),
        HttpProfile.Download: ProfileSettings(
            timeout=httpx.Timeout(connect=10.0, read=60.0, write=60.0, pool=60.0),
            limits=httpx.Limits(max_connections=16, max_keepalive_connections=4),
            follow_redirects=True,
        ),
        HttpProfile.Proxy: ProfileSettings(
            timeout=httpx.Timeout(connect=5.0, read=120.0, write=120.0, pool=5.0),
            limits=httpx.Limits(max_connections=200, max_keepalive_connections=50),
            follow_redirects=False,
        ),
    }
)
assert set(_PROFILES) == set(HttpProfile), "every HttpProfile must have settings"


class HttpPoolsNotStarted(RuntimeError):
    """Raised when a client is requested while the pools are not started."""


class HttpPoolsAlreadyStarted(RuntimeError):
    """Raised when `start_http_pools` is called while the pools are already started."""


@dataclass(frozen=True, slots=True)
class _Registry:
    sync: Mapping[HttpProfile, httpx.Client]
    asynchronous: Mapping[HttpProfile, httpx.AsyncClient]


_registry: _Registry | None = None


def _current() -> _Registry:
    registry = _registry
    if registry is None:
        raise HttpPoolsNotStarted(
            "http pools are not started; they are initialized by the application lifespan, and must be mocked in tests"
        )
    return registry


def get_sync(profile: HttpProfile) -> httpx.Client:
    """Return the shared sync client of the given profile. Safe to call from any thread."""
    return _current().sync[profile]


def get_async(profile: HttpProfile) -> httpx.AsyncClient:
    """Return the shared async client of the given profile. Must only be used on the event loop thread."""
    return _current().asynchronous[profile]


def start_http_pools() -> None:
    """Build the clients of all profiles and publish them in the registry."""
    global _registry
    if _registry is not None:
        raise HttpPoolsAlreadyStarted("http pools are already started")
    sync: dict[HttpProfile, httpx.Client] = {}
    asynchronous: dict[HttpProfile, httpx.AsyncClient] = {}
    try:
        for profile, settings in _PROFILES.items():
            sync[profile] = httpx.Client(timeout=settings.timeout, limits=settings.limits, follow_redirects=settings.follow_redirects)
            asynchronous[profile] = httpx.AsyncClient(
                timeout=settings.timeout, limits=settings.limits, follow_redirects=settings.follow_redirects
            )
    except BaseException:
        # NOTE async clients that were never used hold no resources, so only the sync ones are closed
        for client in sync.values():
            client.close()
        raise
    _registry = _Registry(sync=MappingProxyType(sync), asynchronous=MappingProxyType(asynchronous))
    logger.debug(f"http pools started: {[p.value for p in _PROFILES]}")


async def stop_http_pools() -> None:
    """Unpublish and close all clients. Closes every client even if some fail to close, and then raises
    an `ExceptionGroup` with the failures, if any. A no-op if the pools are not started."""
    global _registry
    registry = _registry
    _registry = None
    if registry is None:
        return
    errors: list[Exception] = []
    for profile, sync_client in registry.sync.items():
        try:
            sync_client.close()
        except Exception as e:
            logger.exception(f"failed to close sync http client {profile.value!r}")
            errors.append(e)
    for profile, async_client in registry.asynchronous.items():
        try:
            await async_client.aclose()
        except Exception as e:
            logger.exception(f"failed to close async http client {profile.value!r}")
            errors.append(e)
    if errors:
        raise ExceptionGroup("failed to close some http clients", errors)
    logger.debug("http pools stopped")
