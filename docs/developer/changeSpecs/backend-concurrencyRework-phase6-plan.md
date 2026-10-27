# Backend concurrency rework: Phase 6 implementation plan

## Purpose and scope

Add a periodic jobs-database maintenance thread as a lifecycle proof of
concept: a further independent long-lived thread owned by the
`ExecutionManager`, registered as
`ConcurrentThreads.DatabaseGarbageCollector` at stage 2, that wakes every 3
hours (or when explicitly triggered by an admin), runs one simple read-only
jobs-DB query directly on its own thread (under the shared jobs lock), records
the result in its component status, and sleeps again. It does not run during
startup.

This is **not** garbage collection. Do not delete rows, design retention or
eligibility rules, traverse cascades, batch, or discover per-domain cleanup
callables. Those belong to a later specification. Do not add configuration
fields, a restart route, or any client notification. The only new route is an
admin trigger (`POST /admin/triggerCleanup`), which exists so integration
tests (now, and for the future real cleanup) do not depend on timing.

### Original design references

Look at these original files only if you encounter an unexpected situation.
This plan is self-contained and implementation should not normally require
reading them.

- [`backend-concurrencyRework-design.md`](backend-concurrencyRework-design.md) (section "Periodic database maintenance")
- [`backend-concurrencyRework-migration.md`](backend-concurrencyRework-migration.md) (section "Phase 6: add a periodic jobs database maintenance PoC")
- [`backend-concurrencyRework-phase4-plan.md`](backend-concurrencyRework-phase4-plan.md) (the scheduler migration, the closest template for this phase)

## Delivered baseline you can rely on

All paths below are relative to `backend/src/forecastbox/`.

- `utility/concurrency/manager.py`: module-level `execution_manager` with
  `register_thread(thread_name, entrypoint, *, status_provider, stop_request=None, stage, restart_policy=NEVER_RESTART)`
  (only before/during `start()`), `RestartPolicy(max_restarts)`,
  `StatusModel` (frozen `FiabBaseModel` base for status DTOs). During
  `start()` the manager starts each stage's threads and polls their
  `status_provider()` until `is_ready()` is `True`. On shutdown, threads are
  stopped in descending stage order: the manager sets the thread's stop event,
  calls `stop_request(remaining)` if given, then joins. After Phase 4, a
  restarted thread's previous failure is cleared from its record and uncaught
  exceptions are logged by the manager.
- `ConcurrentThreads.DatabaseGarbageCollector = "database-garbage-collector"`
  already exists in `utility/config.py`.
- `entrypoint/initializers.py::_start_execution_runtime` registers pools, the
  stage-0 event dispatcher and (Phase 4) the stage-1 scheduler, then calls
  `execution_manager.start(...)`. It runs right after the DB schema creation,
  so the jobs DB is ready when stage-2 threads start.
- Jobs-DB helpers (`domain/*/db.py`) are synchronous, wrap their work in
  `utility/db.py::dbRetry` (the jobs `threading.RLock` + SQLite retry), open
  and close their session inside, and return plain dataclasses. Synchronous
  threads call them directly; never through `await_jobs_db`.
- Phase 4 scheduler (`domain/experiment/scheduling/runtime.py`) is the
  reference for module shape: a `StatusModel` with `is_ready()`, a namespace
  class holding the current immutable status, a `_publish(**changes)` helper
  using `model_copy(update=...)`, and an entrypoint taking the manager's stop
  event.
- `GET /api/v1/status` already returns `concurrency.threads[<name>]` for every
  registered thread, including its `component_status`.

## Design decisions

1. **Location: a new `domain/maintenance/` package.** The thread is business
   code that will later grow into real garbage collection across several
   domains (so it sits above them in the domain hierarchy); it is not
   general-purpose utility code and is not entrypoint bootstrapping. The
   entrypoint only registers it; `routes/admin.py` only triggers it.
