# Backend concurrency rework: conclusion plan

## Purpose and status

This document closes the backend concurrency rework. It compares the current
codebase with the original design and migration plan and lists concrete,
reviewed tasks to finish it. All decisions have been reviewed by a human; the
tasks below are approved instructions, not proposals.

The current codebase is authoritative. Where the codebase diverged from the
original plan, the current codebase is kept (see "Outdated information in the
original documents").

Original documents (look at these original files only if you encounter an
unexpected situation; this plan is meant to be self-contained):

- `docs/developer/changeSpecs/backend-concurrencyRework-design.md`
- `docs/developer/changeSpecs/backend-concurrencyRework-migration.md`
- the `backend-concurrencyRework-phase*-plan.md` / `-result.md` files in the same
  folder (known to be out of date; do not rely on them)

All paths below are relative to `backend/src/forecastbox/` unless stated
otherwise. "Add a TODO/NOTE to the code" means a comment in the source at the
stated location, following the comment rules in `AGENTS.md` (plain ASCII, no
double spaces after a period).

## Summary of the original goals and where they stand

| Original goal | State |
| --- | --- |
| All application-owned threads and pools are created, named, and supervised by one `ExecutionManager` (`utility/concurrency/manager.py`) | Done, apart from the unused `delayed_thread` (task 2) |
| Shared, bounded, named pools (`ConcurrentPools` in `utility/config.py`) with typed `SubmissionRejected` | Done |
| `utility/concurrent.py` split into `utility/concurrency/{manager,ports,shutdown,synchronization}.py`, empty `__init__.py` | Done |
| Process-local event dispatcher (`utility/dispatcher.py`) with entrypoint-side discovery of `domain/*/dispatchers.py` | Done |
| Jobs DB: sync engine, one `threading.RLock`, async callers via the one-worker `ConcurrentPools.JobsDb` pool | Done, missing TODO comment (task 3) |
| Users DB isolated in `domain/auth/db.py` with its own async lock | Done |
| No background code keeps the FastAPI loop for DB work, no default executor | Done. The only remaining loop holder is the notification broadcaster adapter |
| Artifact catalog/downloads on `ArtifactIo`, stores on `Io`, plugin operations on `PluginManagement` via `submit_after` | Done, apart from artifact delete (task 7) |
| Run submission via `submit_run_sync` on `RunSubmission`, scheduler calls it directly | Done |
| Run log archive, lens start, status probes off the async loop | Done |
| Scheduler as stage-1 managed thread, `Globals.scheduler` removed | Done. Top-level `scheduler` status field remains (task 13) |
| Remove the plugin -> blueprint hierarchy breach | Done via events, but this broke warmup. Replaced by an entrypoint-injected hook (task 1) |
| Stage-2 periodic DB maintenance PoC | Done (`domain/maintenance/garbage_collector.py`) |
| Event to async-loop notification PoC | Superseded by a real websocket broadcaster (`domain/notification/service.py`) |
| Phase 8: consolidated staged startup/shutdown/status | Partially done (tasks 4, 5, 6) |
| Phase 9: remove obsolete execution code, update guidance | Mostly done (tasks 2, 10, 11, 12) |

Phase 9 source inventory (done for this document, excluding tests):

- `threading.Thread`: `utility/concurrency/manager.py`; `utility/concurrency/synchronization.py::delayed_thread` (unused, task 2).
- `ThreadPoolExecutor`: `utility/concurrency/manager.py`; `backend/packages/fiab-core/scripts/parse_test_artifacts_catalog.py` (standalone script, out of scope).
- `run_in_executor`, `asyncio.to_thread`: none.
- `run_coroutine_threadsafe`: `domain/notification/service.py::publish` (documented loop adapter).
- `asyncio.get_running_loop`: `entrypoint/initializers.py::_start_broadcaster` (adapter initialization).

## Tasks

Ordered by priority. Each task is self-contained. Run `uv run prek` (from
`backend/`) and the unit tests after each task.

### 1 (high) Replace plugin template events with an entrypoint-injected hook; protect warmup

Problem: plugin template ingestion currently goes through the event dispatcher.
`domain/plugin/loading.py::update_single` emits `plugin.templates.changed` via
`submit_event` and waits on the receipt (`_emit_and_wait`); `unload_single`
does the same with `plugin.templates.removed`. `entrypoint/warmup.py`
deliberately runs without the execution runtime, so `submit_event` raises
`DispatcherNotRunning`, `update_single` raises `PluginTemplateIngestFailed`,
every default plugin is reported failed and warmup exits non-zero (verified).
`tests/unit/entrypoint/test_warmup.py` mocks `update_single`, so this was not
caught. Using the event bus for a synchronous one-to-one call is also
unnecessarily indirect.

Decision: drop the template events. The plugin domain exposes a hook slot,
and the entrypoint fills it with the blueprint functions during
initialization, the same way the metkit/artifact providers are registered in
`entrypoint/initializers.py::register_fiabcore_providers`. The plugin domain
still does not import the blueprint domain, so the hierarchy stays acyclic.
No dependency-injection framework; this is a one-off registration.

Steps:

1. Add `domain/plugin/template_hooks.py` holding a process-local hook slot:
   - a frozen dataclass `TemplateHooks` with `on_changed: Callable[[PluginCompositeId], None]`
     and `on_removed: Callable[[PluginCompositeId], None]`;
   - `register_template_hooks(hooks: TemplateHooks) -> None` (stores it on a
     class attribute, single reference assignment);
   - `get_template_hooks() -> TemplateHooks`, raising a new
     `PluginTemplateHooksNotRegistered` exception (in `domain/plugin/exceptions.py`)
     with a message pointing to the entrypoint registration, if not registered.
     Fail loudly; do not silently skip ingestion.
2. In `domain/plugin/loading.py`:
   - replace `_emit_and_wait` with direct calls to
     `get_template_hooks().on_changed(plugin_id)` / `.on_removed(plugin_id)`;
   - keep `_request_template_ingest`'s behavior: catch exceptions, log,
     `notify_failure(...)`, return the error text;
   - remove `TEMPLATE_DISPATCH_TIMEOUT_SECONDS` and the now-unused imports
     (`Event`, `EventName`, `submit_event`, the template event classes).
3. In `domain/plugin/events.py` remove `PLUGIN_TEMPLATES_CHANGED`,
   `PLUGIN_TEMPLATES_REMOVED`, `PluginTemplatesChangedEvent`,
   `PluginTemplatesRemovedEvent`, and update the module docstring (client
   notification events only).
4. Delete `domain/blueprint/dispatchers.py`. The functions
   `domain/blueprint/template_ingest.py::ingest_plugin_templates` and
   `remove_plugin_templates` stay as they are and become the hook
   implementations. They now run inline on the caller's thread (the
   `PluginManagement` worker in the backend, the main thread in warmup) and call
   jobs-DB helpers directly, which is correct for synchronous code. Update the
   `template_ingest.py` module docstring accordingly (it currently says it runs
   on a `General` worker via `dispatchers.py`).
