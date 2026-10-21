# Backend concurrency rework: Phase 3.1 implementation plan

## Purpose and scope

Move artifact catalog refresh and artifact downloads off the private, lazily
created `ThreadPoolExecutor` in `domain/artifact/manager.py` and onto the
centrally managed, one-worker `ConcurrentPools.ArtifactIo` pool. Remove the
artifact-specific join from the application shutdown, and adapt the two
consumers of the catalog-refresh future (application startup and the plugin
warmup entrypoint).

This is an ownership migration. The artifact domain keeps its existing
immutable state (`catalog`, `locally_available`, `ongoing_downloads`), its
short state lock, its SSH command handle, and its public route-facing
functions. Route conversion (`routes/artifacts.py` being synchronous `def`
routes) is Phase 3.6, and the run-submission artifact wait is Phase 3.4; both
are out of scope here.

### Original design references

Look at these original files only if you encounter an unexpected situation.
This plan is self-contained and implementation should not normally require
reading them.

- [`backend-concurrencyRework-design.md`](backend-concurrencyRework-design.md)
- [`backend-concurrencyRework-migration.md`](backend-concurrencyRework-migration.md) (section "3.1 Artifact catalog and downloads")
- [`backend-concurrencyRework-phase2-result.md`](backend-concurrencyRework-phase2-result.md)
- [`backend-concurrencyRework-phase3.2and3-plan.md`](backend-concurrencyRework-phase3.2and3-plan.md)

## Delivered baseline you can rely on

- `forecastbox.utility.concurrency.manager.execution_manager` is a module-level
  `ExecutionManager`. It is started by the `execution_runtime` step of
  `entrypoint/initializers.py` and is in the `running` lifecycle before any
  later initializer step runs. All pools in `ConcurrentPools` are registered at
  stage 0, including `ConcurrentPools.ArtifactIo` (default 1 worker, 64
  pending; `utility/config.py` validates that it has exactly one worker).
- Relevant manager API (see `utility/concurrency/manager.py`):
  - `submit_unmonitored(pool, TaskName(...), task) -> Future[T]`: caller owns
    the failure;
  - `submit_monitored(pool, TaskName(...), task) -> None`: the manager records
    an exception in its bounded `monitored_failures` history, visible in
    `/api/v1/status` under `concurrency`;
  - `submit_after(dependency_future, pool, TaskName(...), task) -> Future[T]`:
    non-blocking continuation; a failed dependency is recorded and the task is
    skipped;
  - all submissions raise `SubmissionRejected` when the pool is full, the pool
    is not accepting, or a pool worker tries to submit to its own pool. Done
    callbacks of a pool future run on the worker thread of that pool, so a
    callback chained on an `ArtifactIo` future must never submit to
    `ArtifactIo`.
  - `SubmissionRejected` reaching a route is mapped to HTTP 503 by
    `utility/fastapi.py`.
- Plugin startup (Phase 3.2/3.3, delivered) already consumes the catalog
  future through `domain/plugin/submit.py::submit_load_all(start_after=...)`,
  which uses `submit_after` onto `ConcurrentPools.PluginManagement`.
- `_refresh_catalog_task` already records `ArtifactManager.refresh_error` and
  re-raises, so the returned future accurately reflects a failed refresh
  (covered by `tests/unit/domain/artifact/test_artifact_manager_refresh.py`).
- The notification dispatcher is operational; `submit_event(Event(...))` with
  `ArtifactDownloadFinishedEvent` is the existing download-completion surface.
- Unit tests run with an autouse inline fake of the execution manager in
  `backend/tests/unit/conftest.py` (`awaitable_submit`, `submit_monitored`,
  `submit_after`). It does not yet fake `submit_unmonitored`.

## Current state to replace

`backend/src/forecastbox/domain/artifact/manager.py`:

- `ArtifactManager.executor: ThreadPoolExecutor | None` and
  `ArtifactManager._ensure_pool()` lazily create a private
  `ThreadPoolExecutor(max_workers=1, thread_name_prefix="artifact-io")`.
- `submit_refresh_catalog()` takes the state lock, (buggy: on lock failure it
  records an error but still proceeds), ensures the pool, and submits
  `_refresh_catalog_task`, returning the executor `Future`.
- `submit_artifact_download()` reserves `ongoing_downloads[id] = 0` under the
  lock and then submits `_download_artifact_task` to the private executor. A
  rejected/failed submission would leave the entry at progress 0 forever.
- `_download_artifact_task` swallows every exception (records the failure in
  `ongoing_downloads`, emits `ArtifactDownloadFinishedEvent(is_success=False)`),
  so a task failure is invisible to any central monitoring.
- `join_artifact_manager(timeout_sec)` holds the state lock while calling
  `executor.shutdown(wait=True)` without honouring the timeout.
