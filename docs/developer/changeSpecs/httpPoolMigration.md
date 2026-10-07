# HTTP client pool migration

## Background

Previously, `httpx` clients were created ad hoc at each call site, mostly as `with httpx.Client() as c:` per call, plus a lazy module global in the lens proxy, and a blocking `requests.get` in `routes/status.py`.
This meant no connection reuse, scattered timeout/redirect settings, and no central place to close clients at shutdown.

`forecastbox.utility.http_pools` now provides a registry of long-lived clients, one sync and one async client per `HttpProfile`.
It is started in `entrypoint/initializers.py` as the `http_pools` step, after `execution_runtime` and before `broadcaster`.
Teardown therefore runs before the execution pools are joined: clients are closed first, which makes in-flight sync requests (such as long downloads running in worker threads) fail, and thus cancels them.

This document lists the remaining migration steps.
Each step is an independent PR.
Once all are done, this document is deleted, and `backend/development.md` is updated to mention `http_pools`.

## Rules of the registry

* `get_sync(profile)` returns an `httpx.Client` -- thread safe, usable from any thread, including pool workers.
* `get_async(profile)` returns an `httpx.AsyncClient` -- only usable on the event loop thread.
* Both raise `HttpPoolsNotStarted` if the app has not started the pools. There is no lazy init and no reset hook.
* Clients are owned by the registry: never `close()` them, never use them in `with` / `async with`.
* Profiles (see `HttpProfile`) are hardcoded in `http_pools.py` and expected to be tuned during the migration:
  * `Default` -- short metadata calls to external services, follows redirects.
  * `Download` -- large streamed bodies, follows redirects.
  * `Proxy` -- forwarding to local services, no redirect following, high connection limit.
* If no profile fits, add a new profile to `HttpProfile` and `_PROFILES` rather than passing per-call overrides for connection-level settings. Per-request `timeout=` overrides are fine.

## Migration order

1. **Lens proxy** (`domain/lens/proxy.py`).
   Replace the module global `_client`, `get_client` and `aclose_client` with `get_async(HttpProfile.Proxy)`.
   Remove the `lens_proxy_client` initializer and its `_stop_lens_proxy_client`.
   Remove `_TIMEOUT` (it is now the `Proxy` profile).
2. **Admin** (`domain/admin/__init__.py`, two `async with httpx.AsyncClient()`).
   Use `get_async(HttpProfile.Default)`.
3. **Status route** (`routes/status.py`).
   Replace blocking `requests.get` with `await get_async(HttpProfile.Default).get(..., timeout=5)`.
   Adapt exception handling from `requests` to `httpx` exceptions.
4. **Plugin versions route** (`routes/plugins.py::_source2Versions`).
   The function runs in a thread, so use `get_sync(HttpProfile.Default)`. Remove the `TODO pool those?`.
5. **Plugin stores** (`domain/plugin/store.py::initialize_stores`).
   Use `get_sync(HttpProfile.Default)` and drop the `with`.
6. **Artifact catalog** (`domain/artifact/catalog.py::get_artifacts_catalog`).
   Use `get_sync(HttpProfile.Default)` and drop the `with`.
7. **Artifact download** (`domain/artifact/io.py`).
   Use `get_sync(HttpProfile.Download)` and drop the `with` and the explicit `timeout=300.0`.
   Streaming (`client.stream`) is still used as a context manager, as that is per-response and not per-client.
   Handle the exception raised when the client is closed during shutdown as a cancellation: log it, and clean up the temp file (the existing error path likely already does so -- verify).
8. **OIDC** (`domain/auth/oidc.py`).
   `httpx_oauth` creates its own clients internally. Check the `get_httpx_client` hook of `OpenID`, and supply a factory that returns the shared async client -- but only if the library does not close the returned client on exit (otherwise leave as is, and note it here).
9. **Bootstrap checks** (`entrypoint/bootstrap/checks.py`).
   These run in a separate thread/process-phase parallel to the backend, possibly before it is up, so they must not use the registry. Leave them as they are (short lived local `httpx.Client`).
   Only unify their settings if desired; no registry usage.
10. **Cleanup**.
    Remove `requests` from the dependencies if no usage remains (`grep -rn "import requests"`).
    Delete this document, and document `http_pools` in `backend/development.md`.

Steps 1-8 are independent of one another and can be done in any order.

## How to migrate a call site

1. Determine the execution context of the code:
   * runs on the event loop (an `async def` route or domain function) -- use `get_async`.
   * runs in a worker thread (submitted via `execution_manager`, or inside a thread pool task) -- use `get_sync`.
   * runs on a thread outside the backend (bootstrap) -- do not migrate.
   Never call `get_async` from a thread, and never block the loop with a sync client.
2. Pick the profile by workload: metadata call -- `Default`; large or streamed body -- `Download`; forwarding to a local service -- `Proxy`. Add a new profile if none fits.
3. Replace the `with httpx.Client(...) as client:` / `async with httpx.AsyncClient(...) as client:` with `client = get_sync(HttpProfile.X)` (or `get_async`), and dedent the body. Remove constructor arguments such as `follow_redirects` and `timeout`, which now come from the profile.
4. Call `get_*` at the time of the request, not at import time and not cached in a module global or class attribute. The registry is empty until the application lifespan runs.
5. Helper functions which currently take a `client` argument (`fetch_content`, `get_package_versions`, `get_all_repo_tags`) keep their signature. Only the caller changes.
6. Do not create new `httpx.Client` / `httpx.AsyncClient` instances anywhere in the backend outside `http_pools.py`, aside from the bootstrap checks.

## Testing

* Unit tests that exercise a migrated code path must mock the registry, for example by patching `get_sync` / `get_async` in the module under test (`monkeypatch.setattr("forecastbox.domain.x.get_sync", lambda profile: fake_client)`), with a fake or `httpx.MockTransport`-backed client. An unmocked call raises `HttpPoolsNotStarted`, which is intended.
* Unit tests must not start or stop the registry (`start_http_pools` / `stop_http_pools`), as it is global state.
* Integration tests need nothing extra: the single backend instance started for the suite has the registry started by its lifespan.
* Mock the module-level name imported into the module under test, not `forecastbox.utility.http_pools.get_sync`, if the module uses `from ... import get_sync`.

## Known limitations and open points

* Closing a sync client from the event loop thread does not guarantee that a thread blocked in a socket read is woken immediately. It will fail at the latest at the read timeout of the profile (60 seconds for `Download`). If prompt cancellation is needed, add a cooperative cancel flag checked between chunks in the download loop.
* Profile settings are hardcoded, and are to be tuned during the migration.
* The pools use httpx defaults for TLS and `trust_env` (proxy environment variables are respected).
