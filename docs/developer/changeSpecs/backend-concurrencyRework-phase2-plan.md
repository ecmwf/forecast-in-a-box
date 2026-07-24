# Backend concurrency rework: Phase 2 implementation plan

## Purpose and references

Phase 2 replaces jobs-database runtime access through the FastAPI event loop
with synchronous, serialized work on the already-registered
`ConcurrentPools.JobsDb` worker. It is one atomic cutover: after it lands, no
runtime jobs-database operation may use the async jobs engine, the old
`asyncio.Lock`, or `asyncio.run_coroutine_threadsafe`.

> Reference only: look at these original files only if you encounter an
> unexpected situation:
> [`backend-concurrencyRework-design.md`](backend-concurrencyRework-design.md)
> and
> [`backend-concurrencyRework-migration.md`](backend-concurrencyRework-migration.md).

The result notes establish the starting point:

- Phase 0 isolated users-database locking in `domain.auth.db`; users
  persistence is not in this phase's scope.
- Phase 1 created and starts the bounded execution manager, including the
  one-worker `ConcurrentPools.JobsDb` pool. No existing jobs-database caller
  currently uses it.

## Scope, invariants, and completion criteria

This phase changes only jobs persistence and the callers that must switch with
it. It deliberately does not migrate ownership of the scheduler, plugin
updater, or run worker to the execution manager; those migrations remain in
Phases 3 and 4. Their existing threads may remain, but they must no longer
retain or use an async-loop reference for jobs-database work.

The completed implementation must satisfy all of the following:

1. Runtime jobs-database operations execute only as synchronous callables on
   `ConcurrentPools.JobsDb`, which remains a one-worker pool.
2. Each public database operation owns its complete session and transaction.
   A read-modify-write sequence is a single callable and cannot interleave
   with another jobs-database task.
3. Async code awaits `execution_manager.awaitable_submit(...)`; existing
   background threads wait on the returned
   `execution_manager.submit_unmonitored(...).result()`.
4. The database helpers never submit themselves to `JobsDb`. Services, routes,
   and thread orchestration are the submission boundaries.
5. SQLite retries remain narrow and retry the whole synchronous operation.
   Queue/lifecycle rejection is not retried or bypassed with a direct database
   call; it is surfaced as a service-busy failure.
6. No domain state lock is held while waiting for a jobs-database future,
   except for the documented temporary `scheduler_lock` breach described
   below. In particular, plugin-list snapshots must release
   `PluginManager.lock` before the database wait.
7. The users database remains async and continues using only the isolated
   helpers introduced in Phase 0.

Before considering the cutover complete, search production code and tests for
jobs `async_session_maker`, `async_engine`, `utility.db` async helpers, the
old jobs `asyncio.Lock`, and `asyncio.run_coroutine_threadsafe`. Remaining
references may only belong to users persistence.

## Implementation sequence

### 1. Establish the synchronous jobs persistence boundary

1. In `backend/src/forecastbox/schemata/jobs.py`, replace the jobs async
   engine/session maker with a synchronous SQLite SQLAlchemy engine and
   `sessionmaker` for both schema creation and runtime jobs access. The users
   schema remains asynchronous and unchanged.
2. Make the synchronous URL explicit (`sqlite:///...` rather than the
   `sqlite+aiosqlite` URL), set `expire_on_commit=False` consistently, and do
   not share a session or connection across worker threads.
3. Extend the dynamic schema-creation discovery in `entrypoint/app.py` to call
   each `create_db_and_tables` function and await its result only when it is
   awaitable. `schemata/jobs.py` therefore creates its schema synchronously on
   the main thread before the execution manager starts, while
   `schemata/user.py` continues to return an awaitable.
4. Immediately dispose the jobs engine after its main-thread schema creation
   and before registering/starting `ConcurrentPools.JobsDb`. This closes idle
   SQLite connections created on the main thread; the runtime session maker
   remains usable and creates its first connections on the jobs worker.
   Dispose the engine again only after jobs work has drained and the execution
   manager has shut down its pools during application shutdown.
5. Replace `utility/db.py`'s async lock and coroutine retry API with a
   jobs-only synchronous `threading.RLock` and synchronous retry wrapper.
   The retry wrapper must hold the lock, catch only SQLite/SQLAlchemy
   `OperationalError`, wait between attempts, and rerun the entire supplied
   operation. Place the required comment beside this serialized access:

   ```python
   # TODO investigate concurrent reads. SQLite should support concurrent readers,
   # but the first implementation deliberately serializes all access so this
   # rework does not also need to solve read/write classification and consistency.
   ```

6. Convert or remove the generic helper functions
   (`addAndCommit`, `executeAndCommit`, `querySingle`, and `queryCount`) so
   none exposes an async session or permits one logical operation to be split
   into separate queued tasks. Prefer small synchronous helpers that receive a
   synchronous session maker only when they preserve the single-operation
   transaction rule.

