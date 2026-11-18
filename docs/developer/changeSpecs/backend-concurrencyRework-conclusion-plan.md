# Backend concurrency rework: conclusion plan

## Purpose and status

This document closes the backend concurrency rework. It compares the current
codebase with the original design and migration plan, then lists:

- the outstanding work needed to meet the original goals (section "Outstanding work");
- places where the codebase deliberately differs from the original plan, kept
  here only so a reviewer can confirm them (section "Divergences to confirm");
- outdated statements in the original documents (section "Outdated information
  in the original documents");
- general observations outside the scope of the migration (section "Review");
- removals and decisions that need a human decision first (section "Requires
  confirmation", at the end).

The current codebase is authoritative. The original documents were treated as
conceptual guidance only.

Original documents (look at these original files only if you encounter an
unexpected situation; this plan is meant to be self-contained):

- `docs/developer/changeSpecs/backend-concurrencyRework-design.md`
- `docs/developer/changeSpecs/backend-concurrencyRework-migration.md`
- the `backend-concurrencyRework-phase*-plan.md` / `-result.md` files in the same
  folder (these are known to be out of date; do not rely on them)

All paths below are relative to `backend/src/forecastbox/` unless stated otherwise.

## Summary of the original goals and where they stand

| Original goal | State |
| --- | --- |
| All application-owned threads and pools are created, named, and supervised by one `ExecutionManager` (`utility/concurrency/manager.py`) | Done. `threading.Thread` and `ThreadPoolExecutor` are only created in `manager.py` (plus the unused `delayed_thread`, see O-1) |
| Shared, bounded, named pools (`ConcurrentPools` in `utility/config.py`) with typed `SubmissionRejected` | Done |
| `utility/concurrent.py` split into `utility/concurrency/{manager,ports,shutdown,synchronization}.py`, empty `__init__.py` | Done |
| Process-local event dispatcher (`utility/dispatcher.py`) with entrypoint-side discovery of `domain/*/dispatchers.py` | Done (routing changed to payload-type based, see D-1) |
| Jobs DB: sync engine, one `threading.RLock`, async callers via the one-worker `ConcurrentPools.JobsDb` pool | Done (`utility/db.py`, `schemata/jobs.py`, `execution_manager.await_jobs_db`). Missing TODO comment, see O-2 |
| Users DB isolated in `domain/auth/db.py` with its own async lock | Done |
| No background code keeps the FastAPI loop for DB work; no `run_coroutine_threadsafe` DB bridges; no default executor | Done. The only remaining loop holder is the notification broadcaster adapter (D-2) |
| Artifact catalog/downloads on `ArtifactIo`, stores on `Io`, plugin operations on `PluginManagement` via `submit_after` | Done (except artifact delete, see O-6) |
| Run submission via `submit_run_sync` on `RunSubmission`; scheduler calls it directly | Done |
| Run log archive, lens start, status probes off the async loop | Done |
| Scheduler as stage-1 managed thread; `Globals.scheduler` removed | Done. Top-level `scheduler` status field remains, see C-1 |
| Plugin to blueprint template reaction via events (`plugin.templates.changed/removed`), no plugin->blueprint imports | Done. Introduced a regression in warmup, see O-0 |
| Stage-2 periodic DB maintenance PoC | Done (`domain/maintenance/garbage_collector.py`), with divergences (D-3) |
| Event to async-loop notification PoC | Superseded by a real websocket broadcaster (D-2) |
| Phase 8: consolidated staged startup/shutdown/status | Partially done, see O-3, O-4, O-5 |
| Phase 9: remove obsolete execution code, update guidance | Mostly done, see O-1, O-9, O-10 |

Phase 9 source inventory (performed for this document, excluding tests):

- `threading.Thread`: `utility/concurrency/manager.py`; `utility/concurrency/synchronization.py::delayed_thread` (unused, O-1).
- `ThreadPoolExecutor`: `utility/concurrency/manager.py`; `backend/packages/fiab-core/scripts/parse_test_artifacts_catalog.py` (standalone script, out of scope).
- `run_in_executor`, `asyncio.to_thread`: none.
- `run_coroutine_threadsafe`: `domain/notification/service.py::publish` (documented loop adapter, D-2).
- `asyncio.get_running_loop`: `entrypoint/initializers.py::_start_broadcaster` (adapter initialization).

## Outstanding work

Items are ordered by priority. Each item is self-contained.

### O-0 (high) Warmup cannot ingest plugin templates any more

Since template ingestion moved to events (commit "replace plugin->blueprint
template ingestion with events"), `domain/plugin/loading.py::update_single`
emits `plugin.templates.changed` via `submit_event` and waits for the receipt.
`entrypoint/warmup.py` deliberately starts neither the execution manager nor the
dispatcher, so `submit_event` raises `DispatcherNotRunning`;
`_request_template_ingest` turns it into an error and `update_single` raises
`PluginTemplateIngestFailed`. Every default plugin is therefore reported as
failed and warmup exits non-zero (verified: calling
`loading._request_template_ingest` without a running dispatcher returns
`DispatcherNotRunning(...)`). `unload_single` (used for settings overrides with
`is_enabled=False`) fails the same way. `tests/unit/entrypoint/test_warmup.py`
mocks `update_single`, so the regression is not caught.

Proposed fix (see question Q-1 for the alternative): in `warmup()`, start a
minimal runtime: run dispatcher discovery, register all pools and the event
dispatcher thread (no scheduler, no garbage collector), `execution_manager.start`,
and `execution_manager.shutdown` in `finally`. To avoid duplication, split
`entrypoint/initializers.py::_start_execution_runtime` into a reusable
`_register_core_runtime()` (dispatchers, pools, dispatcher thread) used by both.
Notification handlers will fail in warmup because the broadcaster has no loop;
that only produces monitored failures and log noise. Optionally make
`notification/dispatchers.py` skip silently when the broadcaster is not
initialized. Update the warmup module docstring ("emits no dispatcher events"
is no longer true). Add an integration-ish unit test that runs `update_single`
with a real dispatcher and a stubbed blueprint handler.

### O-1 Delete `delayed_thread`

`utility/concurrency/synchronization.py::delayed_thread` is unused (replaced by
`submit_after`). Delete it together with the now-unused imports (`Future`,
`Callable`, `Sequence`, `Any`, `logger` if unused). The unit test
`tests/unit/domain/plugins/test_plugin_operations.py::test_submit_load_all_uses_submit_after_not_delayed_thread`
asserts `not hasattr(submit_module, "delayed_thread")`; it stays valid but can be
removed as it guards a migration that is now complete.

### O-2 Add the concurrent-reads TODO to `utility/db.py`

The design required this comment beside the jobs lock / `dbRetry`:

```python
# TODO investigate concurrent reads. SQLite should support concurrent readers,
# but the first implementation deliberately serializes all access so this
# rework does not also need to solve read/write classification and consistency.
```

### O-3 (Phase 8) Consolidate the shutdown sequence

Current state (`entrypoint/initializers.py::build_initializers`, unwound in
reverse): `lens` -> `processes` (gateway) -> `tunnels` -> `scheduler`
(`execution_manager.stop_thread(Scheduler)`) -> `gateway`/... (no-op stops) ->
`broadcaster` (no stop) -> `http_pools` -> `execution_runtime`
(`execution_manager.shutdown`: garbage collector, scheduler, dispatcher drain,
pools).

Target, following the design intent:

1. Stop long-lived threads in descending stage order: garbage collector (2),
   scheduler (1), dispatcher (0, with its own bounded drain).
2. Clear the broadcaster loop reference (see O-4).
3. Close the http pools (deliberate cancellation of in-flight downloads, see
   `backend/development.md`) and then close the execution pools.
4. Stop lens instances, gateway processes, and tunnels.
5. Log the resulting `ShutdownStatus`, warning on `incomplete_threads` /
   `incomplete_pools` (currently the return value of
   `execution_manager.shutdown` is ignored in `_stop_execution_runtime`).

Concrete steps:

- Add to `ExecutionManager` a `stop_threads(*, timeout) -> tuple[ConcurrentThreads, ...]`
  (stops all threads in descending stage, sets lifecycle to `stopping`) and make
  `shutdown` call it and then close pools; alternatively keep `shutdown` and
  split it into two initializer steps. Either way, the entrypoint should only
  declare ordering.
- Remove the separate `Initializer("scheduler", stop=_stop_scheduler)` and
  `_stop_scheduler`; the manager stops the scheduler as part of stage-ordered
  thread shutdown (see C-4).
- Reorder `build_initializers` so the thread stop happens before `lens`,
  `processes` and `tunnels` are stopped, and pool close happens after
  `http_pools` stop. See Q-2 on whether gateway/lens should be stopped before or
  after pools drain.
- Decide on fair-share deadline budgeting (C-5). At minimum, ensure one hung
  thread cannot consume the whole budget for all later threads and pools:
  today `ExecutionManager.shutdown` uses one absolute deadline across all threads
  then all pools sequentially.
- Wrap each `stop_request` call in `_stop_record` in `try/except` and log; today
  an exception raised by a component's stop request propagates out of
  `shutdown()` and leaves all pools open.

### O-4 Broadcaster lifecycle and the blocked loop during shutdown

Two related problems with `domain/notification/service.py` and its initializer:

- Ordering: `broadcaster` is initialized after `execution_runtime`, so an event
  handled before `init_broadcaster` fails with
  `NotificationBroadcasterNotInitialized`. The loop reference is never cleared.
  Fix: move `Initializer("broadcaster", ...)` before `execution_runtime` and add
  a `stop` that clears `NotificationBroadcaster._loop` (it then unwinds after the
  runtime has stopped, matching the design). After clearing, `publish` should
  return/raise immediately without waiting.
- Shutdown on the loop thread: `Initializers.shutdown` calls sync stops on the
  event-loop thread. `execution_manager.shutdown` therefore blocks the loop
  while the dispatcher drains. Each drained notification handler calls
  `publish`, which does `run_coroutine_threadsafe(...).result(timeout=5)`; the
  coroutine can never run while the loop is blocked, so every such handler
  occupies a General worker for 5 s and then fails. With 4 General workers and a
  10 s default shutdown budget this quickly exhausts the budget and reports
  incomplete pools. Options (see Q-3): (a) run the blocking shutdown steps off
  the loop thread (an explicitly documented entrypoint exception to the "no
  default executor" rule, or a dedicated short-lived thread), (b) make
  `publish` fire-and-forget (`run_coroutine_threadsafe` plus a done-callback
  that logs failures, no `.result()`), (c) clear the loop reference before the
  dispatcher drain so publish is a no-op during shutdown. Option (b) also fixes
  the General-pool occupancy concern in R-6.

### O-5 Execution status correctness

In `ExecutionManager.status()` / `ManagedPool`:

- Pool worker threads (`fiab-<pool>_N`) are reported in
  `unregistered_threads`, because only long-lived thread names are excluded.
  Exclude names from every `ManagedPool._worker_names` as well.
- Pool health is not computed. The design defined a pool as unhealthy when
  shut down unexpectedly or with fewer live workers than configured. Add a
  `healthy` flag to `PoolStatus` (for example: `accepting` while the manager is
  running and `observed_workers == max_workers`) and include it in
  `ExecutionStatus.healthy`. Note `observed_workers` is never decremented; see
  C-6 for whether to track liveness more precisely.
- `ThreadStatus` has no native thread id (design requirement). Add
  `native_id: int | None` from `record.thread.native_id` (cheap, useful for
  correlating with `py-spy` / OS tools). See C-6.

### O-6 Artifact delete uses the shared SSH handle outside `ArtifactIo`

`routes/artifacts.py::delete_model_endpoint` submits
`domain/artifact/manager.py::delete_model` to `ConcurrentPools.General`.
`delete_model` calls `_ssh_handle_if_needed()` and runs a remote command on the
shared `ArtifactManager.ssh_handle`, concurrently with downloads and catalog
refreshes on `ArtifactIo`. The `ArtifactIo` single worker exists precisely to
serialize use of that handle (its lock only protects creation/reconnection).
Fix: submit the delete to `ConcurrentPools.ArtifactIo`. This also removes most
of the delete/download race noted in the in-code TODO, since both now run on
the same single worker. Update the module docstring ("Model deletion currently
runs on the caller's thread") and the stale TODO "delete is now blocking
operation ... switch to a submit-based one" accordingly.

Caveat: a delete queued behind a long download now waits for it. The route
awaits the result, so a long wait would hold the HTTP request. If unacceptable,
make delete fire-and-forget (`submit_monitored`) with a notification event, as
the existing TODO already suggests.

### O-7 `scheduler_lock` held across awaits on the event loop

`domain/experiment/service.py::update_schedule` and `delete_schedule` acquire
the `threading.Lock` `scheduler_lock` via `timed_acquire` (blocking the loop up
to `timeout_acquire_request` = 3 s) and then hold it across several
`await execution_manager.await_jobs_db(...)` calls. A second concurrent request
blocks the loop thread on the same lock, which in turn prevents the first
coroutine from resuming and releasing it; the second request always times out
after blocking the whole loop for 3 s. Both functions carry a
"TODO rework the whole update to run in a pool" comment.

Fix: make the locked parts synchronous functions (for example
`_update_schedule_sync`, `_delete_schedule_sync`) that take `scheduler_lock`
and call the jobs DB helpers directly, and submit them with
`execution_manager.awaitable_submit(ConcurrentPools.General, ...)`. Keep the
final read (`list_experiment_definitions`) outside the lock via `await_jobs_db`.
This matches the documented rule that sync pool workers call DB helpers
directly. `prod_scheduler()` can be called from the worker. Remove the TODOs.

### O-8 Fire-and-forget tasks submitted unmonitored

The design contract is that `submit_unmonitored` transfers failure ownership to
the caller, who must retrieve the result. Two call sites drop the future:

- `domain/run/stop.py::submit_stop_cascade` (`run.stop.cascade`)
- `domain/gateway/service.py::submit_stop_gateway` (`gateway.stop`)

Both task bodies catch exceptions, but an unexpected `BaseException` or a bug
would be lost silently. Switch both to `submit_monitored`. Update the docstrings
("on the general pool, unmonitored").

### O-9 Import `ConcurrentPools` from its defining module

The design requires importing from the defining module. `ConcurrentPools` is
defined in `utility/config.py` but imported via `utility.concurrency.manager` in:
`entrypoint/initializers.py`, `domain/artifact/manager.py`,
`domain/plugin/submit.py`, `domain/plugin/store.py`. Change these imports to
`forecastbox.utility.config`.

### O-10 Stale docstrings, comments and guidance

Update the following so they describe the current state:

- `domain/plugin/__init__.py`: "Loosely coupled to Plugin domain -- emits
  template events which are then consumed by it." should say Blueprint domain.
- `domain/plugin/state.py` module docstring refers to `domain.plugin.manager`,
  which no longer exists (now `submit.py`, `loading.py`, `state.py`, ...).
- `schemata/jobs.py` docstring refers to `entrypoint/app.py` for schema
  discovery; it now lives in `entrypoint/initializers.py::start_db_schema`.
  Its "TODO for later: implement garbage collection" can point to
  `domain/maintenance`.
- `domain/notification/dispatchers.py` refers to
  `entrypoint.app._discover_dispatchers`; it is
  `entrypoint.initializers._discover_dispatchers`. `domain/notification/service.py`
  says `_loop` is written "from `entrypoint.app`'s lifespan"; it is the
  `broadcaster` initializer.
- `entrypoint/warmup.py` docstring (see O-0).
- `entrypoint/initializers.py` barrier comment: "TODO rework into better
  alignment with execution manager / initializers after concurrency migration
  concluded. In particular, we dont want to consume a thread by awaiting on a
  future" -- no thread is consumed any more (barriers use done-callbacks; the
  scheduler waits on its own managed thread). Resolve per C-7 and reword or
  remove.
- `domain/artifact/manager.py` docstring and TODO (see O-6).
- `routes/status.py` TODO on the `scheduler` field (see C-1).
- `backend/development.md`, "Concurrency Considerations": the list "scheduler
  thread, plugin thread, artifact pool, event dispatcher, ..." is outdated
  (there is no plugin thread; there are named pools). The jobs lock is
  `utility/db.py::lock`, not `dbLock` (`dbLock` is the users-DB lock in
  `domain/auth/db.py`). Add short notes on: `submit_monitored` vs
  `submit_unmonitored` ownership of failures; staged registration and stage
  meaning (0 infrastructure, 1 producers, 2 maintenance); status available under
  `/api/v1/status` `concurrency`; the notification broadcaster as the only
  loop-holding adapter; never hold a `threading` lock across an `await`.
- `docs/developer/changeSpecs/overallReviewState.md`, bullet "DB access /
  concurrency" describes the old async lock and `plugin/manager.py`; bullet
  "hierarchy-breaching imports inside functions in domain.plugin" is resolved by
  the template events. Update or drop both bullets.

### O-11 (optional) Unit tests for the runtime

Test design was out of scope of the migration, but there are no dedicated unit
tests for `ExecutionManager` / `ManagedPool` (only indirect coverage in
`tests/unit/scheduling/test_runtime.py` and the dispatcher tests with a fake
manager). Worth adding at least: bounded admission (`SubmissionRejected` when
`max_pending` reached), same-pool reentrancy rejection, coroutine rejection,
stage ordering of start and shutdown, `submit_after` with failed dependency,
`status()` counters and `unregistered_threads` (O-5).

### O-12 Close out the change-spec documents

Per `docs/developer/changeSpecs/README.md`, once the items above are done (or
moved to separate specs), a human deletes the
`backend-concurrencyRework-*.md` files, including this one.

## Divergences to confirm

The codebase differs from the original plan in these points. The recommendation
for each is to keep the current codebase; no migration is prescribed. Once
confirmed, these can be dropped from this document.

- D-1 Event routing by payload type. `Event` is `(name, payload)` with an
  arbitrary frozen payload instead of `(name, kwargs)`; `DispatcherRegistration`
  has `handler_type` instead of `event_name`, and handlers match on
  `isinstance(payload, handler_type)` (including `runtime_checkable` protocols,
  e.g. `ClientNotificationSource`). `Event.name` is observability only.
  `DispatcherStatus` therefore has no "handler count by event name".
- D-2 Notifications. The `ActiveWebsocketClientRegistry` placeholder and the
  `notification.emitted` event were replaced by a real websocket feature:
  `domain/notification/service.py::NotificationBroadcaster`,
  `routes/notification.py` (websocket + test route), and many domain events
  implementing `ClientNotificationSource`. `publish` uses
  `run_coroutine_threadsafe` and blocks up to 5 s instead of fire-and-forget
  `call_soon_threadsafe` (see O-4, R-6). The maintenance thread does not emit a
  notification.
- D-3 Maintenance thread. Interval is 3 hours (not 10 minutes); there is an
  admin trigger (`routes/admin.py` -> `trigger_cleanup`) although the design
  said no administrative prod; registered with `NEVER_RESTART` and no restart
  route; queries `summarize_blueprint_storage`.
- D-4 Restart model. `RestartPolicy` has only `max_restarts` (no
  `minimum_interval_seconds`). `restart_thread` has `reset_restart_count`, used
  by the admin scheduler restart route (`routes/experiment.py` ->
  `restart_scheduler`), which stops and restarts the thread. The scheduler is
  registered with `NEVER_RESTART`, so only that explicit admin path restarts it.
- D-5 Manager API extensions. `submit_after` returns a `Future` mirroring the
  continuation (design: `None`); `await_jobs_db(task_name, task)` convenience
  wrapper; `start(timeout=...)` with `startup_timeout_seconds` in config;
  status DTOs are frozen pydantic models; component status is any `StatusModel`
  implementing the `ComponentReady` protocol.
- D-6 Startup orchestration via `utility/initializer.py` (`Initializer` /
  `Initializers`) in `entrypoint/initializers.py` instead of a hand-written
  lifespan in `entrypoint/app.py`. Cross-step dependencies use module-level
  barrier futures (`ArtifactsCatalogInitialized`, `PluginsCatalogInitialized`,
  `GatewayInitialized`, `SchedulerPrerequisitesMet`) and a scheduler start gate,
  including `_forward_all_to_barrier`, which is a group-of-futures aggregation
  the design said not to add (see C-7).
- D-7 Pool choices and defaults. General pool default is 4 workers (design: 2).
  `ArtifactIo` and `PluginManagement` are validated to exactly one worker.
  Cascade status probe runs on `General` (design: `Io`); run log archive does
  the gateway fetch on `General` and the zip on `Io` (design suggested the
  opposite). Gateway startup runs on `General`. Template event handlers run on
  `General` (as designed).
- D-8 The template event names and flows match the plan
  (`plugin.templates.changed` / `plugin.templates.removed`, producer waits for
  the receipt, handlers on `General`, readiness redefined in
  `domain/plugin/status.py::plugins_ready`). Wait timeout is 600 s.

## Outdated information in the original documents

For readers of the original design/migration documents:

- The "Current concurrency inventory" table in the migration plan describes the
  pre-migration state and is entirely historical; `domain/plugin/manager.py`,
  `SchedulerThread`, `stores_updater`, `join_*` helpers,
  `start_scheduler`/`stop_scheduler`, `Globals.scheduler`, the jobs
  `asyncio.Lock` and `run_async` no longer exist.
- Lifespan code is in `entrypoint/initializers.py`, not `entrypoint/app.py`.
- `Event.kwargs`, `DispatcherRegistration.event_name`, `RestartPolicy.minimum_interval_seconds`,
  `submit_after -> None`, `ActiveWebsocketClientRegistry`, `notification.emitted`,
  the 10-minute maintenance interval and "no administrative prod", and the
  General pool default of 2 workers are all superseded (see D-1 to D-7).
- Phase 8's list of direct calls to remove is already obsolete; the remaining
  Phase 8 work is O-3 to O-5.
- The design says "No open design questions remain"; O-0 and O-4 show the
  event-based template ingestion and the blocking notification bridge raised new
  ones.

## Review

Observations outside the strict migration scope. Not required to conclude the
migration; listed for awareness.

- R-1 `ManagedPool.close` and `ExecutionManager._wait_for_ready` busy-poll with
  5 ms sleeps. A `threading.Condition` (pool: notified from the completion
  callback) would be cleaner.
- R-2 `ExecutionManager.status()` builds `dict(freeze_mapping(...))`, which
  freezes and immediately unfreezes; the pydantic model is already frozen.
- R-3 The barrier futures in `entrypoint/initializers.py` are created at import
  time and are single-use, so the lifespan cannot run twice in one process
  (relevant for tests that start the app repeatedly). They also make the module
  import have side effects (`_forward_all_to_barrier` registration). Consider
  creating them inside `build_initializers`.
- R-4 Several sync helpers called directly from async routes take a
  `threading.Lock` with `timed_acquire` (0.5-1 s), blocking the loop for that
  long under contention: `domain/artifact/manager.py::list_models`,
  `get_model_details`, `submit_artifact_download`;
  `domain/plugin/status.py::catalogue_view`;
  `domain/plugin/detail.py::build_plugin_listing`. The data is pyrsistent and
  could be read lock-free; the lock is only needed for writers.
- R-5 `domain/gateway/service.py::shutdown_processes` is `async` but performs
  blocking calls (`stop_gateway`, up to 15 s request) on the loop. Acceptable at
  shutdown, but misleading.
- R-6 `notification.publish` blocks a `General` worker up to 5 s per
  notification. With slow websocket clients, notification bursts can occupy all
  `General` workers, which also serve run submission (`run.submit`), template
  ingestion, lens start, status probes and gateway start. Consider a dedicated
  pool or fire-and-forget publish (O-4 option b).
- R-7 `domain/maintenance/garbage_collector.py` and
  `domain/experiment/scheduling/runtime.py` keep `threading.Event`s as class
  attributes shared across thread restarts; a stale `wake` set by a stop request
  makes the next run iterate immediately. Harmless today, worth clearing on
  entry.
- R-8 `ExecutionManager._start_thread` writes `record.started_at` /
  `stopped_at` / `uncaught_exception` from the managed thread without the
  manager lock; benign under the GIL but inconsistent with the rest of the
  class.
- R-9 `ConcurrencySettings.validate_runtime` has a TODO to become a pydantic
  validator; doing so would fail config parsing early instead of at
  `validate_runtime`.
- R-10 `utility/db.py::queryCount` is unused.

## Open questions

- Q-1 (O-0) Should warmup start a minimal runtime (pools + dispatcher), or
  should `update_single`/`unload_single` accept an injectable template hook so
  warmup can call `domain/blueprint/template_ingest.py` directly from the
  entrypoint (the entrypoint may import both domains)? The first keeps one code
  path; the second keeps warmup free of threads, as its docstring intends.
- Q-2 (O-3) Should gateway and lens processes be stopped before or after the
  execution pools drain? Stopping them first makes in-flight run-submission and
  gateway-bound tasks fail fast (shorter shutdown); stopping them after matches
  the design and lets tasks finish cleanly but may hit the shutdown budget
  (run submission can wait up to an hour for artifacts).
- Q-3 (O-4) Which mitigation for the loop being blocked during shutdown:
  off-loop shutdown, fire-and-forget publish, or clearing the loop before the
  dispatcher drain?

## Requires confirmation

Removals and decisions that look right but are not obviously safe without a
human decision.

- C-1 Remove the deprecated top-level `scheduler` field from
  `routes/status.py::StatusResponse` (and then
  `domain/experiment/scheduling/runtime.py::status_scheduler`). The design asked
  for it to move under `concurrency.threads.scheduler`, which already exists.
  The frontend still reads it (`frontend/src/types/status.types.ts`,
  `frontend/src/components/common/StatusDetailsPopover.tsx`) and the
  integration test `backend/tests/integration/test_schedule.py` reads both.
  Requires a coordinated frontend change; when scheduling is disabled the thread
  is not registered, so the frontend must treat a missing entry as "off".
- C-2 Remove the `_current_dispatcher()` indirection in `utility/dispatcher.py`
  (it rebuilds the dispatcher when `execution_manager` identity changes). No
  code in `src` or `tests` reassigns the module-level `execution_manager`, so
  the indirection appears dead; module functions could use `_dispatcher`
  directly.
- C-3 Remove the unused `utility/dispatcher.py::async_submit_event` (and
  `EventDispatcher.async_submit`). It was part of the designed API but has no
  callers.
- C-4 Remove `Initializer("scheduler", stop=_stop_scheduler)` and
  `SCHEDULER_STOP_TIMEOUT_SECONDS` usage at the entrypoint, relying on the
  manager's stage-ordered shutdown (part of O-3). Check the scheduler's
  lock-wait warning in `scheduler_stop_request` against the budget the manager
  will pass.
- C-5 Fair-share shutdown budgeting across groups (design requirement). Either
  implement it in `ExecutionManager` (per-group slice = remaining / remaining
  groups, unused time rolls forward) or drop the requirement and keep a single
  deadline with per-component timeouts.
- C-6 Thread/pool liveness detail in status (`native_id`, pool `healthy`,
  decrementing `observed_workers` on worker exit). O-5 proposes the cheap parts;
  confirm whether precise worker liveness tracking is wanted.
- C-7 The entrypoint barrier futures and `_forward_all_to_barrier`
  (group-of-futures continuation). Keep as entrypoint-local glue (recommended,
  then just reword the TODO), or move a generic `submit_after_all` into
  `ExecutionManager` now that a concrete use case exists.
- C-8 Route-level / domain submission gates on shutdown (design shutdown step
  1). Not implemented; uvicorn stops accepting connections and waits for
  in-flight requests before running lifespan shutdown, and the manager rejects
  external submissions once `stopping`. Recommend dropping this requirement.
- C-9 Remove `utility/db.py::queryCount` (R-10), unused.
- C-10 Remove the migration-guard test
  `test_submit_load_all_uses_submit_after_not_delayed_thread` together with O-1.