- A stale module-level TODO suggests rewriting the managers onto a single pool.

Consumers:

- `entrypoint/initializers.py`:
  - `_start_artifact_manager()` calls `submit_refresh_catalog()` and forwards
    its outcome into the module-level `ArtifactsCatalogInitialized` barrier
    future;
  - `_stop_artifact_manager()` calls `join_artifact_manager(timeout_sec=10)`;
  - `_start_plugin_catalog()` submits an *unmonitored General-pool task whose
    body is `ArtifactsCatalogInitialized.result`*, i.e. it occupies one of the
    two `General` workers for the whole duration of the catalog refresh, only
    to produce a future to pass to `submit_load_plugins(start_after=...)`.
- `entrypoint/warmup.py` (the `fiab.sh warmup` plugin-install entrypoint,
  which explicitly does **not** start the execution manager) calls
  `submit_refresh_catalog()`, then `catalog_refresh.result(timeout=...)`, and
  finally `join_artifact_manager(...)`.
- `domain/run/cascade.py` calls `submit_artifact_download` and polls
  `ArtifactManager.locally_available` from a `RunSubmission` worker. Leave that
  code untouched in this phase (Phase 3.4 owns it), but note that it works
  correctly only because the waiter (`RunSubmission`) and the download
  (`ArtifactIo`) are on different pools.

## Why `ArtifactIo` stays a dedicated one-worker pool

Keep the existing serialization. Write the following reasoning as a short code
comment next to the pool choice in `manager.py` (and the module docstring):

1. Catalog refresh publishes `locally_available = pset(listing)` from a storage
   listing taken earlier in the same task. If a download completed in between,
   the refresh would overwrite its `locally_available.add(...)`. Serializing
   refresh and downloads on one worker prevents this.
2. Downloads share one lazily created SSH command handle for `ssh://` data
   paths; `ssh_handle_lock` only guards creation/reconnection of that handle.

Note for reviewers (not an action item): OpenSSH `ControlMaster` multiplexing
does allow concurrent sessions over one control socket, so reason 2 is weaker
than the migration document suggests; reason 1 is the binding one. Widening
artifact work onto `ConcurrentPools.Io` is out of scope.

## Target behaviour