### 2. Convert every jobs database helper before switching callers

Convert these modules together from `async def`/`AsyncSession` to synchronous
functions using the new synchronous session maker:

- `domain/blueprint/db.py`
- `domain/experiment/db.py`
- `domain/experiment/scheduling/db.py`
- `domain/glyphs/global_db.py`
- `domain/plugin/db.py`
- `domain/run/db.py`

For every converted operation:

1. Open a session, execute all reads and writes needed for that operation,
   commit when successful, and close the session before returning or raising.
2. Preserve the existing authorization checks, version-conflict behavior,
   return types, ordering, soft-delete semantics, and timestamps.
3. Use the synchronous retry wrapper around the complete operation, not around
   an individual statement.
4. Refactor the existing split read/write helpers into one transaction where
   needed. This includes blueprint and experiment soft deletes (lookup,
   authorization/version validation, and update), `ExperimentNext` upsert,
   global-glyph upsert/delete, plugin-state upsert/update, and run upsert.
5. Return no ORM object from a jobs-database helper or `JobsDb` future.
   Introduce the smallest immutable `@dataclass(frozen=True, eq=True,
   slots=True)` record needed at each existing leak, with the same loaded
   scalar fields consumed by the caller. This is a targeted boundary repair,
   not a broad architecture rewrite. If inspection finds a caller mutating an
   ORM object outside its DB helper, move that mutation into a proper
   transaction-owning DB operation instead.

Update module documentation to describe synchronous helpers and the
`JobsDb`-submission contract. Remove references to monkeypatching
`async_session_maker` and the former shared async session pool.


### 3. Add explicit async submission at all route and service boundaries

At each async boundary, bind arguments with `functools.partial`, use a stable
`TaskName`, and await:

```python
await execution_manager.awaitable_submit(
    ConcurrentPools.JobsDb,
    TaskName("meaningful.jobs-db.operation"),
    partial(db_module.operation, ...),
)
```

Update the following surfaces in the same change:

- `routes/blueprint.py` and `domain/blueprint/service.py`, including global
  glyph lookup, validation, save/load/list/delete, and pagination counts.
- `domain/experiment/service.py` and `routes/experiment.py`, including all
  schedule CRUD, next-run state, and run-list queries.
- `routes/run.py` and `domain/run/service.py`, including list/get/restart/
  delete lookups and the persistence updates made by `poll_and_update`.
- `routes/plugins.py`, `domain/plugin/detail.py`, and async plugin unload
  paths.

Create `utility/exception.py` as the common translation point for
utility-owned exceptions. Initially it imports the execution-manager
exceptions and exposes `register_handlers(app: FastAPI) -> None`, which
registers an application-level handler for `SubmissionRejected`. Call it from
`entrypoint/app.py` during app setup. The handler returns HTTP 503 with a
brief, safe detail identifying the rejected pool/lifecycle condition and asks
the client to retry. A route or domain service may still catch and translate
the exception earlier when it needs a more specific response. Background and
scheduler callers must log and retain their existing failure reporting
behavior; they must not open a direct fallback connection when the jobs queue
is saturated or stopping.

For `domain/plugin/detail.py`, capture the immutable plugin/error snapshots
while holding `PluginManager.lock`, release that lock, then await the
`get_all_plugin_states` jobs task and compose the listing. This removes the
current lock-held database wait while preserving a coherent in-memory
snapshot.

Retain `scheduler_lock` across the scheduler's full `try_schedule` cycle and
the related schedule-mutation database submissions. This is a deliberate,
temporary exception to the general no-lock-while-waiting rule: it prevents a
schedule mutation from racing the sequence of reading a due schedule,
constructing/submitting its run, and recording its next occurrence. The jobs
DB helpers must never acquire `scheduler_lock`, submit scheduler work, or
wait on a pool that needs this lock, so the unique scheduler thread cannot
form a circular wait. The downside is bounded request delay or existing 503
lock contention while a scheduler cycle processes due schedules; preserve the
current timed acquisition and logging. Revisit this breach only when schedule
state becomes immutable/versioned, allowing the read and final update to use
a stable version identifier without locking the full submission flow.

### 4. Replace loop bridges in existing background workers

#### Run submission and execution

1. Extract `submit_run_sync(...) -> Either[ExecuteResult, str]` in
   `domain/run/service.py`. It validates the blueprint, synchronously waits
   for the initial `run_db.upsert_run` future on `JobsDb`, then enqueues
   `execute_background` on `ConcurrentPools.RunSubmission` without waiting for
   completion.
2. Retain `async execute(...)` as a thin route-facing wrapper that awaits a
   `ConcurrentPools.General` submission of `submit_run_sync`. This removes the
   current default-executor `run_in_executor(None, ...)` call while preserving
   the immediate create/restart response.
