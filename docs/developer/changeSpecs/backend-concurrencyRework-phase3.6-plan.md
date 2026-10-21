# Backend concurrency rework: Phase 3.6 implementation plan

## Purpose and scope

Make every HTTP route either an `async def` that never blocks the event loop
for more than a short in-memory critical section, or an `async def` that
explicitly submits its blocking section to a named execution-manager pool.
After this phase no route relies on FastAPI/AnyIO's implicit threadpool
(synchronous `def` routes), and no async route performs a blocking network
call, subprocess call, or process wait directly on the event loop.

The phase covers two groups:

- **A. Synchronous `def` routes** (currently executed by AnyIO's implicit
  worker pool): in `routes/artifacts.py`, `routes/blueprint.py`,
  `routes/lens.py`.
- **B. `async def` routes that call blocking functions on the loop**: in
  `routes/status.py`, `routes/gateway.py`, `routes/run.py` (including the
  gateway polling in `domain/run/service.py::poll_and_update`), and
  `routes/plugins.py`.

Domain ownership does not change: lens subprocess registration, status, stop,
ports, and application-shutdown cleanup stay in `domain/lens/manager.py`;
gateway process ownership stays in `domain/gateway/service.py`. Only the
submitted blocking sections become managed pool tasks.

Out of scope: the scheduler restart route
(`routes/experiment.py::restart_scheduler`, which joins the scheduler thread)
belongs to Phase 4; the status response restructuring belongs to Phase 8.

### Original design references

Look at these original files only if you encounter an unexpected situation.
This plan is self-contained and implementation should not normally require
reading them.

- [`backend-concurrencyRework-design.md`](backend-concurrencyRework-design.md)
- [`backend-concurrencyRework-migration.md`](backend-concurrencyRework-migration.md) (section "3.6 Blocking synchronous routes")
- [`backend-concurrencyRework-phase3.1-plan.md`](backend-concurrencyRework-phase3.1-plan.md)
- [`backend-concurrencyRework-phase3.5-plan.md`](backend-concurrencyRework-phase3.5-plan.md)

## Delivered baseline you can rely on

- `await execution_manager.awaitable_submit(pool, TaskName("..."), partial(fn, ...))`
  runs a synchronous callable on a named pool and re-raises its exceptions in
  the awaiting coroutine. `SubmissionRejected` becomes a 503 through
  `utility/fastapi.py`. Jobs-DB helpers keep using
  `execution_manager.await_jobs_db(...)`; do not route DB work through the
  pools below.
- Pools and their intended use:
  - `ConcurrentPools.Io` (4 workers, 64 pending): network and remote probes,
    gateway (ZMQ) requests, HTTP to PyPI, disk/SSH I/O that is not artifact
    download;
  - `ConcurrentPools.General` (2 workers, 32 pending): short blocking setup
    such as subprocess/process start and stop, archive creation.
- Phase 3.1: artifact downloads/refresh run on `ArtifactIo`; the artifact
  state lock is only held for short in-memory swaps.
- Phase 3.5: `/run/logs` is already migrated (`domain/run/logs.py`).
- Phase 3.2/3.3: plugin state lock (`PluginManager.lock`) is only held for
  short in-memory swaps.
- Unit tests use an inline `awaitable_submit` fake (`tests/unit/conftest.py`)
  that runs the task synchronously, so existing route/service tests that patch
  `client.request_response` and similar keep working.

### Rule for "direct call is fine"

A route may call a domain function directly on the loop when that function
only reads immutable `pyrsistent` snapshots, or takes a domain lock whose
holders never perform I/O (bounded `timed_acquire` with the existing ~1 s
timeout as a safety net), and does no network/disk/subprocess work. Everything
else is submitted. Apply this rule to any route not listed below that you
notice while implementing.

## Inventory and decisions

### A. Synchronous routes

| Route | Blocking work | Decision |
| --- | --- | --- |
| `GET /artifacts/list_models` | short artifact lock, in-memory | `async def`, direct call |
| `POST /artifacts/model_details` | short artifact lock, in-memory | `async def`, direct call |
| `POST /artifacts/download_model` | short lock + non-blocking `submit_monitored` | `async def`, direct call |
| `POST /artifacts/delete_model` | file unlink or `ssh rm` | `async def`, `Io`, `TaskName("artifact.delete")` |
| `GET /blueprint/catalogue` | short plugin lock, in-memory | `async def`, direct call |
| `GET /blueprint/glyphs/functions` | in-memory | `async def`, direct call |
| `POST /lens/start/skinnyWMS` | path stat, port claim, `subprocess.Popen` | `async def`, `General`, `TaskName("lens.start")` |
| `DELETE /lens/stop` | `shutdown_popen` (up to ~9 s of waits) | `async def`, `General`, `TaskName("lens.stop")` |
| `GET /lens/status` | lock-free read + localhost `connect_ex` (0.1 s timeout) | `async def`, direct call |
| `GET /lens/list` | same, per instance | `async def`, direct call |
| `GET /lens/supported` | in-memory | `async def`, direct call |

