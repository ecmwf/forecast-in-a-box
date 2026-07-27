# Backend concurrency rework: Phase 2 implementation plan

## Purpose and scope

Implement Phase 2 only: **separate and serialize jobs-database access**. After
this phase the jobs SQLite database is driven by a synchronous SQLAlchemy engine
guarded by one regular `threading.RLock`, and background workers no longer retain
the FastAPI event loop merely to run database operations.

This phase delivers, as one coordinated cutover:

1. A synchronous jobs engine/session maker in `schemata/jobs.py`, plus a
   synchronous `create_db_and_tables`, with the entrypoint schema-discovery
   loop updated to await async schema creators and call sync ones directly.
2. Synchronous jobs lock + retry helpers in `utility/db.py` (regular
   `threading.RLock`, SQLite `OperationalError` retry around the whole
   operation).
3. Conversion of all six jobs-database helper modules from `async def` to `def`,
   using the synchronous session maker and the synchronous retry wrapper.
4. Rewrite of every jobs-database caller in the same change:
   - async services and routes submit each database-only call through the
     one-worker `ConcurrentPools.JobsDb` pool via
     `execution_manager.awaitable_submit`;
   - synchronous pool workers and long-lived threads call the same locked
     helpers directly.
5. An async-independent run-submission boundary (`submit_run_sync`) with the
   existing `execute` retained as a thin async wrapper; `experiment2runnable`
   converted to a synchronous operation.
6. Removal of every jobs-DB use of the retained event loop:
   `asyncio.run_coroutine_threadsafe` DB bridges, stored loop references used
   only for DB work, the shared jobs `asyncio.Lock`, and async jobs-session
   usage from runtime operations.

**Out of scope for Phase 2** (do not change beyond what the cutover forces):

- The users database (`domain/auth/db.py`, `schemata/user.py`): it stays fully
  async with its own isolated lock; Phase 0 already isolated it.
- Migrating executor-backed work to named pools (artifacts, plugin loading,
  stores, run-log ZIP, lens, status probes) -- those are Phase 3.
- Consolidating thread ownership of the scheduler / plugin updater / run
  background into managed threads -- those are Phase 3/4. Phase 2 only rewrites
  their *DB calls* (and the run-submission boundary they depend on).
- The default-executor run-log ZIP in `routes/run.py` (`_build_zip`) -- that is
  Phase 3's "run log ZIP creation" move. Phase 2 removes only the default
  executor used for **run submission** (`execute` -> `execute_background`).
- Event/dispatcher handlers, notifications, and the periodic DB garbage
  collector.
- Test design. Existing tests that monkeypatch `async_session_maker` will break
  and must be adapted, but designing the new test approach is tracked as an open
  question, not part of this plan's implementation steps.

## Original design references

The following documents were used to derive this plan. **Look at these original
files only if you encounter an unexpected situation** -- this plan is intended to
be self-contained and reading them should not be necessary for implementation.

