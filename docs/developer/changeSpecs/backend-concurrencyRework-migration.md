# Backend concurrency rework: migration plan

## Status

Final migration iteration. This document maps the current backend concerns onto
the target architecture in
[`backend-concurrencyRework-design.md`](backend-concurrencyRework-design.md).
The documents must be reviewed and updated together.

This plan intentionally excludes `frontend/`, `cli/`, and `backend/packages/`.
It also excludes test design.

## Current concurrency inventory

| Concern | Current ownership | Current behavior | Target ownership |
| --- | --- | --- | --- |
| Artifact catalog and downloads | `domain/artifact/manager.py` | Lazily creates a private one-worker `ThreadPoolExecutor`; shared immutable state records catalog, local files, and progress | Named one-worker artifact I/O pool initially; shared I/O pool only after SSH safety is resolved |
| Plugin loading and updates | `domain/plugin/manager.py` | Stores one ad hoc updater thread and the FastAPI loop; waits on async DB work with `run_coroutine_threadsafe` | Named serialized plugin-management pool plus jobs DB pool |
| Plugin store initialization | `domain/plugin/store.py` | Creates one ad hoc thread for HTTP/file store discovery | Named I/O pool |
| Scheduled execution | `domain/experiment/scheduling/background.py` | Custom long-lived thread stores the FastAPI loop, condition/event state, and liveness fields | Stage-1 execution-manager thread plus jobs DB pool |
| Run compilation/submission | `domain/run/service.py`, `domain/run/background.py` | Uses the asyncio default executor; worker retains the FastAPI loop for DB calls | Named run-submission pool plus jobs DB and artifact/I/O pools |
| Run log ZIP creation | `routes/run.py` | Uses the asyncio default executor | Named general pool |
| Lens process start | `routes/lens.py`, `domain/lens/manager.py` | A synchronous FastAPI route starts a subprocess; FastAPI may run the route in a framework thread | Async route awaiting a named general-pool task; subprocess lifecycle remains domain-owned |
| Root status probes | `routes/status.py` | Synchronous route performs network calls and directly inspects scheduler/plugin globals | Async route using named pools and one composed concurrency status |
| Jobs SQLite access | `utility/db.py` and domain DB modules | One global `asyncio.Lock`; background threads send coroutines to the FastAPI loop | One-worker jobs DB pool, sync DB helpers, regular jobs lock |
| Users SQLite access | Auth/admin DB modules | Shares the jobs async lock in some helpers; FastAPI Users sessions bypass that shared helper | Independent users async lock and retry path |
| Cross-domain template reaction | `domain/plugin/manager.py` | In-body imports breach the domain hierarchy for ingest and unload | Producer events and consumer-owned handlers |
| Notification delivery | None | No WebSocket endpoint or notification broker | Event-to-async-loop logging PoC through `ActiveWebsocketClientRegistry`; no endpoint |
| Jobs database garbage collection | None | Versioned and tombstoned rows are retained indefinitely | Stage-2 periodic thread submitting a simple read-only PoC query to the jobs DB pool |
| Startup/shutdown | `entrypoint/app.py` | Starts and joins each manager separately in a hand-written order | Configure, start, inspect, and stop the shared runtime |

`utility/concurrent.py` also owns timed lock acquisition, free-port allocation,
and child-process shutdown helpers. These are utility moves, not execution
manager responsibilities.

The backend process also contains framework/library threads and separately
managed child processes. They should appear as unregistered diagnostics where
Python exposes them, but are not migrated into the execution manager.

## Migration rules

- Add the new runtime before moving any existing concern.
- Move one concern atomically from old ownership to new ownership. Never submit
  the same work through both paths.
- Preserve existing domain state and progress contracts unless a step explicitly
  replaces them with events.
- Do not leave compatibility code that can create a second executor after the
  new path is active.
- Avoid the asyncio and AnyIO default executors in migrated code.
- A jobs-database cutover is one coordinated migration across all jobs DB
  helpers and callers; two independent locking models must not write the file at
  the same time.