Artifact deletion goes to `Io`, not `ArtifactIo`: on the one-worker
`ArtifactIo` pool it would queue behind downloads that may take an hour, and
it already runs concurrently with downloads today (on AnyIO's threadpool), so
`Io` does not widen its concurrency. The lens status probes are kept inline
because they only connect to `127.0.0.1` (refused/accepted immediately) and
the lens proxy already performs the same probe inline on every proxied
request; see open question 3.

### B. Async routes with blocking calls

| Route / function | Blocking work | Decision |
| --- | --- | --- |
| `GET /status` | `client.request_response(JobProgressRequest)` (ZMQ, 1 s timeout) | probe on `Io`, `TaskName("status.probe.cascade")` |
| `POST /gateway/start` | `launch_gateway()` (process spawn or SSH tunnel setup) | `General`, `TaskName("gateway.start")` |
| `GET /gateway/status` | `status_gateway()` (ZMQ probe, possibly `ssh -O check`) | `Io`, `TaskName("gateway.status")` |
| `POST /run/delete` | `delete_cascade_datasets()` (ZMQ) | `Io`, `TaskName("run.delete.datasets")` |
| `GET /run/outputContent` | `ResultRetrievalRequest` (ZMQ, payload) + decode | `Io`, `TaskName("run.output.retrieve")` |
| `GET /run/get`, `GET /run/list` via `service.poll_and_update` | `JobProgressRequest`, textual `ResultRetrievalRequest`s, `get_current_cascade_proc()` (may run `ssh -O check`) | `Io`, task names below |
| `GET /plugin/versions` | `_source2Versions` (sync HTTP to PyPI) | `Io`, `TaskName("plugin.versions")` |

`/status` already uses the async HTTP client for the ECMWF probe, which is
fine; only the cascade probe is blocking.

## Implementation steps

### 1. Artifacts routes (`routes/artifacts.py`)

1. Convert all four routes to `async def`. Keep the existing exception
   mapping (`TimeoutError` -> 503, `KeyError` -> 404, `Either.error` -> 400).
2. `delete_model_endpoint`:

   ```python
   result = await execution_manager.awaitable_submit(
       ConcurrentPools.Io, TaskName("artifact.delete"), partial(delete_model, composite_id)
   )
   ```

   `delete_model` itself is unchanged.
3. `download_model_endpoint`: after Phase 3.1, `submit_artifact_download` may
   raise `SubmissionRejected`; it is left to the common 503 handler.

### 2. Blueprint routes (`routes/blueprint.py`)

Change `get_catalogue` and `list_glyph_functions` to `async def`; no other
changes.

### 3. Lens routes and manager

`routes/lens.py`:

1. `start_skinny_wms_endpoint` -> `async def`. Keep the `is_skinny_available`
   check inline; move the `pathlib.Path(local_path).exists()` check plus
   `start_skinny_wms(local_path)` into one small module-level sync helper
   that raises a new `LensPathNotFound` (add to `domain/lens/exceptions.py`)
   for a missing path, mapped by the route to the existing 400, and submit it
   to `General` as `lens.start`. Keep the existing `NoFreePortsException` and
   `TimeoutError` mappings.
2. `stop_lens` -> `async def`, submit `partial(stop_instance, lens_instance_id)`
   to `General` as `lens.stop`.
3. `get_lens_status`, `list_lenses`, `list_supported_lenses` -> `async def`,
   direct calls.

`domain/lens/manager.py` (small correctness fixes exposed by this work):

1. `stop_instance` raises `KeyError(instance_id)` for an unknown instance, but
   the route only catches `NoLensFound`, so stopping an unknown lens currently
   yields a 500. Raise `NoLensFound(instance_id)` instead, update the
   docstring, and update `shutdown_all_lens_instances` to catch `NoLensFound`.
2. `start_skinny_wms`: when `subprocess.Popen` itself fails, `process` is
   unbound, and the subsequent lock-timeout / instance-removed branches call
   `shutdown_popen(process)` -> `NameError`. Initialise
   `process: subprocess.Popen[bytes] | None = None` before the `try`, and only
   call `shutdown_popen` when it is not `None`. Also remove the instance from
   `LensInstanceManager.instances` in the `failed is not None` branch (today a
   failed start leaves a `process=None` entry that reports `starting`
   forever).

### 4. Status route (`routes/status.py`)

1. Extract the cascade probe into a module-level sync helper
   `_probe_cascade() -> str` returning `"up"`/`"down"` (same request, same
   1000 ms timeout, same warning log on failure).
2. `status["cascade"] = await execution_manager.awaitable_submit(ConcurrentPools.Io, TaskName("status.probe.cascade"), _probe_cascade)`.
   If the submission itself is rejected, report `"down"` rather than failing
   the whole status endpoint (the status route must stay usable when pools are
   saturated -- catch `SubmissionRejected` locally, log at warning).
3. Leave the response shape, the scheduler/plugins fields, and the ECMWF probe
   unchanged (Phase 8 owns the status DTO).

### 5. Gateway routes (`routes/gateway.py`)

1. `/start`: `await execution_manager.awaitable_submit(ConcurrentPools.General, TaskName("gateway.start"), launch_gateway)`;
   keep `GatewayAlreadyRunning` -> 400.
2. `/status`: submit `status_gateway` to `Io` as `gateway.status`; keep the
   existing exception-to-string mapping.
3. `/kill` is already non-blocking (it enqueues `gateway.stop` on `General`).

### 6. Run routes and polling

`domain/run/cascade.py` already holds the gateway interactions of the run
domain (`execute_cascade`, `delete_cascade_datasets`). Add one more
synchronous helper there:

```python
def retrieve_output_bytes(cascade_job_id: str, dataset: DatasetId) -> bytes:
    """Blocking gateway retrieval + decode; raises RunOutputRetrievalFailed(message)."""
```

containing the current `/outputContent` gateway request, `response.error`
check, `api.decoded_result`, and the `bytes` type check, each failure raising
a new `RunOutputRetrievalFailed` (add to `domain/run/exceptions.py`) with the
same message texts the route uses today.

`routes/run.py`:

1. `/delete`: `await execution_manager.awaitable_submit(ConcurrentPools.Io, TaskName("run.delete.datasets"), partial(delete_cascade_datasets, run_record.cascade_job_id))`,
   keeping the existing `except Exception -> 500`.
2. `/outputContent`: keep the cached-value fast path and the mime lookup
   inline; replace the gateway section with an `Io` submission of
   `retrieve_output_bytes` (`run.output.retrieve`), mapping
   `RunOutputRetrievalFailed` to 500 with its message. Remove now unused
   imports (`api`, `client`, `JobId` if unused).

`domain/run/service.py::_poll_and_update_once`: keep the control flow and all
`await_jobs_db` writes as they are, but move the three blocking calls into
small module-level sync helpers awaited on `Io`:

- `_current_cascade_proc_or_none() -> int | str | None` wrapping
  `get_current_cascade_proc()` and its `GatewayExited`/`GatewayNotStarted`
  handling (`TaskName("run.poll.cascade-proc")`);
- `_request_job_progress(job_id, detailed_report) -> api.JobProgressResponse`
  (`TaskName("run.poll.progress")`), raising exactly what
  `client.request_response` raises so the existing `TimeoutError` /
  `Exception` branches stay in the coroutine;
- `_fetch_textual_values(job_id, candidates: dict[TaskId, str]) -> dict[TaskId, str]`
  where `candidates` maps newly available textual task ids to their mime type;
  it performs the per-task `ResultRetrievalRequest`s and decoding with the
  current per-task error handling and logging, and returns decoded values
  (`TaskName("run.poll.textual-outputs")`). The coroutine then assigns them
  into `outputs_model` and sets `updated_outputs` as today. Submit it only
  when `candidates` is non-empty.

This keeps one `Io` round trip per gateway interaction and leaves the
compare-and-swap logic untouched. `/run/list` therefore issues its per-run
polls sequentially through `Io`, as it did inline before.

### 7. Plugin versions (`routes/plugins.py`)

Submit `partial(_source2Versions, settings.pip_source)` to `Io` as
`plugin.versions`.

### 8. Final sweep

Search `backend/src/forecastbox/routes` and `entrypoint/app.py` for:

```text
^def  under a @router / @app decorator  -> none (use an AST scan or grep -B2)
run_in_executor | asyncio.to_thread | run_in_threadpool  -> none
client.request_response | request_response(  -> none in routes
get_sync(  -> none in routes
subprocess | shutdown_popen | time.sleep  -> none in routes
```

and in `domain/run/service.py`, no `client.request_response` or
`get_current_cascade_proc` call remains directly inside an `async def`.

Document any remaining deliberate exception (Phase 4 scheduler restart) with a
`# TODO(concurrency phase 4)`-style comment at the call site.

Update `routes/__init__.py`'s docstring with one guideline bullet: routes are
`async def`; blocking work is submitted to a named `ConcurrentPools` pool via
`execution_manager.awaitable_submit` (jobs-DB via `await_jobs_db`); direct
calls are limited to in-memory reads and short lock sections.

## Tests and validation

1. Existing unit tests (`tests/unit/routes/test_status.py`,
   `tests/unit/domain/run/test_service.py`, `tests/unit/routes/test_lens.py`,
   `tests/unit/routes/test_plugins.py`, `tests/unit/routes/test_blueprint.py`)
   must pass; with the inline `awaitable_submit` fake they should need only
   `await`/`async` adjustments where they call converted route functions
   directly.
2. New focused unit tests:
   - `/status` reports `cascade: "down"` when the `Io` submission raises
     `SubmissionRejected` (patch `awaitable_submit` to raise);
   - `stop_instance` raises `NoLensFound` for an unknown id, and the stop route
     maps it to 404;
   - `start_skinny_wms` with a failing `Popen` raises `RuntimeError`, releases
     the port, and leaves no instance entry (no `NameError`);
   - `retrieve_output_bytes` raises `RunOutputRetrievalFailed` for a gateway
     error response and for a non-bytes decode;
   - `_fetch_textual_values` returns only successfully decoded values and logs
     per-task failures (adapt from the existing poll tests);
   - one routing assertion per pool choice where cheap (recording fake for
     `awaitable_submit` checking pool and task name), at least for
     `artifact.delete`, `lens.start`, `gateway.start`, `run.poll.progress`.
3. Integration tests: run the full suite; it covers `/status`, `/gateway/start`,
   `/run/get|list|delete|outputContent|logs`, `/artifacts/*`, and
   `/blueprint/catalogue`. If lens integration coverage is missing and
   skinnyWMS is available in the dev environment, manually exercise start /
   status / proxy / stop once.
4. Type checking and `uv run prek`.

## Completion criteria

- No synchronous `def` route remains.
- No async route or async service function performs a blocking gateway,
  HTTP, SSH, subprocess, or process-wait call on the event loop; each such
  section is a named task on `Io` or `General` and visible in pool counters.
- Lens and gateway process ownership is unchanged; the lens stop/start
  correctness fixes are in place.
- Route response contracts are unchanged.

## Outdated information in the original documents

- The migration describes `/api/v1/status` as a synchronous route performing
  network calls; it is already `async`, its ECMWF probe already uses the async
  HTTP client, and it already includes the execution status. Only the cascade
  probe remains blocking.
- The migration lists only lens start and status probes as initial cases. The
  current codebase has more synchronous routes (artifacts, blueprint, other
  lens routes) and several async routes with blocking gateway/HTTP calls
  (gateway, run, plugin versions); all are in scope here.
- The migration says the lens process start goes to `General`; this plan adds
  lens stop to `General` as well, because `shutdown_popen` can wait ~9 s.

## Open questions and concerns

1. `General` capacity. After this phase `General` carries `run.submit`,
   `run.stop.cascade`, `gateway.start` (startup and route), `gateway.stop`,
   `lens.start`, `lens.stop`, `run.logs.build-archive`, and -- until Phase 4 --
   the startup `scheduler.await-prereqs` waiter, which blocks one of the two
   default workers until plugins are loaded and the gateway is up (possibly
   minutes on a fresh install). A slow `lens.stop` plus that waiter would
   delay run submission. Options: raise the default `General.max_workers` to
   4 in `utility/config.py` (backwards compatible for configs that do not
   override `pools`), or accept the current default until Phase 4 removes the
   waiter. Recommendation: raise to 4; please decide.
2. Should `run/list` poll the gateway concurrently (`asyncio.gather` over the
   page) instead of sequentially? It would cut latency for pages with many
   active runs but multiplies `Io` and jobs-DB pressure per request. This plan
   keeps the sequential behaviour; revisit only if list latency is reported.
3. Lens status probes stay inline (localhost `connect_ex`, 0.1 s timeout per
   port). If lenses are ever bound to non-loopback addresses, these must move
   to `Io` (including the probe in `domain/lens/proxy.py::_resolve_port`).
4. `routes/experiment.py::restart_scheduler` calls `stop_scheduler()` (a
   thread join) directly on the loop. Left for Phase 4, which replaces the
   scheduler thread with a managed one.
