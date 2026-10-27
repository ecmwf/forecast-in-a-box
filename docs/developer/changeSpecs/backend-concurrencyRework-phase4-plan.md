# Backend concurrency rework: Phase 4 implementation plan

## Purpose and scope

Replace the ad hoc `SchedulerThread` (a `threading.Thread` subclass stored in
`Globals.scheduler`) with a long-lived thread owned by the central
`ExecutionManager`, registered as `ConcurrentThreads.Scheduler` at stage 1.
After this phase:

- no `threading.Thread` is created by domain code;
- the scheduler is started by `ExecutionManager.start()`, stopped by the
  manager (or by an explicit `stop_thread`), and restarted only through the
  explicit admin route;
- the startup prerequisite wait (plugins loaded + gateway up) no longer
  occupies a `ConcurrentPools.General` worker;
- scheduler detail is visible under `concurrency.threads.scheduler` in
  `GET /api/v1/status`.

The scheduling *business logic* (which experiments are due, how runs are
submitted, how the next run is computed) does not change.

Out of scope: the event-based plugin/blueprint decoupling (Phase 5), the
database maintenance thread (Phase 6), and the final startup/shutdown/status
consolidation of `entrypoint/initializers.py` (Phase 8).

### Original design references

Look at these original files only if you encounter an unexpected situation.
This plan is self-contained and implementation should not normally require
reading them.

- [`backend-concurrencyRework-design.md`](backend-concurrencyRework-design.md) (sections "Long-lived threads", "Lifecycle", "Status")
- [`backend-concurrencyRework-migration.md`](backend-concurrencyRework-migration.md) (section "Phase 4: migrate the scheduler thread")

## Delivered baseline you can rely on

All paths below are relative to `backend/src/forecastbox/`.

- `utility/concurrency/manager.py` exposes the module-level `execution_manager`
  with:
  - `register_thread(thread_name, entrypoint, *, status_provider, stop_request=None, stage, restart_policy=NEVER_RESTART)`,
    allowed only before/during `start()`;
  - `start(timeout=...)`: per stage, starts pools, then threads, then polls each
    thread's `status_provider()` until it returns a model whose `is_ready()` is
    `True` (or the thread dies, or the startup deadline passes);
  - `stop_thread(thread_name, *, timeout)`: sets the thread's stop event, calls
    its `stop_request(remaining)`, joins; idempotent for a dead thread,
    `KeyError` for an unregistered one;
  - `restart_thread(thread_name)`: only in lifecycle `running`, only for a dead
    thread, only while `restart_count < restart_policy.max_restarts`; raises
    `LifecycleError` otherwise; starts a *new* `threading.Thread` from the same
    registered entrypoint with a *new* stop event;
  - `status()` returning `ExecutionStatus` with `threads[name]: ThreadStatus`
    (alive, ready, `component_status`, started/stopped timestamps,
    `uncaught_exception`, `traceback`, `restart_count`, `restart_limit`), and
    `healthy` = running and no thread has a recorded `uncaught_exception`;
  - `RestartPolicy(max_restarts: int)` (no minimum-interval field).
- Status providers must return a `StatusModel` (frozen `FiabBaseModel`) that
  has an `is_ready() -> bool` method; see `ComponentStatus` and
  `utility/dispatcher.py::DispatcherStatus` for examples.
- `ConcurrentThreads.Scheduler = "scheduler"` already exists in
  `utility/config.py`.
- Jobs-DB helpers are synchronous and lock internally; the scheduler thread
  already calls them directly (`domain/experiment/scheduling/db.py`,
  `job_utils.experiment2runnable`, `domain/run/service.submit_run_sync`).
  Do not route them through `await_jobs_db` from the thread.
- `entrypoint/initializers.py` is an ordered list of `Initializer(name, start, stop)`
  steps; `shutdown()` unwinds the started steps in reverse order. The
  `execution_runtime` step (second step) registers pools and the event
  dispatcher and calls `execution_manager.start()`; its `stop` calls
  `execution_manager.shutdown()`.
- `ExecutionManagerError` (incl. `LifecycleError`) is mapped to a generic 503 by
  `utility/fastapi.py`; routes may catch more specific cases first.