5. In `entrypoint/initializers.py` rename `register_fiabcore_providers` to
   `register_providers` (or add a sibling called from it) and register
   `TemplateHooks(on_changed=ingest_plugin_templates, on_removed=remove_plugin_templates)`
   there. `entrypoint/warmup.py` already calls `register_fiabcore_providers`;
   update its import/call to the renamed function. This shared function is the
   single place for initialization-time wiring used by both the backend and
   warmup.
6. Update docstrings:
   - `domain/plugin/__init__.py`: replace "Loosely coupled to Plugin domain --
     emits template events which are then consumed by it." with a statement that
     template ingestion/removal is delegated to hooks injected by the entrypoint
     (implemented by the Blueprint domain).
   - `domain/blueprint/__init__.py`: replace "Loosely coupled by Plugin domain --
     consumes template events ingested by it." accordingly.
   - `domain/plugin/errors.py`: `template_ingest` source no longer "in reaction
     to plugin template events".
   - `domain/plugin/status.py::plugins_ready`: no more "template dispatches" or
     "receipts"; readiness is simply initial load completed without
     `updater_error`.
   - `domain/plugin/state.py` module docstring: "waiting for template event
     dispatch" becomes "template ingestion hooks".
   - `entrypoint/warmup.py` docstring: it says "emits no dispatcher events";
     state instead that template ingestion runs inline via the registered hooks,
     and that notification events submitted by plugin code are dropped with a
     logged error (the existing `notify_*` helpers already catch
     `submit_event` failures).
