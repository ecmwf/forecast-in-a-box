# Backend concurrency rework: Phase 6 implementation plan

## Purpose and scope

Add a periodic jobs-database maintenance thread as a lifecycle proof of
concept: a second, independent long-lived thread owned by the
`ExecutionManager`, registered as
`ConcurrentThreads.DatabaseGarbageCollector` at stage 2, that wakes every 10
minutes, runs one simple read-only jobs-DB query directly on its own thread
(under the shared jobs lock), records the result in its component status, and
sleeps again.

This is **not** garbage collection. Do not delete rows, design retention or
eligibility rules, traverse cascades, batch, or discover per-domain cleanup
callables. Those belong to a later specification. Do not add configuration
fields, an admin "run now" route, or a restart route.

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
   entrypoint only registers it.
2. **Query: one new read-only helper in `domain/blueprint/db.py`.** Blueprint
   is the clearest example of versioned, tombstoned rows, so a summary of its
   rows is the natural input for future GC. A single aggregate `SELECT`:

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
3. **No `stop_request`.** The thread only ever waits on the manager's stop
   event (`stop_event.wait(interval)`), which the manager sets before calling
   any stop request, so a separate wake mechanism would be redundant. Pass
   `stop_request=None`.
4. **First query immediately on start**, then every 10 minutes. This makes the
   PoC observable in status (and in integration tests) without waiting 10
   minutes; the query is trivial.
5. **Query failures do not kill the thread.** Catch `Exception` around the
   query, log it, record it in the status, and continue on the normal
   interval. Only programming errors outside the guarded call end the thread
   (recorded by the manager).
6. **Restart policy:** `RestartPolicy(max_restarts=3)`. Nothing calls
   `restart_thread` for this thread in this phase; the policy only documents
   that it is restartable by explicit request if a later admin operation is
   added.

## Implementation steps

### 1. Blueprint DB helper

Add `BlueprintStorageSummary` and `summarize_blueprint_storage()` to
`domain/blueprint/db.py` as described above. Follow the style of
`count_blueprints` (inner `function(i: int)`, `_jobs_module.sync_session_maker()`,
`dbRetry(function)`).

### 2. `domain/maintenance/` package (new)

`domain/maintenance/__init__.py` - docstring only:

> Periodic jobs-database maintenance. Currently a proof of concept: a managed
> long-lived thread that periodically runs a read-only summary query and
> exposes the result in its status. Real garbage collection (retention,
> deletion, cascades) is not implemented yet.
>
> Depends on the Blueprint domain (storage summary query). Depended on by no
> other domain; registered by the entrypoint.

`domain/maintenance/garbage_collector.py`:

```python
GC_INTERVAL_SECONDS = 10 * 60
GC_RESTART_POLICY = RestartPolicy(max_restarts=3)


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
    status: GarbageCollectorStatus = GarbageCollectorStatus(state=GarbageCollectorState.stopped)
```

Functions:

- `_publish(**changes)` - reference swap via `model_copy(update=changes)`;
  only the collector thread writes.
- `_run_once() -> None`:
  1. `now = current_time("liveness")`; publish `querying`,
     `last_attempt_at=now`;
  2. `try: summary = summarize_blueprint_storage()`;
     on `Exception as e`: `logger.exception(...)`, publish
     `last_failure=repr(e)`; else publish `last_result=summary`,
     `last_success_at=current_time("liveness")`, `last_failure=None`, and log
     the summary at debug level.
- `garbage_collector_entrypoint(stop_event: threading.Event) -> None`:

  ```python
  try:
      while not stop_event.is_set():
          _run_once()
          _publish(state=GarbageCollectorState.idle,
                   next_wake_at=current_time("liveness") + dt.timedelta(seconds=GC_INTERVAL_SECONDS))
          stop_event.wait(GC_INTERVAL_SECONDS)
  finally:
      _publish(state=GarbageCollectorState.stopped, next_wake_at=None)
  ```

  The entrypoint is re-entrant: a restart starts a new loop from the current
  status (history fields are kept).
- `garbage_collector_status() -> GarbageCollectorStatus` - status provider,
  returns `GarbageCollectorRuntime.status`; no I/O, no lock.

Readiness: the first `_publish(state=querying, ...)` makes the thread ready
immediately, so `execution_manager.start()` does not wait for the query.