2. **Query: one new read-only helper in `domain/blueprint/db.py`.** Blueprint
   is the clearest example of versioned, tombstoned rows:

   ```python
   @dataclass(frozen=True, eq=True, slots=True)
   class BlueprintStorageSummary:
       total_rows: int        # all (blueprint_id, version) rows
       deleted_rows: int      # rows with is_deleted
       distinct_blueprints: int


   def summarize_blueprint_storage() -> BlueprintStorageSummary:
       """Return row counts of the blueprint table, for periodic maintenance reporting. Read-only."""
   ```

   Implement with one statement:
   `select(func.count(), func.sum(case((Blueprint.is_deleted.is_(True), 1), else_=0)), func.count(func.distinct(Blueprint.blueprint_id)))`
   inside `dbRetry`, coalescing `None` to `0` (empty table). No auth context:
   this is an internal, non-user-facing query; say so in the docstring.
3. **Interval: 3 hours, hardcoded** in one named module constant
   `CLEANUP_INTERVAL_SECONDS = 3 * 60 * 60`. Not in `utility/config.py`.
4. **No run at startup.** The first run happens one interval after the thread
   starts, or earlier when triggered. Startup is a busy period and nothing
   unnecessary should run then.
5. **Wake event + stop request.** The thread sleeps on a domain-owned
   `threading.Event` (`wake`), which is set by the admin trigger and by the
   registered `stop_request`. Same pattern as the Phase 4 scheduler: clear the
   event *before* each run, so a trigger arriving mid-run causes one more run
   instead of being lost.
6. **Query failures do not kill the thread.** Catch `Exception` around the
   query, log it, record it in the status, and continue on the normal
   interval. Only programming errors outside the guarded call end the thread
   (recorded by the manager).
7. **Restart policy: the default `NEVER_RESTART`.** No automated restarts and
   no restart route in this phase.
8. **Silent.** No events, no client notifications; results are only logged at
   debug level and exposed in status.

## Implementation steps

### 1. Blueprint DB helper

Add `BlueprintStorageSummary` and `summarize_blueprint_storage()` to
`domain/blueprint/db.py` as described above. Follow the style of
`count_blueprints` (inner `function(i: int)`, `_jobs_module.sync_session_maker()`,
`dbRetry(function)`).

### 2. `domain/maintenance/` package (new)

`domain/maintenance/__init__.py` - docstring only:

> Periodic jobs-database maintenance. Currently a proof of concept: a managed
> long-lived thread that periodically (or on admin trigger) runs a read-only
> summary query and exposes the result in its status. Real garbage collection
> (retention, deletion, cascades) is not implemented yet.
>
> Depends on the Blueprint domain (storage summary query). Depended on by no
> other domain; registered by the entrypoint, triggered by `routes/admin.py`.

`domain/maintenance/exceptions.py`:

```python
class CleanupNotRunning(Exception):
    """Raised when a cleanup is triggered while the maintenance thread is not running."""
```

`domain/maintenance/garbage_collector.py`:

```python
CLEANUP_INTERVAL_SECONDS = 3 * 60 * 60


class GarbageCollectorState(StrEnum):
    idle = "idle"
    querying = "querying"
    stopped = "stopped"


class GarbageCollectorStatus(StatusModel):
    state: GarbageCollectorState
    last_attempt_at: dt.datetime | None = None
    last_success_at: dt.datetime | None = None
    next_wake_at: dt.datetime | None = None
    last_result: BlueprintStorageSummary | None = None
    last_failure: str | None = None

    def is_ready(self) -> bool:
        return self.state in (GarbageCollectorState.idle, GarbageCollectorState.querying)


class GarbageCollectorRuntime:
    wake: threading.Event = threading.Event()
    status: GarbageCollectorStatus = GarbageCollectorStatus(state=GarbageCollectorState.stopped)
```

Functions:

- `_publish(**changes)` - reference swap via `model_copy(update=changes)`;
  only the collector thread writes the status.