7. Tests:
   - delete `tests/unit/domain/blueprint/test_dispatchers.py`;
   - rewrite `tests/unit/domain/plugins/test_plugin_loading_events.py` to
     register fake hooks and assert they are called, that a raising hook leads
     to `PluginTemplateIngestFailed` from `update_single` and leaves the plugin
     published from `unload_single`;
   - add a test that `get_template_hooks()` raises
     `PluginTemplateHooksNotRegistered` when nothing is registered;
   - add a warmup guard test: with no execution runtime started and hooks
     registered via the entrypoint registration function, `update_single(...,
     install=False)` for a stub plugin completes and calls the hook;
   - update `tests/unit/entrypoint/test_warmup.py` for the renamed registration
     function;
   - check `tests/integration/test_blueprint.py` tests added for template
     ingestion still pass unchanged.
8. Add a `*NOTE*` to the module docstring of the entrypoint package. Create a
   docstring in `entrypoint/__init__.py` (currently empty) and add the same
   note to the module docstring of `entrypoint/initializers.py`. Content, in
   substance:

   ```text
   *NOTE* when making changes here, make sure warmup (`entrypoint/warmup.py`,
   invoked by `scripts/fiab.sh warmup`) is unaffected. Warmup reuses selected
   startup steps (schema creation, provider and hook registration, catalog and
   store initialization) but deliberately runs without the execution runtime:
   no pools, no event dispatcher, no managed threads, no FastAPI loop. Any
   wiring that domain code needs during plugin install/load must therefore be
   registered in the shared registration function called by both, and must not
   rely on the dispatcher or pools. Warmup has been broken this way before.
   ```

### 2 Delete `delayed_thread` and its migration guard test

- Delete `utility/concurrency/synchronization.py::delayed_thread` and the
  imports that become unused.
- Delete `tests/unit/domain/plugins/test_plugin_operations.py::test_submit_load_all_uses_submit_after_not_delayed_thread`.

### 3 Add the concurrent-reads TODO to `utility/db.py`

Next to the jobs `lock` / `dbRetry`:

```python
# TODO investigate concurrent reads. SQLite should support concurrent readers,
# but the first implementation deliberately serializes all access so this
# rework does not also need to solve read/write classification and consistency.
```

### 4 (Phase 8) Consolidate the shutdown sequence

Current unwind order (`entrypoint/initializers.py::build_initializers`,
reversed): `lens` -> `processes` (gateway) -> `tunnels` -> `scheduler`
(`stop_thread(Scheduler)`) -> no-op stops -> `broadcaster` (no stop) ->
`http_pools` -> `execution_runtime` (`execution_manager.shutdown`: garbage
collector, scheduler, dispatcher drain, then pools).

Target unwind order:

1. Stop long-lived threads in descending stage order: garbage collector (2),
   scheduler (1), event dispatcher (0, with its own bounded drain).
2. Mark the broadcaster stopped and clear its loop reference (task 5).
3. Close the http pools (deliberate cancellation of in-flight sync requests,
   see `backend/development.md`), then close the execution pools and wait for
   them to drain.
4. Only after the execution pools drained: stop lens instances, gateway
   processes, and tunnels.
5. Log the resulting shutdown status, with a warning listing
   `incomplete_threads` / `incomplete_pools` if any.

Steps:

- In `ExecutionManager` add `stop_threads(*, timeout: float) -> tuple[ConcurrentThreads, ...]`
  which sets the lifecycle to `stopping` and stops all registered threads in
  descending stage order, returning those that did not stop. Make
  `shutdown(...)` call it (idempotent, already-stopped threads are skipped) and
  then close the pools, as today. Keep one single deadline per call; do not
  implement fair-share budgeting (that design requirement is dropped).