- Route response fields may move or be renamed as part of this backend
  migration. The developer should define the coherent target response without
  preserving obsolete status fields; corresponding frontend refactoring is
  explicitly separate and outside this plan.

## Phase 0: prepare utilities and isolate users persistence

### 0.1 Split utility helpers and update all imports

Create:

```text
utility/concurrency/__init__.py
utility/concurrency/ports.py
utility/concurrency/shutdown.py
utility/concurrency/synchronization.py
```

Move the free-port, shutdown, timed-acquire, and `delayed_thread`
implementations into their target modules. `delayed_thread` belongs in
`synchronization.py` and its docstring marks it as temporary pending migration
to `submit_after`.

Update every existing import in the same change and delete
`utility/concurrent.py`. This includes production and test import paths so
collection is not broken by the atomic move; it does not require designing new
tests. Do not create a compatibility re-export module.

### 0.2 Isolate users database helpers

Copy the current async lock and `dbRetry` behavior needed by administrative user
operations into `domain/auth/db.py`, with explicit users-database names. Update
that module's helpers to use the local implementation.

Preserve the existing async SQLAlchemy/aiosqlite and FastAPI Users behavior; do
not introduce execution-manager integration or a new database adapter. After
this phase, `utility/db.py` serves only jobs persistence and the later atomic
jobs conversion has no users-database callers.

## Phase 1: add the runtime beside the old system

### 1.1 Add central configuration

Add pool sizes, pending limits, failure history size, and shutdown timeout under
concurrency settings. Add event queue capacity under separate dispatcher
settings. Both have backwards-compatible defaults. Define
`ConcurrentPools` and `ConcurrentThreads` in `utility/config.py`. Validate:

- positive worker and capacity counts;
- required pool names;
- exactly one jobs DB worker;
- any dedicated serialized pool has one worker.

Recommended initial pools:

| Pool | Workers | Initial consumers |
| --- | ---: | --- |
| `ConcurrentPools.General` | 2 | Archive creation and short blocking setup |
| `ConcurrentPools.Io` | 4 | Store HTTP, status probes, and general network/disk transfers |
| `ConcurrentPools.RunSubmission` | 2 | Long run compilation/submission tasks and artifact waits |
| `ConcurrentPools.ArtifactIo` | 1 | Catalog scans and downloads while one SSH command handle is shared |
| `ConcurrentPools.PluginManagement` | 1 | Pip/install/import/reload operations that must not overlap |
| `ConcurrentPools.JobsDb` | 1 | All jobs SQLite reads and writes |

`ConcurrentPools.PluginManagement` is separate because import and
environment mutation are serialized for correctness, not merely because they
use I/O. `ConcurrentPools.ArtifactIo` preserves the existing serialization of
a shared SSH command handle. `ConcurrentPools.RunSubmission` prevents
hour-long artifact waits from consuming all general-purpose capacity.

### 1.2 Implement and start the unused runtime

Add `utility/concurrency/manager.py` and `utility/dispatcher.py`.

In `entrypoint/app.py`, after schema creation:

1. Register every pool at stage 0.
2. Discover `domain.*.dispatchers`, register handlers, and freeze registration.
3. Register `ConcurrentThreads.EventDispatcher` at stage 0 with its entrypoint,
   stop request, and status provider.
4. Call `ExecutionManager.start()`, which warms all pools before starting the
   dispatcher.

At this stage, old scheduler and manager threads continue unchanged. The new
pools may be mostly idle, which proves coexistence without double-owning work.

The lifespan shutdown stops old components first, then asks the manager to stop
its stage-0 dispatcher and pools. As concerns migrate, replace their direct
joins with staged registrations.

### 1.3 Add operational status

Extend the existing `/api/v1/status` response with
`concurrency.pools` and `concurrency.threads`. The event dispatcher's registered
component status appears under its thread entry. As each old component
migrates, move its status under the corresponding concurrency object; retaining
the former top-level field is not required.

