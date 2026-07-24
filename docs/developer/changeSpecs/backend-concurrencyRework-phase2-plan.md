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
6. No domain state lock is held while waiting for a jobs-database future.
   In particular, plugin-list snapshots and scheduler coordination must not
   retain their locks across database waits.
7. The users database remains async and continues using only the isolated
   helpers introduced in Phase 0.

Before considering the cutover complete, search production code and tests for
jobs `async_session_maker`, `async_engine`, `utility.db` async helpers, the
old jobs `asyncio.Lock`, and `asyncio.run_coroutine_threadsafe`. Remaining
references may only belong to users persistence or jobs schema creation, if
schema creation is intentionally kept async for this phase.

## Implementation sequence

### 1. Establish the synchronous jobs persistence boundary

1. In `backend/src/forecastbox/schemata/jobs.py`, add a synchronous SQLite
   SQLAlchemy engine and `sessionmaker` for runtime jobs access. Keep the
   current async engine only for the existing startup schema-creation path if
   that avoids changing startup behavior; no runtime helper may use it after
   this phase.
2. Make the synchronous URL explicit (`sqlite:///...` rather than the
   `sqlite+aiosqlite` URL), set `expire_on_commit=False` consistently, and
   ensure that connections are first created and used by the jobs worker.
   Do not share a session or connection across worker threads.
3. Define the shutdown ownership for the synchronous engine: dispose it only
   after jobs work has drained and the execution manager has shut down its
   pools. Do not dispose it while a managed worker can still submit database
   work.
4. Replace `utility/db.py`'s async lock and coroutine retry API with a
   jobs-only synchronous `threading.RLock` and synchronous retry wrapper.
   The retry wrapper must hold the lock, catch only SQLite/SQLAlchemy
   `OperationalError`, wait between attempts, and rerun the entire supplied
   operation. Place the required comment beside this serialized access:

   ```python
   # TODO investigate concurrent reads. SQLite should support concurrent readers,
   # but the first implementation deliberately serializes all access so this
   # rework does not also need to solve read/write classification and consistency.
   ```

5. Convert or remove the generic helper functions
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
5. Retain ORM result objects only as detached, read-only values at the
   submission boundary. Callers must not defer relationship loading or session
   work outside the jobs worker.
*> note: we generally dont want to leak ORM objects out of the domain service boundary, we want to convert to a dedicated dataclass/pydantic model asap -- as described by the general backend guidelines. However, it is possible that in some cases in the existing codebase, ORM objects leak more than they should. You can mention that this is a good opportunity for eradicating this without exception -- basically no ORM object should ever be returned from the JobsDb worker thread. The developer is not to make sweeping architecture changes -- simply creating a (minimal) dataclass where an ORM leaked before with identical fields is the right fix. I don't think there ever was a case where an ORM mutation outside of a DB code was happening -- if that however would be the case, the developer should refactor for a proper DB layer handling

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

Create one consistent translation for `SubmissionRejected` at HTTP
boundaries, returning an explicit HTTP 503 service-busy response rather than
falling through to an internal error. Background and scheduler callers must
log and retain their existing failure reporting behavior; they must not open a
direct fallback connection when the jobs queue is saturated or stopping.
*> note: generally, every domain defines its own exceptions and translations into http codes. However, the SubmissionRejected etc are common to all domains, hence we would like some sort of common handler. You should describe a solution that 1/ creates utility/exception.py, which imports various custom exceptions from across utility (we can start with just the utility/concurrent/manager ecxeptions), and exposes a `def register_handlers(app)` and does the `app.exception_handler` -- almost always those would be about plain "try later" error code with a brief detail about the exception (like which pool was busy)

For `domain/plugin/detail.py`, capture the immutable plugin/error snapshots
while holding `PluginManager.lock`, release that lock, then await the
`get_all_plugin_states` jobs task and compose the listing. This removes the
current lock-held database wait while preserving a coherent in-memory
snapshot.

For schedule update/delete paths, audit `scheduler_lock` scopes so a request
does not wait for a jobs future while holding the lock. Submit and await
database work outside the lock, then use the lock only for short scheduler
state/prod coordination. Preserve the current 503 behavior for genuine
scheduler-lock contention and ensure `prod_scheduler()` occurs only after the
relevant persistence operation succeeds.

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
3. Refactor `_ingest_plugin_templates` so it has no coroutine dependency.
   Extract any pure validation/templating work from
   `blueprint.service.validate_expand` as necessary, fetch glyph data through
   a jobs future, and preserve the current per-template error collection and
   continuation behavior.