- `_run_once() -> None`:
  1. publish `querying`, `last_attempt_at=current_time("liveness")`;
  2. `try: summary = summarize_blueprint_storage()`;
     on `Exception as e`: `logger.exception(...)`, publish
     `last_failure=repr(e)`; else publish `last_result=summary`,
     `last_success_at=current_time("liveness")`, `last_failure=None`, and log
     the summary at debug level.
- `garbage_collector_entrypoint(stop_event: threading.Event) -> None`:

  ```python
  try:
      while not stop_event.is_set():
          _publish(state=GarbageCollectorState.idle,
                   next_wake_at=current_time("liveness") + dt.timedelta(seconds=CLEANUP_INTERVAL_SECONDS))
          GarbageCollectorRuntime.wake.wait(CLEANUP_INTERVAL_SECONDS)
          if stop_event.is_set():
              break
          GarbageCollectorRuntime.wake.clear()
          _run_once()
  finally:
      _publish(state=GarbageCollectorState.stopped, next_wake_at=None)
  ```

  Note the order: sleep first (no run at startup), clear the wake event
  before the run (a trigger during the run causes one more run).
  The entrypoint is re-entrant: a later restart would start a new loop from
  the current status (history fields are kept).
- `garbage_collector_stop_request(timeout: float) -> None` - sets
  `GarbageCollectorRuntime.wake` (the manager has already set the stop
  event).
- `garbage_collector_status() -> GarbageCollectorStatus` - status provider,
  returns `GarbageCollectorRuntime.status`; no I/O, no lock.
- `trigger_cleanup() -> None` - raises `CleanupNotRunning` unless the state is
  `idle` or `querying`; otherwise sets `GarbageCollectorRuntime.wake`. In-memory
  and non-blocking, so it may be called directly from async code.

Readiness: the first `_publish(state=idle, ...)` makes the thread ready
immediately, so `execution_manager.start()` does not wait.

Module docstring: "Proof-of-concept periodic maintenance thread owned by
`ExecutionManager` (stage 2, so it starts after and stops before the
scheduler). Runs every `CLEANUP_INTERVAL_SECONDS` or when triggered, never at
startup. Calls a locked jobs-DB helper directly on its own thread; the
session is created and closed inside the helper. No rows are modified and
nothing is emitted."

The `StatusModel` field `last_result: BlueprintStorageSummary | None` holds a
stdlib frozen dataclass; pydantic serializes it as an object. If `ty` or
pydantic objects to it, store the three counts as separate `int | None`
fields instead - do not convert `BlueprintStorageSummary` into a pydantic
model (db.py returns dataclasses by convention).

### 3. Registration (`entrypoint/initializers.py`)

In `_start_execution_runtime`, after the scheduler registration (Phase 4) and
before `execution_manager.start(...)`:

```python
execution_manager.register_thread(
    ConcurrentThreads.DatabaseGarbageCollector,
    garbage_collector_entrypoint,
    status_provider=garbage_collector_status,
    stop_request=garbage_collector_stop_request,
    stage=2,
)
```

Registered unconditionally (no config flag). Shutdown needs no extra step: the
`execution_runtime` initializer's `execution_manager.shutdown()` stops stage 2
first. If `_start_execution_runtime` is getting long, extract
`_register_threads()` holding the dispatcher, scheduler and collector
registrations; keep it a flat sequence of calls (Phase 8 will consolidate).

### 4. Admin trigger route (`routes/admin.py`)

```python
@router.post("/triggerCleanup")
async def trigger_cleanup_endpoint(admin: UserRead | None = Depends(get_admin_user)) -> None:
    """Wake the periodic database maintenance thread to run now. Returns once the run is
    requested, not when it completes; observe completion in GET /status under
    concurrency.threads.database-garbage-collector. Requires admin access."""
    try:
        trigger_cleanup()
    except CleanupNotRunning as e:
        raise HTTPException(status_code=409, detail=str(e))
```

Direct call (no pool submission): `trigger_cleanup` only sets an event. Update
the `routes/admin.py` module docstring to mention the maintenance trigger.

### 5. Documentation