- In `_stop_record`, wrap the `stop_request` call in `try/except Exception`
  and log it, so a failing component stop request cannot abort the shutdown and
  leave pools open.
- In `build_initializers`, split the runtime into two initializer steps so the
  reverse unwind produces the target order. A suitable order of the list (top
  to bottom = startup) is: `db_schema`, `execution_pools` (stop: close pools via
  `shutdown`, log status), `lens`, `processes`, `tunnels`, `http_pools`,
  `broadcaster` (task 5), `execution_threads` (start: discovery, registration,
  `execution_manager.start`; stop: `stop_threads`), then the remaining
  start-only steps (`artifact_stores`, providers, `artifact_manager`,
  `plugin_catalog`, `gateway`). Verify that the start order still satisfies
  every dependency (pools registered and started before anything submits; the
  broadcaster loop set before the dispatcher runs; http pools started before
  stores/catalog tasks run). If the split makes the start side awkward, keep a
  single `execution_runtime` start and use a stop-only `Initializer` for the
  thread phase placed appropriately; the unwind order above is the requirement.
- Remove `Initializer("scheduler", stop=_stop_scheduler)` and `_stop_scheduler`;
  the scheduler is stopped by `stop_threads`. `SCHEDULER_STOP_TIMEOUT_SECONDS`
  stays in use by `restart_scheduler`. Check that the budget passed by the
  manager does not trigger the `scheduler_stop_request` warning with the
  default config.
- Add a TODO to the code at the pool-drain step: `# TODO improve the duration
  of execution pool drainage on shutdown -- long running tasks (eg run
  submission waiting for artifacts) may exhaust the shutdown budget, which
  delays stopping the gateway and lens processes.`
- Do not add route-level/domain submission gates for shutdown (design
  requirement dropped: uvicorn stops accepting and waits for in-flight requests
  before lifespan shutdown, and the manager rejects external submissions once
  `stopping`).

### 5 Notification broadcaster: fire-and-forget publish and lifecycle

In `domain/notification/service.py`:

- Make `publish` fire-and-forget: `run_coroutine_threadsafe(...)` and attach a
  done-callback that logs a failure of the broadcast; do not call
  `.result(...)`. Catch `RuntimeError` from a closed loop and log it. Remove
  `PUBLISH_TIMEOUT_SECONDS` and `NotificationPublishTimedOut` if unused after
  this. Add a TODO to the code: `# TODO fire-and-forget publish is undesirable
  -- delivery failures are only logged and not reported to the dispatcher; it
  is done primarily to not block the General pool for long. Revisit with a
  proper delivery mechanism.`
- Add a stopped state: `stop_broadcaster()` sets a stopped flag and clears
  `_loop`. After stop, `publish` logs at debug level and returns without
  raising. Before init (never initialized), `publish` keeps raising
  `NotificationBroadcasterNotInitialized`.
- Update the module concurrency docstring (it currently says `publish` blocks
  until the broadcast completed; `_loop` is "written exactly once").

In `entrypoint/initializers.py`: give the `broadcaster` initializer
`stop=stop_broadcaster`, and place it so it starts before the event dispatcher
thread starts and stops after the dispatcher has drained (see task 4 ordering).

### 6 Execution status correctness

In `utility/concurrency/manager.py`:

- Exclude pool worker thread names (all `ManagedPool._worker_names` values)
  from `ExecutionStatus.unregistered_threads`, in addition to long-lived thread
  names.
- Add `healthy: bool` to `PoolStatus`: `accepting and observed_workers ==
  max_workers` while the manager is `running`. Include pool health in
  `ExecutionStatus.healthy`. No precise worker liveness tracking
  (`observed_workers` is not decremented); keep it cheap.
- Add `native_id: int | None` to `ThreadStatus` from `record.thread.native_id`.
- R-2: replace `dict(freeze_mapping(pool_statuses))` /
  `dict(freeze_mapping(threads))` with the plain dicts (the status model is
  already frozen). Remove `utility/structural.py::freeze_mapping` (its only
  user) and the import.