3. Remove the event-loop argument and `run_async` adapter from
   `domain/run/background.py`. Its global-glyph read and each runtime Run
   update must submit synchronous jobs helpers to `JobsDb` and wait for their
   futures from the run-submission worker.
4. Ensure the error path also uses the jobs future, logs an explicit failure
   if that update cannot be queued, and never masks the original compilation/
   Cascade error. It must not attempt an arbitrary-thread database write.

#### Scheduler

1. Convert `experiment2runnable` in
   `domain/experiment/scheduling/job_utils.py` to a synchronous composition of
   its experiment and blueprint reads. It is submitted once to `JobsDb`, so
   the two reads cannot be interleaved with a conflicting database operation.
2. In `domain/experiment/scheduling/background.py`, remove the stored loop and
   `_run_async`. For each iteration, submit scheduler DB reads/writes and
   `experiment2runnable` to `JobsDb`, wait on the resulting concurrent
   futures, and call `submit_run_sync` directly for accepted runs.
3. Keep the existing `SchedulerThread`, lifecycle functions, liveness data,
   condition wake-up, and status surface for Phase 4. Only eliminate its
   FastAPI-loop dependency and default-executor dependency now.

#### Plugin updater

1. Remove `PluginManager.loop` and `_run_async_from_thread`; do not set the
   loop in `entrypoint/app.py`.
2. Make the plugin updater's database interactions submit synchronous
   `plugin.db` and blueprint-template helper callables to `JobsDb` and wait on
   their futures from the updater thread.
3. Convert `_ingest_plugin_templates` into synchronous updater-thread
   orchestration. It should submit and wait for small, independent `JobsDb`
   operations (state lookup/clear, template soft delete/lookup/upsert, glyph
   lookup, and final error update), while template conversion and validation
   execute on the updater thread. Do not wrap a whole ingestion pass or
   validation in one long jobs-database task. Preserve the current
   per-template best-effort error collection and continuation behavior.
4. Keep the existing ad hoc updater-thread ownership, delayed startup, and
   template-ingestion domain-cycle workaround untouched; moving them to
   `PluginManagement` and events belongs to later phases.

### 5. Clean up lifecycle and obsolete paths

1. Update `entrypoint/app.py` startup/shutdown to support mixed synchronous
   and asynchronous schema discovery, dispose main-thread jobs connections
   before starting `JobsDb`, stop assigning the FastAPI loop to domain
   managers, register the common utility exception handlers, and dispose the
   synchronous jobs engine after runtime shutdown.
2. Delete the jobs async lock, async retry/session helpers, runtime async
   session-maker imports, loop parameters, and
   `asyncio.run_coroutine_threadsafe` bridges made obsolete by the cutover.
3. Leave the isolated users async engine, session maker, and retry helpers
   unchanged.
4. Do not migrate the run logs route's default-executor archive creation,
   artifact/store workers, or plugin thread ownership in this phase; those are
   explicitly Phase 3 concerns.

## Test and validation plan

1. Convert jobs persistence unit fixtures in `tests/unit/test_jobs.py`,
   `tests/unit/domain/blueprint/test_blueprint_db.py`,
   `tests/unit/domain/glyphs/test_global.py`, and
   `tests/unit/domain/plugins/test_plugin_db.py` to synchronous SQLAlchemy
   engines/session makers. Use a test configuration that shares the in-memory
   schema safely with the jobs worker when worker-thread submission is under
   test (for example, `StaticPool` plus the appropriate SQLite thread setting).
   Rewrite direct helper assertions as synchronous calls while preserving every
   CRUD, auth, conflict, visibility, and soft-delete expectation.
2. Update service tests that currently use `AsyncMock` for jobs helpers:
   `tests/unit/domain/run/test_service.py` and
   `tests/unit/scheduling/test_experiment_runnable.py` must use synchronous
   mocks and assert the correct named `JobsDb` submissions. Add focused tests
   for `submit_run_sync`, route-facing `execute`, and a run worker that has no
   event-loop argument.
3. Add focused unit coverage for the synchronized retry behavior, one complete
   read-modify-write transaction per helper, queue-rejection propagation, and
   the prohibition on a same-pool reentrant submission.
4. Add scheduler and plugin-updater tests proving they can perform their
   jobs-database interactions without `run_coroutine_threadsafe` or a stored
   FastAPI loop. Include the plugin-list snapshot case to prove
   `PluginManager.lock` is released before waiting for database work.
5. Run the existing jobs unit tests, affected domain unit tests, scheduler/run
   integration tests, database-startup integration test, and the backend type
   check. Finish with the repository's existing backend validation command
   before review.

## Review status

No open questions remain after this review.