Do not make a GET status call restart threads. If restart is exposed, use an
explicit mutating admin operation.

## Phase 2: separate and serialize database access

This phase removes the reason background workers retain the FastAPI loop.

### 2.1 Convert the jobs runtime engine and DB helpers

For `schemata/jobs.py`, add the synchronous engine/session maker used by runtime
DB operations. Schema creation may remain in the existing startup path until
the cutover, but runtime access after cutover uses the sync session maker.

Convert all jobs database helper modules together:

- `domain/blueprint/db.py`
- `domain/experiment/db.py`
- `domain/experiment/scheduling/db.py`
- `domain/glyphs/global_db.py`
- `domain/plugin/db.py`
- `domain/run/db.py`

Each public operation becomes synchronous and owns one complete
session/transaction. Combine current multi-call read-modify-write operations
into one submitted callable so no other database task can interleave.

The synchronous retry wrapper holds the jobs `RLock`, retries the whole
operation on SQLite `OperationalError`, and contains:

```python
# TODO investigate concurrent reads. SQLite should support concurrent readers,
# but this first implementation deliberately serializes all access.
```

### 2.2 Move every jobs DB caller in the same cutover

Async services and routes use:

```python
await execution_manager.awaitable_submit(
    ConcurrentPools.JobsDb,
    task_name,
    partial(db_function, ...),
)
```

Background workers use:

```python
execution_manager.submit_unmonitored(
    ConcurrentPools.JobsDb,
    task_name,
    partial(db_function, ...),
).result()
```

Remove:

- stored FastAPI loop references used only for DB work;
- `asyncio.run_coroutine_threadsafe` DB bridges;
- the shared jobs `asyncio.Lock`;
- async jobs session usage from runtime operations.

The same Phase 2 cutover must update every jobs DB caller, including:

- `domain/run/background.py`;
- `domain/run/service.py`;
- `domain/experiment/scheduling/background.py`;
- `domain/experiment/scheduling/job_utils.py`;
- all routes and domain services importing the converted DB helpers.

This caller rewrite is not deferred to the later thread-ownership phases.
Existing threads may remain temporarily, but their DB calls must already use
jobs DB futures rather than passing now-synchronous results to
`run_coroutine_threadsafe`.

Create an async-independent run submission boundary during this cutover:

```python
def submit_run_sync(...) -> Either[ExecuteResult, str]:
    # Submit and wait for the initial jobs DB upsert, then enqueue the
    # long-running execution task to ConcurrentPools.RunSubmission without
    # waiting for it.
    ...


async def execute(...) -> Either[ExecuteResult, str]:
    return await execution_manager.awaitable_submit(
        ConcurrentPools.General,
        TaskName("run.submit"),
        partial(submit_run_sync, ...),
    )
```

The scheduler can call `submit_run_sync` from its own managed thread after
Phase 4; async routes retain the `execute` wrapper. Similarly, convert
`experiment2runnable` into a synchronous operation submitted as one
`ConcurrentPools.JobsDb` task, so the scheduler can retrieve its result with a
concurrent future and no async loop.

The Phase 2 cutover therefore also removes the default-executor submission for
this path. Phase 3.4 finishes consolidation of the background task and its
status/failure ownership; it does not temporarily route new work through the
old default executor.

Search all jobs DB helpers and direct session-maker imports before switching.
The cutover is complete only when no old runtime path can access the jobs file
under the old async lock.

### 2.3 Database migration risks

- Do not submit from the jobs DB worker back to `ConcurrentPools.JobsDb` and
  wait.
- Do not hold domain state locks while waiting for a DB future.
- Keep a transaction inside one database task.
- Ensure SQLite connections are created and used on the worker thread expected
  by the selected SQLAlchemy pool configuration.
- Treat queue saturation as an explicit service-busy failure, not as a direct
  fallback DB call.