Module docstring: "Proof-of-concept periodic maintenance thread owned by
`ExecutionManager` (stage 2, so it starts after and stops before the
scheduler). Calls a locked jobs-DB helper directly on its own thread; the
session is created and closed inside the helper. No rows are modified."

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
    stage=2,
    restart_policy=GC_RESTART_POLICY,
)
```

Registered unconditionally (no config flag). Shutdown needs no extra step: the
`execution_runtime` initializer's `execution_manager.shutdown()` stops stage 2
first. If `_start_execution_runtime` is getting long, extract
`_register_threads()` holding the dispatcher, scheduler and collector
registrations; keep it a flat sequence of calls (Phase 8 will consolidate).

### 4. Documentation

- `backend/development.md`, "Concurrency Considerations": the opening
  paragraph already lists "database garbage collector" among the background
  threads; add "(currently a read-only proof of concept in
  `domain/maintenance`)".
- No route or frontend change.

## Tests and validation

Unit tests (`tests/unit/domain/maintenance/test_garbage_collector.py`; reset
`GarbageCollectorRuntime.status` in a fixture):

1. `summarize_blueprint_storage` on an in-memory DB (reuse the
   `sync_session_maker` monkeypatch pattern from
   `tests/unit/domain/blueprint/test_blueprint_db.py`): empty table gives all
   zeros; two versions of one blueprint plus one deleted blueprint give the
   expected counts.
2. Entrypoint with `summarize_blueprint_storage` monkeypatched to a counter,
   run on a plain test thread: after the first call the status is `idle`
   with `last_result`, `last_success_at`, and `next_wake_at` set; setting the
   stop event makes the thread return promptly (join with a 1-2 s timeout)
   and the status becomes `stopped`. Monkeypatch `GC_INTERVAL_SECONDS` to a
   large value so only one iteration runs.
3. A failing query records `last_failure`, keeps `last_success_at` unchanged,
   and the thread keeps running (still alive before the stop event is set).

Integration test (`tests/integration`, e.g. in `test_db_startup.py` or a new
`test_maintenance.py`): poll `GET /status` until
`concurrency.threads["database-garbage-collector"]` has `alive: true`,
`stage: 2`, and `component_status.last_success_at` not null; assert
`component_status.last_result.total_rows >= 0`. This proves the third managed
thread starts, uses the jobs lock alongside the scheduler and pools, and
reports unified status.

Manual check: stop the backend and verify from the logs that shutdown stops
the collector before the scheduler (stage 2 before stage 1) without waiting
for the 10-minute interval.

Then `just val` and `uv run prek`.

## Completion criteria

- `concurrency.threads` in `/status` contains `database-garbage-collector`
  with a populated component status shortly after startup.
- The collector never modifies the database.
- No new config fields, routes, or threads outside the manager.

## Outdated information in the original documents

- The migration calls this a "lifecycle and DB-pool proof of concept"; the
  thread does not use `ConcurrentPools.JobsDb` (synchronous threads call
  jobs-DB helpers directly under the jobs lock, per the delivered Phase 2
  rules). It is a lifecycle and jobs-lock proof of concept.
- The migration asks for "a stop request that wakes its sleep condition". With
  the delivered manager (stop event set before any stop request), waiting on
  the stop event is sufficient; a separate stop request would be redundant.
- The migration's Phase 7 says to extend this PoC to emit a
  `notification.emitted` event after each query. Phase 7 was delivered as a
  real websocket notification system (`domain/notification`), where any
  emitted `ClientNotificationSource` payload is pushed to every connected
  client. Emitting from this thread would show a client notification every 10
  minutes, so this plan does not emit anything (see open question 1).
- The design's `ActiveWebsocketClientRegistry` does not exist; its role is
  played by `domain/notification/service.py`.

## Open questions

1. **Notification emission.** Should the collector emit anything through the
   event dispatcher? This plan says no, because the delivered notification
   path would broadcast to clients. If a dispatcher round trip is still
   wanted as part of the PoC, it should be a non-notification event with no
   handler (or a debug-only handler), which proves little; recommend leaving
   it out.
2. **Query choice.** A blueprint row summary is proposed because it is the
   most obvious future GC target. Any other single read-only aggregate (e.g.
   runs by status) would serve equally; confirm blueprint is fine.
3. **Immediate first run.** The plan runs the query at startup rather than
   after the first 10-minute sleep, for observability. Confirm this is
   acceptable (it adds one trivial locked query during startup).