- R-1: add a TODO to the code in `ManagedPool.close` and
  `ExecutionManager._wait_for_ready`: `# TODO replace busy polling with a
  threading.Condition`. Do not change the implementation.
- R-8: in `_start_thread`'s inner `run()`, write `record.started_at`,
  `record.stopped_at`, `record.uncaught_exception`, `record.traceback` under
  `self._lock`.

Add/adjust unit tests for these status fields (see task 15).

### 7 Artifact delete on the `ArtifactIo` pool

`routes/artifacts.py::delete_model_endpoint` submits
`domain/artifact/manager.py::delete_model` to `ConcurrentPools.General`, but
`delete_model` uses the shared SSH `CommandHandle`, whose command execution is
serialized only by the single `ArtifactIo` worker.

- Submit the delete to `ConcurrentPools.ArtifactIo` (keep awaiting it from the
  route).
- Update the `domain/artifact/manager.py` module docstring ("Model deletion
  currently runs on the caller's thread") to say deletion also runs on
  `ArtifactIo`, and why.
- Replace the in-code TODO "delete is now blocking operation ... switch to a
  submit-based one" with: `# TODO a delete queued behind a long download holds
  the HTTP request; consider fire-and-forget with a notification event.` Keep
  the race-condition TODO but note it is narrowed because delete and download
  now share the single worker.

### 8 `scheduler_lock` must not be held across awaits

`domain/experiment/service.py::update_schedule` and `delete_schedule` take the
`threading.Lock` `scheduler_lock` on the event loop (blocking up to 3 s) and
hold it across several awaits.

- Move the locked parts into synchronous functions (for example
  `_update_schedule_sync`, `_delete_schedule_sync`) that acquire
  `scheduler_lock` with `timed_acquire`, call the jobs-DB helpers directly, and
  call `prod_scheduler()`.
- Call them from the async functions with
  `execution_manager.awaitable_submit(ConcurrentPools.General, TaskName(...), partial(...))`.
- Keep the trailing read (`list_experiment_definitions`) outside the lock via
  `await_jobs_db`.
- Preserve the raised exceptions (`SchedulerBusy`, `ExperimentNotFound`,
  `ValueError` for invalid cron) -- they propagate through
  `awaitable_submit`.
- Remove the two "TODO rework the whole update to run in a pool" comments.
- Also add a rule to `backend/development.md` (task 12): never hold a
  `threading` lock across an `await`.

### 9 Monitored fire-and-forget submissions

Switch these from `submit_unmonitored` (whose future is dropped) to
`submit_monitored`, and update their docstrings:

- `domain/run/stop.py::submit_stop_cascade`
- `domain/gateway/service.py::submit_stop_gateway`

### 10 Import `ConcurrentPools` from `utility/config.py`

Change the imports in `entrypoint/initializers.py`, `domain/artifact/manager.py`,
`domain/plugin/submit.py`, `domain/plugin/store.py` from
`forecastbox.utility.concurrency.manager` to `forecastbox.utility.config`.

### 11 Smaller code fixes and comments (from review)

- R-3 `entrypoint/initializers.py`: create the barrier futures
  (`ArtifactsCatalogInitialized`, `PluginsCatalogInitialized`,
  `GatewayInitialized`, `SchedulerPrerequisitesMet`) inside
  `build_initializers` instead of at module import, and wire
  `_forward_all_to_barrier` there too; bind them to the step functions with
  `functools.partial` or closures (`_register_scheduler` needs the scheduler
  gate). Result: no import-time side effects, and a lifespan can run more than
  once per process. Keep them as entrypoint-local glue (no `submit_after_all`
  in the manager). Replace the comment "TODO rework into better alignment with
  execution manager / initializers ... we dont want to consume a thread by
  awaiting on a future" with a NOTE stating that the barriers are deliberately
  entrypoint-local and resolve via done-callbacks without occupying a thread.
- R-4 Async routes calling sync helpers that take a `threading.Lock` with
  `timed_acquire` block the loop under contention. For each helper below,
  shrink the critical section to the minimum needed and preserve snapshot
  consistency:
  - where only one pyrsistent reference is read, read it lock-free;
  - where several references must be read consistently (they are swapped
    together under the lock by a writer), keep the lock but only for capturing
    the references, and do all derived work (building lists/DTOs) after
    releasing it;
  - writers (check-then-set) keep their lock.

  Helpers: `domain/artifact/manager.py::list_models` and `get_model_details`
  (read `catalog` and `artifact_status`, which `refresh_catalog` publishes
  together: capture both under the lock, build outside);
  `submit_artifact_download` (writer, keep);
  `domain/plugin/status.py::catalogue_view` (single `PluginManager.plugins`
  reference: lock-free, keep the signature);
  `domain/plugin/detail.py::build_plugin_listing` (reads `plugins` and
  `errors`, which `domain/plugin/state.py` publishes together under the lock:
  already capture-only, keep as is). Before making
  any read lock-free, check the writers in the same module to confirm the read
  does not need a consistent multi-field snapshot.
- R-5 `domain/gateway/service.py::shutdown_processes`: add a TODO to the code:
  `# TODO this is async but performs blocking calls (stop_gateway, up to 15s)
  on the event loop; acceptable at shutdown, address later.`
- R-7 `domain/maintenance/garbage_collector.py::garbage_collector_entrypoint`
  and `domain/experiment/scheduling/runtime.py::scheduler_entrypoint`: clear
  the class-level `wake` event at the start of the entrypoint, so a stale wake
  from a previous stop request does not cause an immediate iteration after a
  restart.
- R-9 `utility/config.py::ConcurrencySettings.validate_runtime`: replace the
  `# TODO this actually can be default pydantic validator, not needed to be
  runtime-only` comment with a NOTE: `# NOTE dont migrate this to a pydantic
  validator -- config = FIABConfig() is constructed at import of this module,
  so a validation failure would crash every importer (backend, cli, warmup,
  tests) at import time, before logging is set up and without the aggregated
  error report that validate_runtime provides.` (see question at the end)
- R-10 Remove the unused `utility/db.py::queryCount`.
- C-2 Remove the `_current_dispatcher()` indirection in `utility/dispatcher.py`
  and use the module-level `_dispatcher` directly in the module functions. A
  search of `backend/`, `cli/` and tests found no reassignment of
  `execution_manager` or `_dispatcher` (the module imports the
  `execution_manager` name at import, so a later reassignment would not be
  observed anyway). Keep `async_submit_event` and `EventDispatcher.async_submit`
  (kept for completeness, future use expected).

### 12 Stale docstrings, comments and guidance

- `domain/plugin/state.py` module docstring refers to `domain.plugin.manager`,
  which no longer exists (now `submit.py`, `loading.py`, `state.py`, ...).
- `schemata/jobs.py` docstring refers to `entrypoint/app.py` for schema
  discovery; it is `entrypoint/initializers.py::start_db_schema`. Point its
  "TODO for later: implement garbage collection" to `domain/maintenance`.
- `domain/notification/dispatchers.py` refers to
  `entrypoint.app._discover_dispatchers`; it is
  `entrypoint.initializers._discover_dispatchers`.
- `backend/development.md`, "Concurrency Considerations":
  - replace "scheduler thread, plugin thread, artifact pool, event dispatcher,
    ..." with the current list: managed threads (event dispatcher, scheduler,
    database garbage collector) and named pools (`ConcurrentPools`);
  - the jobs lock is `utility/db.py::lock`, not `dbLock` (`dbLock` is the
    users-DB lock in `domain/auth/db.py`);
  - add: `submit_monitored` vs `submit_unmonitored` (who owns the failure);
    stage meaning (0 infrastructure, 1 producers, 2 maintenance); status is
    exposed under `/api/v1/status` -> `concurrency`; the notification
    broadcaster is the only adapter holding the event loop; never hold a
    `threading` lock across an `await`;
  - next to the event dispatcher bullet, add: for a synchronous one-to-one call
    against the domain hierarchy, use a hook injected by the entrypoint at
    initialization (example: plugin template hooks, task 1), not the event bus;
  - add a pointer to the warmup NOTE from task 1.
- `docs/developer/changeSpecs/overallReviewState.md`: bullet "DB access /
  concurrency" describes the old async lock and `plugin/manager.py`; bullet
  "hierarchy-breaching imports inside functions in domain.plugin" is resolved.
  Update the first to the current model and drop the second.

### 13 Mark the top-level `scheduler` status field for removal

Do not remove it yet. In `routes/status.py::StatusResponse`, replace the
existing TODO on `scheduler` with: `# TODO remove, superseded by
concurrency.threads.scheduler. Must be done in sync with the frontend
(frontend/src/types/status.types.ts, frontend/src/components/common/StatusDetailsPopover.tsx)
and backend/tests/integration/test_schedule.py; when scheduling is disabled the
thread entry is absent, which clients must treat as "off".` Mention in the
docstring of `domain/experiment/scheduling/runtime.py::status_scheduler` that it
exists only for this field.

### 14 Close out the change-spec documents

Per `docs/developer/changeSpecs/README.md`, once the tasks above are done, a
human deletes the `backend-concurrencyRework-*.md` files, including this one.

### 15 Unit tests for the runtime

There are no dedicated unit tests for `ExecutionManager` / `ManagedPool`. Add
`backend/tests/unit/utility/test_execution_manager.py` covering at least:
bounded admission (`SubmissionRejected` when `max_pending` reached), same-pool
reentrancy rejection, coroutine rejection, stage ordering of start and of
`stop_threads`/`shutdown`, a raising `stop_request` not aborting shutdown,
`submit_after` with a failed dependency, `status()` counters,
`unregistered_threads` excluding pool workers, pool `healthy`, and thread
`native_id`. Use local `ExecutionManager` instances, not the module-level one.

## Outdated information in the original documents

For readers who end up in the original design/migration documents. In all
cases below the current codebase is kept as is.

- The "Current concurrency inventory" table in the migration plan is entirely
  historical: `domain/plugin/manager.py`, `SchedulerThread`, `stores_updater`,
  `join_*` helpers, `start_scheduler`/`stop_scheduler`, `Globals.scheduler`, the
  jobs `asyncio.Lock`, and `run_async` no longer exist.
- Lifespan code is in `entrypoint/initializers.py` (using `utility/initializer.py`),
  not in `entrypoint/app.py`.
- Events are `Event(name, payload)` routed by payload type
  (`DispatcherRegistration.handler_type`, `isinstance`, including
  `runtime_checkable` protocols); `Event.name` is observability only. There is no
  `kwargs` and no `event_name` routing.
- `ActiveWebsocketClientRegistry` / `notification.emitted` were replaced by a
  real websocket broadcaster (`domain/notification/service.py`,
  `routes/notification.py`); the maintenance thread emits no notification.
- The maintenance thread runs every 3 hours and has an admin trigger; it uses
  `NEVER_RESTART`.
- `RestartPolicy` has no `minimum_interval_seconds`; `restart_thread` has
  `reset_restart_count`, used by the admin scheduler restart route.
- `submit_after` returns a `Future`; `await_jobs_db` and
  `startup_timeout_seconds` exist; status DTOs are frozen pydantic models.
- General pool default is 4 workers; `ArtifactIo` and `PluginManagement` are
  validated to one worker. Some pool choices differ from the suggestions (cascade
  probe on `General`; run logs: gateway fetch on `General`, zip on `Io`).
- Group-of-futures continuation exists as entrypoint-local barriers, not in
  the manager.
- Plugin template reactions: the planned events (`plugin.templates.changed` /
  `removed`) were implemented and are being replaced by an injected hook
  (task 1).
- Fair-share shutdown budgeting and route-level submission gates are dropped.
- The design says "No open design questions remain"; the warmup breakage
  (task 1) and the blocking notification bridge (task 5) showed otherwise.

## Outstanding questions

- Q-1 (task 11, R-9) The NOTE wording gives my reasoning for not moving
  `ConcurrencySettings.validate_runtime` into a pydantic validator (the
  module-level `config = FIABConfig()` would raise at import time in every
  importer, without the aggregated report). Please confirm this is the reason
  you had in mind, or give the intended one.