- Database tasks are not automatically retried by the execution manager; only
  the narrow SQLite retry policy applies.
- This is one coordinated cutover. No async jobs access remains after its
  merge, while Phase 0 has already removed users persistence from its scope.

## Phase 3: migrate executor-backed work

These cases can migrate independently after the execution manager exists.

### 3.1 Artifact catalog and downloads

In `domain/artifact/manager.py`:

- remove `ArtifactManager.executor` and `_ensure_pool`;
- initially submit catalog refresh and downloads to the centrally configured
  one-worker `ConcurrentPools.ArtifactIo` pool;
- keep the current immutable catalog, local availability, progress map, and
  short state lock;
- use monitored submissions for fire-and-forget downloads;
- return an unmonitored future for startup catalog refresh because plugin
  startup depends on it;
- remove executor shutdown from `join_artifact_manager`.

The current run-submission path may wait for artifact availability. It is safe
only while downloads use a different pool. Do not place both the waiter and the
download task on the same saturated pool.

The current private one-worker executor also serializes use of a shared SSH
command handle; its lock protects handle creation/reconnection, not each command
performed with that handle. Do not widen artifact work onto the shared network
pool until command execution is serialized or each task receives an independent
connection. After that refactor, file/HTTP-safe work may move to
`ConcurrentPools.Io`.

The existing delete/download race is not caused by this architecture and should
not be expanded into this migration unless moving submission exposes it.

### 3.2 Plugin store initialization

In `domain/plugin/store.py`:

- remove `stores_updater`;
- submit initialization to `ConcurrentPools.Io`;
- preserve immutable publication of the completed store map;
- record failure through monitored task status and the existing domain-facing
  status/error surface as needed;
- remove `join_stores_thread`.

Store initialization now shares I/O capacity with other safe HTTP probes and
becomes visible in the common pool status. Artifact catalog work remains on
`ConcurrentPools.ArtifactIo` until the shared SSH handle constraint is removed.

### 3.3 Plugin installation, import, and reload

In `domain/plugin/manager.py`:

- remove `PluginManager.updater` and its manual thread creation;
- remove `PluginManager.loop`;
- submit initial load and single updates to the one-worker
  `ConcurrentPools.PluginManagement` pool;
- keep the one-at-a-time behavior by pool configuration;
- derive busy/failed status from manager task state plus existing domain errors;
- use `submit_after(catalog_future, ...)` for initial loading instead of
  `delayed_thread`;
- remove `join_updater_thread`.

The dedicated one-worker pool is temporary serialization for process-global
package/import mutation: concurrent `pip install`, module reload, and catalogue
publication must not overlap. The plugin state lock protects short immutable
snapshot swaps; it must not be held across a long `pip` operation. Add this
reason as a code comment beside the pool choice. A future manager-owned
serialized resource queue could gate package mutation and then use
`ConcurrentPools.Io`, allowing this dedicated pool to be removed without
relying on a long-held domain lock.

`submit_after` skips initial load when the catalog dependency failed, records
the dependency failure, and leaves plugin readiness false. Do not preserve the
current helper's behavior of continuing after that failure.

Plugin DB work uses the jobs DB pool from Phase 2. Do not wait for a
plugin-management task while holding the plugin state lock.

### 3.4 Run compilation and submission

In `domain/run/service.py` and `domain/run/background.py`:

- retain the monitored `ConcurrentPools.RunSubmission` path introduced by the
  atomic Phase 2 caller cutover;
- confirm the event-loop parameter and local `run_async` bridge were removed in
  that cutover;
- retain the Phase 2 jobs DB future calls;
- preserve the current rule that every background failure records a failed run
  state;
- preserve immediate route return after the initial run row is committed.

The task currently mixes compilation, database state changes, gateway network
calls, and waiting for artifact downloads. The first migration may keep it as
one run-submission task for behavioral safety. A later refinement may split I/O
stages, but must preserve failure state and ordering.