- `backend/development.md`, "Concurrency Considerations": the opening
  paragraph already lists "database garbage collector" among the background
  threads; add "(currently a read-only proof of concept in
  `domain/maintenance`, runs every 3 hours or on `POST /admin/triggerCleanup`)".
- No frontend or CLI change.

## Tests and validation

Unit tests (`tests/unit/domain/maintenance/test_garbage_collector.py`; reset
`GarbageCollectorRuntime.status` and clear `GarbageCollectorRuntime.wake` in a
fixture):

1. `summarize_blueprint_storage` on an in-memory DB (reuse the
   `sync_session_maker` monkeypatch pattern from
   `tests/unit/domain/blueprint/test_blueprint_db.py`): empty table gives all
   zeros; two versions of one blueprint plus one deleted blueprint give the
   expected counts.
2. Entrypoint with `summarize_blueprint_storage` monkeypatched to a counter,
   run on a plain test thread: shortly after start the state is `idle` and the
   query was **not** called; `trigger_cleanup()` causes exactly one call and
   `last_result`, `last_success_at`, `next_wake_at` are set; setting the stop
   event plus calling `garbage_collector_stop_request` makes the thread return
   promptly (join with a 1-2 s timeout) and the state becomes `stopped`.
3. A failing query records `last_failure`, keeps `last_success_at` unchanged,
   and the thread keeps running.
4. `trigger_cleanup()` raises `CleanupNotRunning` when the state is `stopped`.
5. Route: `trigger_cleanup_endpoint` maps `CleanupNotRunning` to 409
   (monkeypatch `trigger_cleanup`).

Integration test (new `tests/integration/test_maintenance.py`):

1. `GET /status`: `concurrency.threads["database-garbage-collector"]` has
   `alive: true`, `stage: 2`, `component_status.state == "idle"`, and
   `component_status.last_attempt_at is None` (nothing ran at startup; this
   holds as long as no other test triggered a cleanup before, so either run
   this assertion only if it is the first trigger in the session or drop it).
2. `POST /admin/triggerCleanup` as admin returns 200; poll `GET /status` until
   `component_status.last_success_at` is set (and later than before the
   trigger, if it was set); assert `last_result.total_rows >= 0`.
3. With the non-admin `backend_client_user` fixture it returns 403 (the
   integration backend runs with `auth.passthrough = False`).

Manual check: stop the backend and verify from the logs that shutdown stops
the collector before the scheduler (stage 2 before stage 1) without waiting
for the interval.

Then `just val` and `uv run prek`.

## Completion criteria

- `concurrency.threads` in `/status` contains `database-garbage-collector`.
- The collector does not run during startup; it runs on trigger and every 3
  hours.
- The collector never modifies the database and emits no events.
- No new config fields and no threads outside the manager; the only new route
  is `POST /admin/triggerCleanup`.

## Outdated information in the original documents

- The design and migration ask for a 10-minute interval, no administrative
  prod, and say nothing about the first run. This plan uses a 3-hour
  interval, no run at startup, and an admin trigger route for timing-independent
  testing.
- The migration calls this a "lifecycle and DB-pool proof of concept"; the
  thread does not use `ConcurrentPools.JobsDb` (synchronous threads call
  jobs-DB helpers directly under the jobs lock, per the delivered Phase 2
  rules). It is a lifecycle and jobs-lock proof of concept.
- The migration recommends an "explicit-only capped restart policy". Since
  Phase 4, explicit restarts bypass the policy (`reset_restart_count=True`),
  and the policy only governs automated restarts, of which there are none;
  the collector uses `NEVER_RESTART`.
- The migration's Phase 7 says to extend this PoC to emit a
  `notification.emitted` event after each query. Phase 7 was delivered as a
  real websocket notification system (`domain/notification`), where any
  emitted `ClientNotificationSource` payload is pushed to every connected
  client. The collector stays silent.
- The design's `ActiveWebsocketClientRegistry` does not exist; its role is
  played by `domain/notification/service.py`.