4. Keep the existing ad hoc updater-thread ownership, delayed startup, and
   template-ingestion domain-cycle workaround untouched; moving them to
   `PluginManagement` and events belongs to later phases.

### 5. Clean up lifecycle and obsolete paths

1. Update `entrypoint/app.py` startup/shutdown only as needed to stop assigning
   the FastAPI loop to domain managers and to dispose the synchronous jobs
   engine at the correct point.
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

## Open questions and review concerns

1. `experiment.service` currently uses `scheduler_lock` to coordinate schedule
   mutations with the old scheduler. Releasing that lock before awaiting the
   serialized database task is required by the concurrency design, but review
   should confirm that queue serialization plus post-commit `prod_scheduler()`
   preserves the intended schedule-update race semantics.
*> note: actually, I'm hesitant here. I think we best keep the lock locked for the duration of the db operations in the scheduler thread. I know it goes against the original design, but the scheduler is an important unique resource, and if we were strict here, the transaction boundary would be too long, and most importantly, it would leak over submissions to other pools, so honestly this is unsolvable. Consider the following: try_schedule needs db access to get schedule information, then it needs to compile and submit, then it needs to update database. And we cannot allow any schedule mutation during this whole process -- but the compile and submit cannot happen as a part of database transaction. The only solution I can imagine now would be to have the schedule db entities immutable and insert a version+1 row instead of update, and then we could separate the transaction in two by passing the version as the stable row identifier. But lets not do that now. What downsides are there to keeping the lock over the db operation submits? I don't think we would result in a deadlock/livelock, because the scheduler thread is unique. I would be fine if we say "this is a temporary breach to the no-lock rule, until scheduling is converted into immutable". Wdyt?
2. The synchronous engine will coexist briefly with the async schema-creation
   engine. Review should confirm whether startup schema creation remains async
   for this phase or is also converted, and confirm the exact disposal location
   so neither engine is disposed while it can still be used.
*> note: well, we best have the schema creation sync for jobs db and async for users db, because thats what sort of engine we will need. But the schema creation logic is dynamic. Hence I think we best move the jobs db creation to be async, and the schema creation discovery gets extended with "if is coroutine then await it otherwise execute sync". Calling await in the lifecycle startup has no benefits because the app is not yet running, ie, there is no other async task that could actually run. My question is just -- will this cause issues in terms of "we run the schema creation in the main thread, not in the JobsDB thread"? Note that the schema creation runs _before_ the JobsDb pool. We could reorder this, but I'd prefer not to for now
3. Plugin template ingestion currently combines plugin management, glyph
   database reads, and blueprint validation in an async helper. Extracting a
   synchronous composition must preserve its intentionally per-template
   best-effort behavior and must not accidentally perform validation while
   `PluginManager.lock` is held.
*> note: plugin ingestion does not need strong guarantees at the moment. I think the best solution would be to have the async helper `_ingest_plugin_templates` execute in the plugin updater thread (which is not the same as holding the lock, but still prevents some race conditions as it occupies the resource), submit small db updates (clearing asset ingest, soft deleting templates, getting glyphs for validation, etc) and waiting for the result in each case (thus keeping the thread occupied). To put it other way -- I would rather occupy the plugin thread for long and have more small JobsDb calls from there, compared to eg occuppying the JobsDb pool with a longer running "transaction" that eg validates the template inside. This will be actually an improvement over the current codebase where the template ingest occupied the async loop, thats less desirable.
4. Passing SQLAlchemy entities out of a completed jobs task is safe only for
   already-loaded scalar columns used by callers. If any converted caller
   requires lazy relationships, replace the cross-boundary ORM object with a
   plain immutable DTO rather than extending the session lifetime.
*> note: this is something I commented above -- lets replace all these situations with a new dataclass wherever needed (we prefer dataclasses over DTOs, even though they are a bit less performant)
5. The target HTTP representation for `SubmissionRejected` should be agreed
   during review (shared 503 detail versus route-specific errors), but direct
   database fallback is prohibited in either choice.
*> note: also commented above -- you can have a common handler (a route-specific try-catch can always override this because its evaluated sooner)