Multiple required artifacts may eventually justify a manager API such as
`submit_after_all` that waits for a group of futures before continuing. The
current manager intentionally supports one dependency future only. Do not add
group aggregation during this effort; document it as a later execution-manager
refactor when the run workflow itself is split.

Artifact waits may last up to an hour, so they must not occupy the general pool.
The initial configuration uses the dedicated, centrally managed
`ConcurrentPools.RunSubmission` pool. Its worker count remains a configuration
decision based on the desired uniform progress across concurrent runs.

### 3.5 Run log archive creation

In `routes/run.py`, replace the default executor call with:

```python
await execution_manager.awaitable_submit(
    ConcurrentPools.General,
    TaskName("run.logs.build-archive"),
    _build_zip,
)
```

Keep gateway I/O out of the async loop as well. It may run on
`ConcurrentPools.Io` before the archive task, or the complete existing blocking
operation may initially run on `ConcurrentPools.General`.

### 3.6 Blocking synchronous routes

Convert migrated blocking route handlers to `async def` and explicitly submit
their blocking sections. Initial cases:

- lens subprocess startup to `ConcurrentPools.General`;
- root status network probes to `ConcurrentPools.Io`;
- any route whose synchronous form currently relies on FastAPI/AnyIO's implicit
  worker pool.

The execution manager owns only the submitted blocking section. Lens subprocess
registration, status, stop, port ownership, and application-shutdown cleanup
remain in `domain/lens/manager.py`; the subprocess itself is not a managed
thread.

After each route migration, verify it no longer calls `run_in_executor(None, ...)`,
`asyncio.to_thread`, or an untracked blocking function from the async loop.

## Phase 4: migrate the scheduler thread

In `domain/experiment/scheduling/background.py`:

- replace `SchedulerThread` construction with an execution-manager long-lived
  stage-1 `ConcurrentThreads.Scheduler` registration;
- make the entrypoint accept the manager-owned stop event;
- retain a domain-owned wake/prod event for schedule changes;
- use `stop_event.wait(timeout)` or a bounded wakeable condition;
- register a non-blocking component status provider for scheduler liveness and
  last/next iteration; let the manager add native thread id, failure, and
  restart reporting;
- register a stop request that wakes the scheduling condition;
- submit jobs DB operations to `ConcurrentPools.JobsDb`;
- retrieve the synchronous `experiment2runnable` jobs DB task and call the
  Phase 2 `submit_run_sync` service boundary;
- remove the stored FastAPI loop and `run_coroutine_threadsafe`;
- remove `Globals.scheduler` after all call sites use the manager thread id.

Register the scheduler thread only when scheduling is enabled. A recommended
restart policy is capped on-failure restart, requested by an explicit
internal or admin operation. The scheduling loop must tolerate being entered by
a new `Thread` instance after failure.

`prod_scheduler()` remains a domain operation but only sets the wake event. It
does not own or start the thread.

Once migrated, move scheduler detail from the top-level status field to
`concurrency.threads.scheduler`. When scheduling is disabled, expose a disabled
registered/component state or omit the thread according to the final status
DTO; do not retain a duplicate top-level field.

## Phase 5: remove the circular domain dependency with events

This phase must move both current hierarchy-breaching flows:

- template ingestion after plugin publication/update;
- template removal after plugin unload.

### 5.1 Define producer-owned event contracts

Add public event names and immutable payload contracts in the producer domain,
for example:

```text
plugin.templates.changed
plugin.templates.removed
```

Payloads contain a stable plugin composite id and any operation/correlation id
needed for diagnostics. Do not place the plugin object itself in `kwargs`.

### 5.2 Move reaction logic to the consumer

Create `domain/blueprint/dispatchers.py` and export its registration tuple.
Move template conversion, glyph remapping, validation, upsert, soft-delete, and
template-error persistence behind handlers owned by the blueprint domain.