- [`backend-concurrencyRework-design.md`](backend-concurrencyRework-design.md)
  (see sections "Jobs database serialization", "Users database", "Startup
  sequence")
- [`backend-concurrencyRework-migration.md`](backend-concurrencyRework-migration.md)
  (Phase 2: 2.1, 2.2, 2.3)
- [`backend-concurrencyRework-phase0-result.md`](backend-concurrencyRework-phase0-result.md)
- [`backend-concurrencyRework-phase1-result.md`](backend-concurrencyRework-phase1-result.md)

## Current state (already delivered by Phases 0 and 1)

- **Phase 0**: concurrency helpers live in `utility/concurrency/`
  (`ports.py`, `shutdown.py`, `synchronization.py`); `utility/db.py` is
  jobs-persistence-only; users-database locking/retry (`dbLock`, `dbRetry`) is
  isolated in `domain/auth/db.py`.
- **Phase 1**: `utility/concurrency/manager.py` holds a module-level
  `execution_manager` with six configured bounded pools (including
  `ConcurrentPools.JobsDb`, one worker), staged lifecycle, immutable status, and
  a process-local event dispatcher. The pools are started but mostly idle.

Concrete facts this plan relies on (verified against the current tree):

- `execution_manager` public API (in `utility/concurrency/manager.py`):
  - `async awaitable_submit(pool_name, task_name, task) -> T` -- wraps a sync
    callable's `Future` with `asyncio.wrap_future`; use from async code.
  - `submit_monitored(pool_name, task_name, task) -> None` -- fire-and-forget,
    failures recorded in status; use from sync code for background work.
  - `submit_unmonitored(...) -> Future[T]`, `submit_after(...)`.
  - `TaskName = NewType("TaskName", str)` is defined here.
  - A pool worker submitting to **its own** pool raises `SubmissionRejected`;
    submitting to a *different* pool is allowed. A saturated pool raises
    `SubmissionRejected` (bounded, non-blocking).
- `ConcurrentPools` (in `utility/config.py`) already includes `JobsDb`, and
  `ConcurrencySettings.validate_runtime` already enforces exactly one JobsDb
  worker. No new config fields are required for Phase 2.
- `entrypoint/app.py` lifespan currently (in order): `validate_runtime`;
  iterates `forecastbox.schemata.*`, and for every module exposing
  `create_db_and_tables` does `await module.create_db_and_tables()`; then
  `_start_execution_runtime()` (registers pools, discovers dispatchers,
  registers + starts the manager). Pools are therefore ready before any
  post-schema startup work runs.
- Jobs DB helper modules and the async lock they share today:
  - `utility/db.py`: `lock = asyncio.Lock()`, `dbRetry`, `executeAndCommit`,
    `addAndCommit`, `querySingle`, `queryCount`.
  - `schemata/jobs.py`: `async_engine`, `async_session_maker`,
    `create_db_and_tables` (async).
  - Six helper modules import `_jobs_module.async_session_maker` and the
    `utility.db` helpers: `domain/blueprint/db.py`, `domain/experiment/db.py`,
    `domain/experiment/scheduling/db.py`, `domain/glyphs/global_db.py`,
    `domain/plugin/db.py`, `domain/run/db.py`.
- Event-loop-retention / `run_coroutine_threadsafe` sites that exist purely for
  DB work and must be removed in this cutover:
  - `domain/run/service.py`: `loop = asyncio.get_running_loop()` +
    `loop.run_in_executor(None, execute_background, ...)`.
  - `domain/run/background.py`: `run_async(coro)` wrapper using
    `run_coroutine_threadsafe`, plus the `loop` parameter.
  - `domain/experiment/scheduling/background.py`: `SchedulerThread._loop`,
    `_run_async`, `start_scheduler` capturing the running loop.
  - `domain/plugin/manager.py`: `_run_async_from_thread` +
    `PluginManager.loop` (set in `app.py` lifespan).

## Design constraints carried into every step (from the design doc)

- Every public jobs-DB operation is **synchronous**, acquires the jobs `RLock`
  internally, owns its own session/transaction, and never submits itself to a
  pool.
- Async orchestration submits **one complete helper call per** `awaitable_submit`
  to `ConcurrentPools.JobsDb`. A read-modify-write that was two lock steps in
  async code becomes two separate submitted callables (do **not** merge them
  into one bigger callable, and do **not** split existing single operations).
- The `JobsDb` pool is an async-to-sync **bridge**, not the exclusive owner of
  DB access. Synchronous callers (pool workers, managed/legacy threads) call the
  same helpers directly and contend on the same `RLock`.
- Code already running on the JobsDb worker must call nested private helpers
  directly, never resubmit to `JobsDb` (the manager would reject same-pool
  submission anyway).
- Sessions are created, used, committed/rolled-back, and closed on the executing
  thread. Never pass a session or a live SQLAlchemy result object between
  threads. Fully materialize returned values before the session closes; do not
  rely on lazy loading.
- Do not change lock scope or operation boundaries of any DB helper.
- Treat pool saturation (`SubmissionRejected`) as an explicit service-busy
  failure; never fall back to a direct DB call from async code.

## Implementation steps

### Step 2.1a -- Synchronous jobs engine and session maker (`schemata/jobs.py`)

Add, alongside the existing async engine/session maker (the async ones stay only
as long as needed for the migration and are removed at the end of the cutover --
see Step 2.2f):

```python
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sync_url = f"sqlite:///{config.db.sqlite_jobdb_path}"
sync_engine = create_engine(
    sync_url,
    pool_pre_ping=True,
    # A pooled connection may be checked out by different threads over its
    # lifetime; the jobs RLock prevents simultaneous in-process use.
    connect_args={"check_same_thread": False},
)
sync_session_maker = sessionmaker(sync_engine, expire_on_commit=False)
```

Notes:
- `check_same_thread=False` is required because the single pooled SQLite
  connection is used from the JobsDb worker thread, the scheduler thread, and
  pool workers over time. The jobs `RLock` guarantees non-overlap.
- Keep `expire_on_commit=False` (matches current behavior; needed so returned
  ORM values remain readable after commit).
- The six helper modules currently reference `_jobs_module.async_session_maker`
  so tests can monkeypatch one attribute. Preserve that single-attribute
  indirection: they will reference `_jobs_module.sync_session_maker` after
  conversion. The tests covering these helpers switch to synchronous style
  themselves (they should not `await` a converted helper; a unit test that would
  is a candidate for splitting per one-concern-per-test) and supply an in-memory
  synchronous maker backed by SQLAlchemy `StaticPool` so the schema stays visible
  across threads. Test rewrites are tracked with the (separate) test work, but
  the seam decision (`sync_session_maker`, one monkeypatch point) is fixed here.

### Step 2.1b -- Synchronous jobs lock and retry helpers (`utility/db.py`)

Replace the async lock/retry/session helpers with synchronous equivalents.
Preserve the existing camelCase public names used across the codebase
(`dbRetry`, `executeAndCommit`, `addAndCommit`, `querySingle`), now synchronous:

```python
import threading
import time

# TODO investigate concurrent reads. SQLite should support concurrent readers,
# but the first implementation deliberately serializes all access so this
# rework does not also need to solve read/write classification and consistency.
lock = threading.RLock()
retries = 3

def dbRetry(func: Callable[[int], T]) -> T:
    for i in range(retries, -1, -1):
        try:
            with lock:
                return func(i)
        except sqlalchemy.exc.OperationalError:
            if i == 0:
                raise
            time.sleep(0.1)
    raise ValueError

def executeAndCommit(stmt, session_maker) -> None: ...   # sync `with session_maker() as s`
def addAndCommit(entity, session_maker) -> None: ...
def querySingle(query, session_maker) -> Any: ...
```

- Use a `threading.RLock` (not `Lock`): a synchronous helper may be reached
  while an outer helper already holds it, and re-entrancy matches the design's
  "regular jobs RLock".
- The retry wrapper holds the RLock and retries the **whole** operation on
  `OperationalError`, replacing `await asyncio.sleep(0.1)` with `time.sleep`.
- `queryCount` (currently takes a live `session`) is only used internally; keep
  its shape but make it synchronous. Verify it has no cross-thread callers.
- Update the module docstring: the lock is now a synchronous `RLock` serializing
  all in-process jobs-DB access; users DB remains separate and async.

### Step 2.1c -- Synchronous schema creation + entrypoint discovery

- In `schemata/jobs.py`, change `create_db_and_tables` to synchronous using
  `sync_engine`:

  ```python
  def create_db_and_tables() -> None:
      Base.metadata.create_all(sync_engine)
  ```

- `schemata/user.py::create_db_and_tables` stays **async**.
- In `entrypoint/app.py`, the schema-discovery loop must handle both. Assess the
  callable (or its result) and await or call directly:

  ```python
  result = module.create_db_and_tables()
  if inspect.isawaitable(result):
      await result
  ```

  (Equivalently branch on `inspect.iscoroutinefunction`.) This keeps schema
  creation in the existing startup path (design 2.1) while jobs uses the sync
  maker and users stays async. Pools are started immediately after, so JobsDb is
  ready before any async DB submission.

### Step 2.2a -- Convert the six jobs-DB helper modules to synchronous

Convert **together**, in one change, every module below from `async def` to
`def`, replacing `async with _jobs_module.async_session_maker() as session:` with
`with _jobs_module.sync_session_maker() as session:`, removing `await` on
`session.execute/commit`, and calling the now-synchronous `dbRetry` /
`executeAndCommit` / `addAndCommit` / `querySingle` directly:

- `domain/blueprint/db.py`
- `domain/experiment/db.py`
- `domain/experiment/scheduling/db.py`
- `domain/glyphs/global_db.py`
- `domain/plugin/db.py`
- `domain/run/db.py`

Rules:
- Do **not** change function signatures (except dropping `async`), lock scope, or
  operation boundaries. The inner `def function(i: int)` closures stay; only
  their `async` and `await` markers are removed.
- Helpers that call other helpers internally (e.g. `soft_delete_run` calls
  `get_run`; `soft_delete_blueprint` calls `get_blueprint`;
  `upsert_experiment_next` calls `querySingle` then `executeAndCommit`) simply
  become nested synchronous calls under the same re-entrant `RLock`.

### Step 2.2b -- Return ORM-free values from public helpers (JobsDb bridge safety)

Some helpers today return ORM instances (`Run`, `Blueprint`, `ExperimentDefinition`,
`ExperimentNext`, `GlobalGlyph`, `PluginState`) or containers of them
(`BlueprintLatest`, `ExperimentLatest`, `list[tuple[ExperimentNext,
ExperimentDefinition]]`). When such a helper is invoked from async code via
`awaitable_submit`, the ORM object is created on the JobsDb worker thread, its
session is closed there, and the object is then read on the caller's thread --
which risks reading an unloaded/expired attribute off a detached instance.

**Firm rule for this phase (chosen for safety over minimality):** no **public**
helper (a function whose name does **not** start with `_`) in any of the six
converted modules may return an ORM instance -- or a container/tuple/dataclass
holding one -- regardless of whether its current callers are async or sync. Each
such public helper returns a fully materialized, ORM-free value: a plain scalar,
a frozen dataclass / Pydantic DTO, or a container of those, built and populated
while the session is still open. This removes the whole class of
`DetachedInstanceError`/cross-thread lazy-load bugs by convention rather than by
per-caller audit.

`_`-prefixed (private) helpers **may** stay returning an ORM object for now,
because they are only meant to be used within their defining module (same thread,
same open session). Enforcing "no private helper is used across module
boundaries" is left to convention; detecting breaches is out of scope for this
effort.

Guidance:
- Because no model in `schemata/jobs.py` defines a `relationship()`, each ORM row
  is a flat set of columns; a DTO is a straightforward field-by-field copy taken
  before the session closes. Reuse an existing DTO where one already fits;
  otherwise add a small frozen dataclass next to the helper.
- Public helpers to convert to ORM-free returns (each returns a DTO / container
  of DTOs / scalar): `run_db.get_run`, `run_db.list_runs`,
  `run_db.list_runs_by_experiment`, `blueprint_db.get_blueprint`,
  `blueprint_db.list_blueprints` (`BlueprintLatest`),
  `blueprint_db.find_plugin_template_id` (already scalar),
  `experiment_db.get_experiment_definition`,
  `experiment_db.list_experiment_definitions` (`ExperimentLatest`),
  `scheduling_db.get_experiment_next`, `scheduling_db.get_schedulable_experiments`,
  `global_db.upsert_global_glyph`, `global_db.get_global_glyph`,
  `global_db.list_global_glyphs`, `global_db.get_glyphs_for_resolution` (already
  a plain-`dict` DTO), `global_db.delete_global_glyph`,
  `plugin_db.get_plugin_state`, `plugin_db.get_all_plugin_states`.
- `BlueprintLatest` / `ExperimentLatest` currently wrap an ORM instance plus a
  timestamp; redefine them (or replace their payload) so they carry plain
  materialized fields instead of the ORM object.
- Downstream consumers that today read attributes off the returned ORM row
  (route serializers, `poll_and_update`, `experiment2runnable`, the scheduler
  loop) must be updated to read the DTO fields. This is a real but mechanical
  ripple; account for it in each caller rewrite (Steps 2.2c/2.2d).

### Step 2.2c -- Rewrite async callers to submit through the JobsDb pool

Every remaining `await <module>.<helper>(...)` in **async** services and routes
becomes:

```python
from functools import partial
from forecastbox.utility.concurrency.manager import execution_manager, TaskName
from forecastbox.utility.config import ConcurrentPools

result = await execution_manager.awaitable_submit(
    ConcurrentPools.JobsDb,
    TaskName("blueprint.get"),
    partial(blueprint_db.get_blueprint, blueprint_id, version),
)
```

Async caller files to rewrite (each `await` on a converted helper, one
submission per call):

- `routes/blueprint.py`, `routes/run.py`, `routes/plugins.py`
- `domain/blueprint/service.py`
- `domain/experiment/service.py`
- `domain/run/service.py`
- `domain/plugin/__init__.py`, `domain/plugin/detail.py` (whichever call the
  converted `plugin/db.py` helpers from async context)

Guidance:
- Use stable, namespaced `TaskName` values (`"<domain>.<operation>"`, e.g.
  `"run.upsert"`, `"experiment.next.upsert"`) for readable status output.
- Where an async function holds a **domain** lock across several DB submissions
  (`experiment/service.py::update_schedule` / `delete_schedule` hold
  `scheduler_lock` across multiple awaits), keep that structure: it holds a
  domain lock, not the jobs lock, and `awaitable_submit` does not block the
  loop. Do not hold the jobs `RLock` across awaits (helpers acquire/release it
  internally, so this invariant holds automatically).
- Do not wrap non-DB async work in `awaitable_submit`; only the DB helper calls
  move.
- **Do not add handling for `SubmissionRejected` (pool saturation) in this
  phase.** To keep scope simple, leave it unhandled so it surfaces as a default
  HTTP 500. Explicit service-busy mapping (e.g. 503) will be addressed later,
  systematically, across all pools -- not here.
- Each async service that issues several sequential DB calls (e.g.
  `experiment/service.py::create_schedule` -> three; `run/service.py::poll_and_update`
  -> one or more updates) becomes one JobsDb submission **per call**, preserving
  the existing per-operation lock granularity (design: do not merge into
  transaction-like operations). This is explicitly **acceptable within this
  migration effort**; any latency optimization from batching is deferred to later
  work.

### Step 2.2d -- Rewrite synchronous callers to call helpers directly

Synchronous callers (pool workers and long-lived threads) call the converted
helpers directly -- no loop, no `run_coroutine_threadsafe`:

- **`domain/run/background.py`** (`execute_background`, runs on a pool worker --
  see 2.2e): drop the `loop` parameter and the `run_async` wrapper; call
  `db.update_run_runtime(...)`, `global_db.get_glyphs_for_resolution(...)`
  directly. These run on the RunSubmission worker thread and contend on the jobs
  `RLock` directly. (It must not submit its own DB work to JobsDb.)
- **`domain/experiment/scheduling/background.py`** (`SchedulerThread`): remove
  `_loop`, `_run_async`, and the loop capture in `start_scheduler`. Call
  `db.get_schedulable_experiments`, `experiment2runnable` (now sync -- 2.2e),
  `db.delete_experiment_next`, `db.upsert_experiment_next`,
  `db.next_schedulable_experiment` directly; replace the
  `_run_async(execute(...))` submission with a direct `submit_run_sync(...)` call
  (2.2e). The scheduler stays an unmanaged thread for now (managed-thread
  migration is Phase 4); Phase 2 only removes its DB loop dependency. The stored
  loop is assumed to serve DB access only; if implementation uncovers any non-DB
  dependency on it, that use must itself be removed, or the discovery flagged as
  a blocker for this phase.
- **`domain/plugin/manager.py`** (updater thread): replace every
  `_run_async_from_thread(<db coro>)` with a direct synchronous helper call.
  Nested async DB-orchestration helpers reachable only from this thread (e.g.
  `_ingest_plugin_templates`) must be converted to synchronous functions that
  call the converted DB helpers directly. Remove `_run_async_from_thread` and
  `PluginManager.loop` (and its assignment in `app.py`). `PluginManager.loop` is
  assumed to serve DB access only; if implementation uncovers any non-DB use of
  it, that use must itself be removed, or the discovery flagged as a blocker for
  this phase. The plugin manager's *thread ownership* is Phase 3; Phase 2 only
  removes its DB loop bridge.

### Step 2.2e -- Async-independent run-submission boundary

In `domain/run/service.py` (or a suitable run module), introduce a synchronous
submission boundary and reduce `execute` to a thin async wrapper:

```python
def submit_run_sync(
    blueprint, auth_context, run_id=None, experiment_id=None,
    experiment_version=None, compiler_runtime_context=CompilerRuntimeContext(),
    experiment_context=None,
) -> Either[ExecuteResult, str]:
    # 1. Locked jobs-DB upsert (direct, synchronous).
    new_run_id, attempt_count, created_at = run_db.upsert_run(...)
    # 2. Enqueue the long-running compile/submit to RunSubmission WITHOUT waiting.
    execution_manager.submit_monitored(
        ConcurrentPools.RunSubmission,
        TaskName("run.submit.execute"),
        partial(execute_background, new_run_id, attempt_count, created_at,
                blueprint, compiler_runtime_context, auth_context),
    )
    return Either.ok(ExecuteResult(run_id=new_run_id, attempt_count=attempt_count))


async def execute(...) -> Either[ExecuteResult, str]:
    return await execution_manager.awaitable_submit(
        ConcurrentPools.General,
        TaskName("run.submit"),
        partial(submit_run_sync, ...),
    )
```

- `submit_run_sync` runs on a General-pool worker; it performs the initial
  locked upsert directly and then enqueues `execute_background` to
  **RunSubmission** (a different pool -- allowed). It must not wait on the
  RunSubmission future.
- `execute_background` (RunSubmission worker) may wait for artifact availability;
  keeping the download work on a **different** pool (ArtifactIo, Phase 3) avoids
  self-deadlock. In Phase 2 the artifact manager still uses its own executor, so
  this ordering is safe; note the dependency for Phase 3.
- Async routes keep calling `await execute(...)`; the scheduler thread calls
  `submit_run_sync(...)` directly (Step 2.2d). This removes the
  `loop.run_in_executor(None, execute_background, ...)` default-executor path.
- Convert `experiment2runnable` (`domain/experiment/scheduling/job_utils.py`)
  into a **synchronous** function: its DB work (`experiment_db.get_experiment_definition`,
  `blueprint_db.get_blueprint`) becomes direct sync calls. The scheduler thread
  calls it directly; any async caller submits it to `ConcurrentPools.JobsDb`
  (audit whether any async caller exists -- currently only the scheduler thread
  calls it).

### Step 2.2f -- Remove the old async jobs paths

After all callers compile against the sync helpers, remove:

- `asyncio.run_coroutine_threadsafe` DB bridges: `run/background.py::run_async`,
  `scheduling/background.py::_run_async`, `plugin/manager.py::_run_async_from_thread`.
- Stored loop references used only for DB work: `SchedulerThread._loop`,
  `PluginManager.loop` (and its assignment in `app.py` lifespan), the
  `loop` parameter threaded through `execute`/`execute_background`.
- The shared jobs `asyncio.Lock` and the async `dbRetry`/session helpers in
  `utility/db.py` (replaced in 2.1b).
- The async jobs session usage from runtime operations: once every helper uses
  `sync_session_maker`, remove `async_engine` / `async_session_maker` /
  async `create_db_and_tables` from `schemata/jobs.py`. The test seam uses
  `sync_session_maker` (Step 2.1a), so no runtime code path may open the jobs
  file under the old async engine or the old `asyncio.Lock`.

Completion criterion (design 2.2): search all jobs-DB helpers and direct
session-maker imports; the cutover is complete only when **no** code path can
access the jobs file via the async engine or the old `asyncio.Lock`.

### Step 2.3 -- Honor the database migration risk list

Verify during implementation (design 2.3):

- No task submitted to `JobsDb` from a `JobsDb` worker then waits on it.
- Lock scope of every operation is unchanged.
- Each session is created/used/committed-or-rolled-back/closed on the executing
  thread; no session or live result object crosses threads; returned values are
  fully materialized (Step 2.2b).
- The sync SQLite engine + pool are configured so a connection may be checked out
  by different threads over its lifetime (`check_same_thread=False`); the jobs
  lock prevents simultaneous use.
- Queue saturation surfaces as `SubmissionRejected` and is left **unhandled**
  in this phase (default HTTP 500); never add a direct fallback DB call from
  async code. Explicit service-busy mapping is deferred (Step 2.2c).
- DB tasks are not auto-retried by the manager; only the narrow SQLite
  `OperationalError` retry inside `dbRetry` applies.
- No helper waits on futures/pool submissions/domain locks while holding the
  jobs lock. Synchronous callers may hold a domain lock (e.g. `scheduler_lock`)
  before entering the DB layer only where that order is already deliberate.

## TaskName conventions

Use namespaced, past/imperative operation names so status output is legible:
`"blueprint.get"`, `"blueprint.upsert"`, `"run.upsert"`, `"run.runtime.update"`,
`"experiment.definition.get"`, `"experiment.next.upsert"`, `"glyph.resolution"`,
`"plugin.state.get"`, `"run.submit"`, `"run.submit.execute"`. Keep them stable
across call sites for the same helper.

## Validation

- `uv run prek` before committing.
- Targeted type check / lint on the changed backend modules.
- Run the existing jobs-DB unit tests after switching them to synchronous style
  (they call `sync_session_maker` directly; a `StaticPool` in-memory maker keeps
  the schema visible across threads): at minimum
  `tests/unit/domain/blueprint/test_blueprint_db.py`,
  `tests/unit/domain/plugins/test_plugin_db.py`, and any run/experiment/glyph DB
  and scheduler tests. Broaden to the affected route/service tests.
- Manual smoke: start the backend, confirm `/api/v1/status` shows JobsDb ready,
  create/list a blueprint, create a run, and (if enabled) let the scheduler tick
  -- confirming no `run_coroutine_threadsafe` / loop-retention paths remain.