| Operation | Pool | Submission | Failure ownership |
| --- | --- | --- | --- |
| Catalog refresh (startup) | `ArtifactIo` | `submit_unmonitored`, `TaskName("artifact.catalog.refresh")`, returns `Future[None]` | Caller (startup barrier / plugin `submit_after`); domain also keeps `refresh_error` |
| Single artifact download | `ArtifactIo` | `submit_monitored`, `TaskName("artifact.download")` | Manager monitored history, plus existing domain surfaces (`ongoing_downloads` failure string, `ArtifactDownloadFinishedEvent`) |
| Model delete | unchanged (runs on the caller's thread) | n/a | unchanged; Phase 3.6 offloads the route |

## Implementation steps

### 1. `domain/artifact/manager.py`

1. Remove `ArtifactManager.executor`, `_ensure_pool`, the `ThreadPoolExecutor`
   import, `join_artifact_manager`, the stale "consider rewriting all those
   managers" TODO, and any constants/imports that become unused
   (`time`, `timeout_acquire_init` if unused).
2. Rename `_refresh_catalog_task` to a public, synchronous
   `refresh_catalog() -> None` with a short docstring: it fetches the catalog,
   lists storage, atomically publishes both under the state lock, records
   `refresh_error` and re-raises on failure. Behaviour is otherwise unchanged.
   It is public because the warmup entrypoint calls it directly (see step 3).
   When the publication succeeds, reset `refresh_error = None` inside the same
   locked section (a later successful refresh should not keep reporting an old
   error; today there is only one refresh per process, so this is cosmetic but
   keeps the state honest).
3. Rewrite `submit_refresh_catalog() -> Future[None]` as a lock-free one-liner
   around:

   ```python
   execution_manager.submit_unmonitored(
       ConcurrentPools.ArtifactIo,
       TaskName("artifact.catalog.refresh"),
       refresh_catalog,
   )
   ```

   Do not take the state lock here, and remove the
   `# ty: ignore[invalid-return-type]`. `SubmissionRejected` propagates to the
   caller (startup), which is correct: failing to even enqueue the refresh at
   startup is a startup failure.
4. Restructure the download task so it can be monitored without losing the
   domain surfaces:

   ```python
   def _download_artifact_task(composite_id: CompositeArtifactId) -> None:
       try:
           _download_and_publish(composite_id)   # existing body: lookup, download, locked publish
       except Exception as e:
           logger.exception(...)
           report_artifact_download_progress(composite_id, failure=repr(e))
           _notify_download_finished(composite_id, is_success=False)
           raise
       _notify_download_finished(composite_id, is_success=True)
   ```

   `_notify_download_finished` is the existing `submit_event(...)` block with
   its own `try/except` + `logger.exception` (a notification failure must not
   turn a successful download into a failed task). Re-raising lets the
   manager's monitored history record the failure; expected domain state is
   recorded before re-raising.
5. In `submit_artifact_download`, keep the locked check/reserve section
   unchanged, then submit outside the lock:

   ```python
   try:
       execution_manager.submit_monitored(
           ConcurrentPools.ArtifactIo,
           TaskName("artifact.download"),
           partial(_download_artifact_task, composite_id),
       )
   except SubmissionRejected:
       # roll back the reservation so the artifact is not stuck "in progress"
       <under the state lock: remove composite_id from ongoing_downloads>
       raise
   return Either.ok(0)
   ```

   Removing the reservation (rather than writing a failure string) restores
   the "not downloaded, not ongoing" state, so a plain re-request works without
   `retry=True`. Re-raising gives the route a 503 through the common handler;
   `domain/run/background.py::execute_background` already converts any
   exception into a failed run.
6. Update the module docstring: state is published as immutable `pyrsistent`
   values under one short lock; catalog refresh and downloads run on
   `ConcurrentPools.ArtifactIo` (one worker, for the reasons listed above);
   model deletion currently runs on the caller's thread. Remove the sentence
   about "background thread running I/O operations" being protected by the
   lock.
7. Leave `delete_model`, `list_models`, `get_model_details`,
   `report_artifact_download_progress`, and the SSH handle logic as is.

### 2. `entrypoint/initializers.py`

1. Remove the `join_artifact_manager` import, `_stop_artifact_manager`, and the
   `stop=` of the `artifact_manager` `Initializer`. Managed pool shutdown is
   performed by the existing `execution_runtime` stop step.
2. Keep `_start_artifact_manager` and the `ArtifactsCatalogInitialized`
   barrier unchanged in shape.
3. Replace the General-pool waiter in `_start_plugin_catalog` by passing the
   barrier future directly:

   ```python
   def _start_plugin_catalog() -> None:
       plugins_ready = submit_load_plugins(start_after=ArtifactsCatalogInitialized)
       plugins_ready.add_done_callback(_forward_to_barrier(PluginsCatalogInitialized))
   ```

   `submit_load_all` already uses `submit_after`, which registers a done
   callback and does not occupy any worker. This frees a `General` worker
   during startup (previously, with two `General` workers, the plugin waiter
   plus the scheduler waiter could occupy both while `gateway.start` and
   route-triggered `run.submit` tasks queued behind them). The continuation
   will run on the `ArtifactIo` worker thread that completes the refresh (or
   synchronously in the lifespan if the barrier is already done) and submits
   to `PluginManagement`, which is a different pool, so the same-pool guard is
   not triggered.
4. Update the large comment block above the barriers: drop the TODO about
   consuming a General thread for the plugin path; keep (and narrow) the TODO
   for the scheduler prerequisite waiter, which still blocks a `General`
   worker because it waits on two futures and the manager has no
   `submit_after_all`. That waiter is Phase 4 territory; do not change it now.

### 3. `entrypoint/warmup.py`

The warmup entrypoint does not start the execution manager, so it cannot use
`submit_refresh_catalog()` any more.

1. Replace `submit_refresh_catalog()` + `.result(timeout=CATALOG_TIMEOUT_SEC)`
   with a direct, synchronous `refresh_catalog()` call. Ordering: call it
   before or after `initialize_stores(...)`; the previous overlap of the two
   short HTTP fetches is not worth a thread. A failure raises, as before.
2. Remove `join_artifact_manager`, `CATALOG_JOIN_TIMEOUT_SEC`,
   `CATALOG_TIMEOUT_SEC`, and the `try/finally` that existed only for the
   join. Update the module docstring accordingly.
3. Concern to verify, not caused by this phase: `refresh_catalog` and
   `initialize_stores` use `utility.http_pools.get_sync`, which raises
   `HttpPoolsNotStarted` unless `start_http_pools()` ran. The warmup entrypoint
   currently never starts the http pools (it appears to have been broken by
   the http-pool introduction in #774, unless something outside this module
   starts them). Run `scripts/fiab.sh warmup` (or
   `python -m forecastbox.entrypoint.warmup`) once against a dev environment.
   If it fails with `HttpPoolsNotStarted`, add `start_http_pools()` after
   `register_fiabcore_providers()` and `asyncio.run(stop_http_pools())` in a
   `finally` at the end of `warmup()`; mention it in the commit message.
4. Update `tests/unit/entrypoint/test_warmup.py`: patch `refresh_catalog`
   instead of `submit_refresh_catalog`, and drop the
   `join_artifact_manager` assertions (`test_preparation_precedes_installation`
   ordering and the two `assert_called_once` checks).

### 4. Documentation touch-ups

- `backend/development.md`, "Concurrency Considerations": no change needed
  (it only mentions an "artifact pool" generically, which remains true).
- `domain/artifact/__init__.py` docstring needs no change (no new domain
  dependency is introduced).

## Tests and validation

1. `tests/unit/conftest.py`: add an inline `submit_unmonitored` fake that runs
   the task synchronously and returns a completed `concurrent.futures.Future`
   (result or exception set). This mirrors the existing fakes and keeps
   `test_artifact_manager_refresh.py` working without changes beyond renaming
   `_refresh_catalog_task` to `refresh_catalog`.
2. Extend `tests/unit/domain/artifact/` with focused tests (patch
   `download_artifact`, `submit_event`, and reset `ArtifactManager` state in a
   fixture):
   - `submit_refresh_catalog` submits exactly one task named
     `artifact.catalog.refresh` to `ConcurrentPools.ArtifactIo` via
     `submit_unmonitored` (use a recording fake for this one test);
   - `submit_artifact_download` submits a monitored `artifact.download` task to
     `ArtifactIo`, and returns `Either.ok(0)`;
   - on `SubmissionRejected` from the submission, the reservation is removed
     from `ongoing_downloads` and the exception propagates;
   - a failing download records the failure string in `ongoing_downloads`,
     emits `ArtifactDownloadFinishedEvent(is_success=False)`, and re-raises;
   - a successful download moves the id from `ongoing_downloads` to
     `locally_available` and emits `is_success=True`;
   - `ArtifactManager` no longer has an `executor` attribute.
3. Add or adapt an initializer-level unit test only if cheap: assert that
   `_start_plugin_catalog` passes `ArtifactsCatalogInitialized` itself to
   `submit_load_plugins` (no `General` submission). Skip if it requires
   heavy mocking of the lifespan.
4. Integration: `tests/integration/test_model.py::test_download_model` and
   `tests/integration/test_blueprint.py::test_blueprint_artifact_execute`
   exercise catalog refresh, download, and the run-time artifact wait through
   the real manager. Run both; additionally check `/api/v1/status` shows
   `concurrency.pools["artifact-io"]` with non-zero `succeeded` after the
   download.
5. Run type checking, the artifact/entrypoint unit tests, the integration
   suite, and `uv run prek`. Finally grep production sources:

   ```text
   ThreadPoolExecutor        -> only utility/concurrency/manager.py
   join_artifact_manager     -> no hits
   _ensure_pool              -> no hits
   ArtifactManager.executor  -> no hits
   ```

## Completion criteria

- No artifact-owned executor or thread exists; catalog refresh and downloads
  are visible under `concurrency.pools["artifact-io"]` in `/api/v1/status`.
- Download task failures appear both in the existing domain surfaces and in
  the manager's `monitored_failures`.
- A rejected download submission leaves no stuck `ongoing_downloads` entry.
- The application shutdown no longer calls any artifact-specific join.
- The plugin initial load waits for the catalog through a pure continuation;
  no `General` worker is blocked on the artifact catalog.
- The warmup entrypoint refreshes the catalog synchronously, without the
  execution manager.

## Outdated information in the original documents

- The migration document places startup/shutdown in `entrypoint/app.py`. The
  lifespan now delegates to ordered `Initializer` steps in
  `entrypoint/initializers.py`; component start/stop changes go there.
- The migration document does not mention `entrypoint/warmup.py`, which also
  consumes the artifact manager without an execution manager.
- The migration describes the single-worker requirement mostly via the SSH
  handle; the refresh/download `locally_available` overwrite race is the more
  concrete reason (see above).
- `submit_after` returns a `Future` mirroring the continuation's outcome (the
  design document shows `-> None`).

## Notes and caveats

These are informational; none of them requires action in this phase.

1. Shutdown of an in-flight download (no action): `ExecutionManager.shutdown`
   waits for in-flight pool work only until its deadline, but
   `ThreadPoolExecutor` worker threads are joined at interpreter exit. In
   practice a local HTTP download aborts when the `http_pools` initializer
   closes the `Download` client (it runs before the execution runtime stops),
   and an `ssh://` download fails when the `tunnels` step disconnects the
   command handle. A `file://` hardlink/copy or a stalled remote `curl` is not
   interrupted. This is no worse than the previous unbounded
   `executor.shutdown(wait=True)`, so it is accepted as is.
2. Delete/download/refresh races (no action): the races described in the TODO
   comments of `delete_model` (and the refresh-vs-delete overwrite of
   `locally_available`) are pre-existing and are not addressed by this
   effort. Preserve those TODO comments as they are and do not attempt to fix
   the root cause while moving the submission.
3. `refresh_error` (no action): it is written but never exposed by any route
   or status. Leave it as is; surfacing it belongs to the later status
   consolidation (Phase 8).