## Current state (what you are replacing)

`domain/experiment/scheduling/background.py`:

- `SchedulerThread(threading.Thread)` with `stop_event`, a
  `threading.Condition` for sleeping/prodding, and a liveness timestamp;
- `_try_schedule()` - one scheduling iteration, returns the sleep duration;
- `run()` - loop: acquire `scheduler_lock` (60 s timeout), `_try_schedule()`,
  sleep on the condition;
- module functions `start_scheduler(start_after=None)` (blocks on the
  prerequisite future, then creates/starts the thread), `stop_scheduler()`
  (join with 1 s), `prod_scheduler()`, `status_scheduler() -> "off"|"down"|"up"`,
  and the `Globals.scheduler` holder;
- `scheduler_lock` plus `timeout_acquire_*` constants, also used by
  `domain/experiment/service.py`.

Callers:

- `entrypoint/initializers.py`: the `scheduler` initializer (only when
  `config.backend.allow_scheduler`) submits `_await_scheduler_prereqs` to
  `ConcurrentPools.General` (blocks a worker on `PluginsCatalogInitialized`
  and `GatewayInitialized`), then calls `start_scheduler` in a done-callback;
  its stop calls `stop_scheduler()`.
- `routes/experiment.py::restart_scheduler` calls `stop_scheduler()` and
  `start_scheduler()` directly on the event loop (marked
  `TODO(concurrency phase 4)`).
- `routes/status.py` calls `status_scheduler()` for the top-level `scheduler`
  field.
- `domain/experiment/service.py` imports `prod_scheduler`, `scheduler_lock`,
  `timeout_acquire_request`.

Known defects in the current code, fixed as part of this phase:

1. The liveness check uses `dt.timedelta(minutes=sleep_duration_min)` while
   `sleep_duration_min` is in seconds (`15 * 60`), so "stale" means 30 hours
   instead of 30 minutes. The constant is also misnamed: it is the *maximum*
   sleep.
2. `prod()` uses `Condition.notify()`; a prod that arrives while the thread is
   not waiting (e.g. mid-iteration) is lost.
3. The background lock acquisition waits up to 60 s and is not wakeable, which
   can exceed the shutdown budget.
4. `logger.error("Skipping {experiment_id} at {scheduled_at}: ...")` is
   missing the `f` prefix.

Known defect that is **not** fixed in this phase (only marked with a TODO,
see step 5): async request paths in `domain/experiment/service.py` acquire the
*threading* `scheduler_lock` with a 3 s blocking timeout *on the event loop*
and then hold it across `await`s. A second concurrent request then blocks the
whole loop for up to 3 s (the first request cannot make progress while the
loop thread is blocked), and a scheduler iteration holding the lock blocks
the loop the same way. Keep the 3 s timeout; changing it would change
behaviour.

## Target module layout

```text
domain/experiment/scheduling/
    background.py   # scheduling iteration + scheduler_lock (no thread code)
    runtime.py      # NEW: managed-thread glue: entrypoint, wake, gate, status, restart
```

`background.py` keeps only business logic and the lock that protects the
schedule tables. `runtime.py` is the only module that knows about
`ExecutionManager`/threads. Keep `runtime.py` small (~150 lines).

## Implementation steps

### 1. `scheduling/background.py`: iteration only

1. Delete `SchedulerThread`, `Globals`, `start_scheduler`, `stop_scheduler`,
   `prod_scheduler`, `status_scheduler`.
2. Rename `sleep_duration_min` to `max_sleep_seconds` (value unchanged,
   `15 * 60`), keep its explanatory comment (it bounds the sleep so liveness
   can be judged).
3. Change `timeout_acquire_background` to `5` (seconds). The loop retries
   after a failed acquisition, so this only bounds how long a stop request can
   go unnoticed.