Register these handlers on `ConcurrentPools.General`, never on
`ConcurrentPools.PluginManagement` or `ConcurrentPools.JobsDb`. The producer
occupies the one-worker `ConcurrentPools.PluginManagement` pool while waiting
for required dispatch completion, so using that pool for the handler would
deadlock. The handler submits its DB operations to
`ConcurrentPools.JobsDb`.

The handler may read the producer's public plugin catalogue because blueprint
already depends on plugin. Plugin code no longer imports blueprint at module or
function scope.

For changed templates:

1. Publish the loaded plugin into the immutable plugin catalogue.
2. Emit `plugin.templates.changed`.
3. Wait for the dispatch completion before declaring initial plugin loading
   ready, preserving current startup readiness.
4. Keep per-template failure isolation and persisted template errors.

For unload:

1. Emit `plugin.templates.removed` with the stable id.
2. Wait for successful dispatch completion.
3. Only then remove the in-memory plugin state.

Template removal must be idempotent. If dispatch fails, leave the in-memory
plugin published and fail the operation; a caller retry may emit the same event
again safely. This provides at-least-once-safe application behavior without
changing the dispatcher's process-local at-most-once delivery contract.

### 5.3 Failure and readiness semantics

Event dispatch failure must:

- appear in dispatcher and execution-manager failure history;
- update the existing plugin/template error surfaces where applicable;
- prevent `plugins_ready()` from returning true while required startup
  reactions are incomplete or failed.

Redefine readiness explicitly as: plugin-management startup succeeded, and all
required startup template dispatches completed without failure. It is false
while any required dispatch receipt is pending.

Do not make a handler synchronously wait for another event whose handler is
scheduled to the same one-worker pool. If a follow-up fact is needed, emit it
without waiting or choose a different execution path.

After both flows migrate, delete `_ingest_plugin_templates`, the in-body
blueprint imports, and the circularity notes from the domain package
documentation.

## Phase 6: add a periodic jobs database maintenance PoC

This is a lifecycle and DB-pool proof of concept, not an implementation of
garbage-collection policy.

Create a wakeable entrypoint named
`ConcurrentThreads.DatabaseGarbageCollector` and register it at stage 2. It
therefore starts after the stage-1 scheduler and stops before it. Register:

- an entrypoint accepting the manager stop event;
- a stop request that wakes its sleep condition;
- a non-blocking status provider exposing last attempt/success, next wake,
  current activity, query result summary, and last failure;
- an explicit-only capped restart policy.

Hardcode a 10-minute wake interval; do not add configuration or an
administrative prod. Each iteration submits one simple, read-only query from one
existing domain to `ConcurrentPools.JobsDb`, waits for the future, records its
summary, and sleeps again. The maintenance thread never opens a SQLAlchemy
session itself.

Do not delete rows, design retention, traverse cascades, or add dynamic cleanup
discovery in this effort. Those belong to a later garbage-collection
specification. This PoC exists to demonstrate that multiple independently
managed long-lived threads can use the serialized DB pool and expose unified
status.

## Phase 7: add an event-to-async-loop notification PoC

This proves the concurrency bridge needed by future notifications. It does not
add a WebSocket route, client contract, or actual network delivery.

### 7.1 Add `ActiveWebsocketClientRegistry`

Add a process-local placeholder named `ActiveWebsocketClientRegistry`. It owns
only:

- the FastAPI event-loop reference set during lifespan startup;
- a method callable from a managed sync worker that uses
  `loop.call_soon_threadsafe` to create a coroutine task on that loop;
- lifecycle state that rejects use before initialization or after shutdown.

The scheduled coroutine logs at debug level that the supplied event would have
been sent. The placeholder has no active clients, authentication, recipient
selection, connection queues, overflow handling, replay, or acknowledgement.
Its event-loop reference is an explicit adapter exception; background business
workers do not retain the loop.

### 7.2 Register the notification handler