4. Turn `_try_schedule` into a module-level function:

   ```python
   def schedule_due_experiments(now: dt.datetime, stop_event: threading.Event) -> float:
       """Submit due scheduled runs, advance their next-run rows, and return the number of
       seconds to sleep before the next iteration (at most max_sleep_seconds)."""
   ```

   Body identical to `_try_schedule`, except:
   - the liveness marking moves to `runtime.py` (the caller passes `now`);
   - before processing each due experiment, `if stop_event.is_set(): break`
     (remaining due rows stay in the DB and are picked up after restart);
   - fix the missing `f` in the "it is not valid" log line.
5. Update the module docstring: "One scheduling iteration and the lock
   protecting the schedule tables. Executed by the managed scheduler thread,
   see `runtime.py`."

### 2. `scheduling/runtime.py` (new)

Contents, in this order:

```python
class SchedulerState(StrEnum):
    waiting_for_prerequisites = "waiting-for-prerequisites"
    prerequisites_failed = "prerequisites-failed"
    scheduling = "scheduling"
    sleeping = "sleeping"
    stopped = "stopped"


class SchedulerStatus(StatusModel):
    state: SchedulerState
    last_iteration_at: dt.datetime | None = None
    next_wake_at: dt.datetime | None = None

    def is_ready(self) -> bool:
        return self.state in (SchedulerState.waiting_for_prerequisites, SchedulerState.scheduling, SchedulerState.sleeping)
```

Module state in one small namespace class (same pattern as
`PluginManager`), all fields swapped by reference only:

```python
class SchedulerRuntime:
    wake: threading.Event = threading.Event()
    start_gate: Future[None] | None = None
    status: SchedulerStatus = SchedulerStatus(state=SchedulerState.stopped)
```

Functions:

- `arm_start_gate(gate: Future[None]) -> None` - stores the gate. Called once
  by the entrypoint before `execution_manager.start()`.
- `scheduler_entrypoint(stop_event: threading.Event) -> None`:
  1. take the gate one-shot: `gate, SchedulerRuntime.start_gate = SchedulerRuntime.start_gate, None`;
  2. if a gate was taken: publish `waiting_for_prerequisites`; wait with
     `while not gate.done(): if stop_event.wait(1.0): return` (publish
     `stopped` on the way out, see the `finally` below); if the gate
     failed or was cancelled, `logger.critical(...)`, publish
     `prerequisites_failed`, and **return normally** (no raise: matches today's
     "log critical, do not start" behaviour and keeps `concurrency.healthy`
     true; the admin restart route can still start it);
  3. loop `while not stop_event.is_set()`:
     - `SchedulerRuntime.wake.clear()` **before** doing the work (a prod during
       the iteration then makes the following wait return immediately, fixing
       defect 2);
     - `now = current_time("liveness")`; publish `scheduling`,
       `last_iteration_at=now`;
     - `with timed_acquire(scheduler_lock, timeout_acquire_background) as acquired:`
       if not acquired, log a warning and `continue`; else
       `sleep_seconds = schedule_due_experiments(now, stop_event)`;
     - publish `sleeping`, `next_wake_at = now + sleep_seconds`;
     - `SchedulerRuntime.wake.wait(sleep_seconds)`;
  4. wrap 2-3 in `try/finally` that publishes `stopped` unless the state is
     `prerequisites_failed`. Exceptions from `schedule_due_experiments` are
     **not** caught: the thread dies, the manager records the exception and
     traceback, and an admin restart is required (today's semantics).
- `scheduler_stop_request(timeout: float) -> None` - sets
  `SchedulerRuntime.wake` (the manager has already set the stop event).
- `scheduler_status() -> SchedulerStatus` - returns `SchedulerRuntime.status`
  (status provider; no I/O, no lock).
- `prod_scheduler() -> None` - sets `SchedulerRuntime.wake`. Not an error when
  the scheduler is disabled or stopped (log at debug level at most).
- `status_scheduler() -> str` - the brief top-level string:
  `"off"` if `not config.backend.allow_scheduler`; `"down"` unless state is
  `scheduling`/`sleeping`; `"down"` if `last_iteration_at` is older than
  `2 * max_sleep_seconds` (fixes defect 1); otherwise `"up"`. Note it reads
  only the domain status; a dead thread always ends in `stopped` through the
  `finally`.
- `restart_scheduler() -> None` - synchronous, meant to run on a pool worker:
  - raise `SchedulerDisabled` (new, in `domain/experiment/exceptions.py`) if
    `not config.backend.allow_scheduler`;
  - `execution_manager.stop_thread(ConcurrentThreads.Scheduler, timeout=SCHEDULER_STOP_TIMEOUT_SECONDS)`
    (module constant, `10.0`);
  - `execution_manager.restart_thread(ConcurrentThreads.Scheduler, reset_restart_count=True)`
    (see step 3: an explicit, human-initiated restart is not limited by the
    restart policy and resets the counter);
  - translate `LifecycleError` into `SchedulerRestartRefused(str(error))`
    (new exception; covers "still alive after stop" and "manager not
    running").

The scheduler is registered with the default `NEVER_RESTART` policy: there
is no automated restart; the only way to restart it is the explicit admin
route.

Use a module-level `_publish(**changes)` helper that does
`SchedulerRuntime.status = SchedulerRuntime.status.model_copy(update=changes)`;
only the scheduler thread writes the status, so no lock is needed (reference
swap of an immutable object).

Module docstring: explain that the thread is owned by `ExecutionManager`, the
wake event, the one-shot start gate and why restarts skip it (an operator who
fixed the gateway after a failed startup must be able to start the scheduler
via the restart route), and that the status is a lock-free snapshot.

### 3. Manager adjustments (`utility/concurrency/manager.py`)

Small changes needed for restartable threads:

1. Extend `restart_thread` with a keyword argument:

   ```python
   def restart_thread(self, thread_name: ConcurrentThreads, *, reset_restart_count: bool = False) -> ThreadStatus:
   ```

   With `reset_restart_count=False` (default) the behaviour is unchanged:
   refuse when `restart_count >= restart_policy.max_restarts`, otherwise
   increment. With `reset_restart_count=True` the restart-policy check is
   skipped and `restart_count` is set to `0`; this is for explicit,
   operator-initiated restarts, which must not be limited by the policy meant
   for automated restarts. All other checks (lifecycle `running`, thread not
   alive, thread registered) still apply. Document both modes in the
   docstring.
2. In `_start_thread`, reset `record.uncaught_exception`, `record.traceback`,
   and `record.stopped_at` to `None` before starting the new thread. Otherwise
   `ExecutionStatus.healthy` stays `False` forever after a successful restart.
3. In the `run()` wrapper, log the uncaught exception
   (`logger.exception(f"managed thread {record.thread_name} failed")`) so the
   failure is not lost when a restart clears the record.
4. No other manager changes. In particular do not add automatic restarts.

### 4. Entrypoint wiring (`entrypoint/initializers.py`)

1. Add a module-level barrier next to the existing ones:

   ```python
   SchedulerPrerequisitesMet: Future[None] = Future()
   ```

   and a small helper `_forward_all_to_barrier(barrier, upstreams: Sequence[Future[None]])`
   that resolves `barrier` with `None` once all upstreams succeeded, or with
   the first failure/cancellation (non-blocking done-callbacks with a
   counter; guard with `barrier.done()` like `_forward_to_barrier`). Wire it
   once: `_forward_all_to_barrier(SchedulerPrerequisitesMet, [PluginsCatalogInitialized, GatewayInitialized])`.
2. In `_start_execution_runtime`, after the dispatcher registration and before
   `execution_manager.start(...)`, call a new helper `_register_scheduler()`:

   ```python
   def _register_scheduler() -> None:
       if not config.backend.allow_scheduler:
           return
       arm_start_gate(SchedulerPrerequisitesMet)
       execution_manager.register_thread(
           ConcurrentThreads.Scheduler,
           scheduler_entrypoint,
           status_provider=scheduler_status,
           stop_request=scheduler_stop_request,
           stage=1,
       )
   ```

   The thread starts during `execution_manager.start()` and is immediately
   ready (`waiting_for_prerequisites`), so startup does not wait for plugins or
   the gateway.
3. Delete `_await_scheduler_prereqs`, `_start_scheduler`, the
   `scheduler.await-prereqs` General submission, and the TODO comment about the
   prerequisite waiter blocking a General worker.
4. Keep a stop-only initializer at the same position in the list so the
   scheduler still stops early during shutdown (before tunnels, processes, and
   the gateway are torn down), rather than only during the final
   `execution_runtime` unwind:

   ```python
   def _stop_scheduler() -> None:
       execution_manager.stop_thread(ConcurrentThreads.Scheduler, timeout=SCHEDULER_STOP_TIMEOUT_SECONDS)

   if config.backend.allow_scheduler:
       initializers.append(Initializer("scheduler", stop=_stop_scheduler))
   ```

   Phase 8 removes this in favour of staged manager shutdown.
5. Update the barrier comment block: it should no longer mention
   `start_scheduler` or a blocked General worker.

### 5. Callers

- `domain/experiment/service.py`: import `prod_scheduler` from
  `scheduling.runtime`, keep `scheduler_lock` from `scheduling.background`.
  Keep `timeout_acquire_request = 3` unchanged. At each of the two
  `with timed_acquire(scheduler_lock, timeout_acquire_request)` sites
  (`update_schedule`, `delete_schedule`) add:

  ```python
  # TODO rework the whole update to run in a pool to not block the loop / not hold the lock for too long
  ```

  Delete `timeout_acquire_lifecycle` from `background.py` (no remaining
  users).
- `routes/experiment.py::restart_scheduler`:

  ```python
  try:
      await execution_manager.awaitable_submit(
          ConcurrentPools.General, TaskName("scheduler.restart"), restart_scheduler
      )
  except SchedulerDisabled as e:
      raise HTTPException(status_code=400, detail=str(e))
  except SchedulerRestartRefused as e:
      raise HTTPException(status_code=409, detail=str(e))
  ```

  Remove the `TODO(concurrency phase 4)` comment. The response stays `None`.
- `routes/status.py`: import `status_scheduler` from `scheduling.runtime`;
  otherwise unchanged. The scheduler's full detail is now automatically
  present under `concurrency.threads.scheduler` (its `component_status` is the
  `SchedulerStatus`). The top-level `scheduler` field stays in the response
  (the frontend and the CLI read it) but is derived from the managed
  thread's status by `status_scheduler()`. Add next to the field in
  `StatusResponse`:

  ```python
  # TODO deprecated field, migrate clients to directly query the managed thread status, then remove this
  ```

### 6. Documentation and docstrings

- `backend/development.md`, "Concurrency Considerations": remove the bullet
  saying the scheduler still uses ad hoc thread creation; the list of
  background threads at the top of that section stays accurate.
- `routes/experiment.py` module docstring: unchanged in substance; the
  operational routes remain.
- `domain/experiment/scheduling/__init__.py` currently has only the licence
  header. Add a short docstring: "Cron scheduling of experiments: `db.py`
  persistence of next-run rows, `background.py` one scheduling iteration,
  `runtime.py` the managed scheduler thread, `job_utils.py`/`dt_utils.py`
  helpers."

## Tests and validation

Unit tests (new `tests/unit/scheduling/test_runtime.py`; reset
`SchedulerRuntime` fields in a fixture):

1. Gate success: run `scheduler_entrypoint` on a plain test thread with a
   pending gate future and `schedule_due_experiments` monkeypatched to return
   `3600`; assert the status is `waiting_for_prerequisites`, resolve the gate,
   assert it reaches `sleeping`; set the stop event + call
   `scheduler_stop_request`, join with a short timeout, assert `stopped`.
2. Gate failure: failed gate -> entrypoint returns without calling
   `schedule_due_experiments`, status `prerequisites_failed`,
   `status_scheduler() == "down"`.
3. One-shot gate: after the entrypoint consumed a failed gate, a second
   entrypoint invocation (simulating restart) proceeds to scheduling.
4. Prod during iteration is not lost: `schedule_due_experiments` fake calls
   `prod_scheduler()` the first time and returns a long sleep; assert a second
   iteration happens promptly.
5. `status_scheduler()`: `"off"` when disabled; `"down"` when
   `last_iteration_at` is older than `2 * max_sleep_seconds`; `"up"` when fresh.
6. Manager restart semantics with a fresh `ExecutionManager(10)` instance (do
   not use the global one; the unit `conftest.py` monkeypatches some of its
   methods): register a thread whose entrypoint raises, start, wait for death,
   assert `healthy is False`; `restart_thread` -> the new run clears
   `uncaught_exception` and `healthy` is `True` again. With
   `RestartPolicy(max_restarts=1)`: a second plain `restart_thread` raises
   `LifecycleError`, while `restart_thread(..., reset_restart_count=True)`
   succeeds and leaves `restart_count == 0`; with `NEVER_RESTART`, a plain
   restart is refused and a reset restart succeeds. Shut the manager down at
   the end.
7. `restart_scheduler()` raises `SchedulerDisabled` when disabled, and maps a
   `LifecycleError` from the manager into `SchedulerRestartRefused`
   (monkeypatch `execution_manager.stop_thread`/`restart_thread`).
8. Update `tests/unit/routes/test_status.py` monkeypatch targets if the import
   location of `status_scheduler` changes the patched attribute (it patches
   `status_route.status_scheduler`, which still works if the route imports
   the name directly).

Integration tests (`tests/integration`, scheduler is enabled in
`conftest.py`):

1. Existing `test_schedule.py` must pass unchanged (it proves the gate opens
   after plugins and gateway are up, and that the thread submits runs).
2. New test: `GET /status` eventually shows `scheduler == "up"`,
   `concurrency.threads.scheduler.alive is True`, and
   `component_status.state in {"sleeping", "scheduling"}`.
3. New test: `POST /experiment/operational/scheduler/restart` as admin
   returns 200, then `GET /status` eventually shows `scheduler == "up"`,
   `concurrency.threads.scheduler.started_at` later than before the restart,
   and `restart_count == 0`; calling it twice in a row succeeds both times
   (no budget); as a non-admin it returns 403.

Then `just val` and `uv run prek`.

## Completion criteria

- `grep -rn "threading.Thread" backend/src/forecastbox/domain` returns nothing.
- No `General` worker is occupied waiting for scheduler prerequisites.
- `Globals.scheduler`, `start_scheduler`, `stop_scheduler`, `SchedulerThread`
  no longer exist.
- The restart route does not join a thread on the event loop.
- `concurrency.threads.scheduler` is present when scheduling is enabled and
  absent otherwise.

## Outdated information in the original documents

- The migration describes the scheduler as storing the FastAPI loop and using
  `run_coroutine_threadsafe`; that was already removed in Phase 2. The
  scheduler already calls `experiment2runnable` and `submit_run_sync`
  directly.
- The design's `RestartPolicy` has `minimum_interval_seconds`; the delivered
  manager has only `max_restarts`. The scheduler uses `NEVER_RESTART` and is
  restarted only through the explicit admin route, which bypasses and resets
  the restart budget (`reset_restart_count=True`), so this plan does not add
  the interval. The migration's "capped on-failure restart" recommendation is
  thereby replaced by "no automated restart, unlimited explicit restarts".
- The design names the status-provider type `ThreadStatusProvider` returning
  `ComponentStatus`; the delivered manager uses `ComponentStatusProvider`
  returning any `StatusModel` with `is_ready()`.
- The migration does not mention the startup prerequisite gating (plugins +
  gateway) that was added later in `entrypoint/initializers.py`; this plan
  preserves it with a one-shot gate.
- The migration says to drop the top-level `scheduler` status field. The
  frontend (`frontend/src/types/status.types.ts`) and the CLI
  (`cli/crates/fiab-lib-client/src/models/status.rs`, a required serde field)
  both read it. It is kept, derived from the managed thread status, and
  marked with a deprecation TODO (step 5).

## Notes

- Iteration failures keep today's semantics: any exception in
  `schedule_due_experiments` ends the thread until an admin restart. Do not add
  per-iteration catch-and-retry.
- The `scheduler_lock` / event-loop blocking issue described under "Current
  state" is intentionally left as is (only the TODO comments from step 5 are
  added); a later change should run the whole schedule update as one
  synchronous function on a pool worker.