Add `domain/notification/dispatchers.py` with a handler for
`notification.emitted`. Register it on `ConcurrentPools.General`, as required
for this PoC. The handler forwards the event to
`ActiveWebsocketClientRegistry`, which schedules the debug-log coroutine on the
FastAPI loop.

Notification producers enqueue and continue rather than waiting for the
dispatch receipt, preventing a producer from occupying the same pool while
awaiting the handler. Any background task can submit the event without knowing
about the async loop or future WebSocket implementation.

As the concrete demonstration during Phase 7, update the stage-2 maintenance
PoC from Phase 6 to emit `notification.emitted` after its read-only query
completes. The resulting path is: managed maintenance thread -> jobs DB pool ->
event dispatcher -> general pool handler -> FastAPI-loop debug task.

### 7.3 Lifespan integration

Initialize the registry with the running loop before notification events can be
handled. Keep it available while the event dispatcher drains during shutdown,
then clear its loop reference after the dispatcher returns and before the
FastAPI lifespan exits.

No route or frontend change is part of this PoC.

## Phase 8: consolidate startup, shutdown, and status

Update `entrypoint/app.py` to the final sequence from the design document.
Remove direct calls to:

- `start_scheduler` / `stop_scheduler`;
- `join_updater_thread`;
- `join_stores_thread`;
- `join_artifact_manager`.

The entrypoint should contain declarations and ordering, not component-specific
join algorithms.

On shutdown:

1. stop accepting route/domain submissions;
2. ask the manager to stop the stage-2 maintenance PoC;
3. stop stage-1 scheduler and other producer threads;
4. stop stage-0 threads; the dispatcher's own stop request closes event intake
   and performs its bounded best-effort drain;
5. clear the loop reference in `ActiveWebsocketClientRegistry`;
6. shut down pools only after long-lived threads return;
7. retain existing external process and tunnel cleanup.

Apply one shutdown deadline with fair-share slices for the remaining resource
groups. A group may use its base slice plus time unused by earlier groups, but
must not consume time reserved for all later groups.

Use the execution snapshot for all migrated thread/pool health. Keep separate
business checks, such as remote service reachability, outside the manager.

## Phase 9: remove obsolete execution code

After all call sites migrate:

- delete private executor/thread fields from manager classes;
- delete stored FastAPI loop fields used by background work;
- delete `delayed_thread`;
- remove `run_coroutine_threadsafe` and default-executor calls from backend
  business code;
- remove obsolete manual join/status helpers;
- update backend concurrency guidance to describe the execution manager, event
  dispatcher, jobs DB pool, and independent users DB lock.

Perform a final source inventory for:

```text
threading.Thread
ThreadPoolExecutor
run_in_executor
asyncio.to_thread
run_coroutine_threadsafe
utility.concurrent
```

Each remaining occurrence must be either inside the new concurrency runtime,
an explicitly documented framework/process boundary, or a deliberate
non-migrated exception.

## Recommended implementation order

1. Utility module split/import rewrite and users DB helper isolation.
2. Runtime modules, configuration, staged lifecycle, discovery, and status.
3. Atomic jobs DB cutover, caller rewrite, and synchronous run/scheduler service
   boundaries.
4. Artifact I/O and store network work.
5. Plugin serialized work and startup continuation.
6. Run background work and route archive creation.
7. Scheduler long-lived thread.
8. Circular dependency events.
9. Periodic jobs database maintenance PoC.
10. Event-to-async-loop notification PoC.
11. Blocking route cleanup, final staged startup/status consolidation, and
    removal of obsolete execution code.

The database cutover is intentionally early: every later background migration
then uses the final sync database path and never needs a temporary event-loop
bridge.

## Deferred follow-up work

No open decisions remain for this migration scope. Later specifications may
cover:

- real garbage collection, including dynamic discovery, eligibility, retention,
  batching, ownership, and cascade order;
- a real WebSocket endpoint and delivery contract;
- group-future continuations;
- manager-owned serialized resource queues that can replace temporary
  dedicated pools.
