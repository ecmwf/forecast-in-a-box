# Backend concurrency rework: migration plan

## Status

First migration iteration. This document maps the current backend concerns onto
the target architecture in
[`backend-concurrencyRework-design.md`](backend-concurrencyRework-design.md).
The documents must be reviewed and updated together.

This plan intentionally excludes `frontend/`, `cli/`, and `backend/packages/`.
It also excludes test design.

## Current concurrency inventory

| Concern | Current ownership | Current behavior | Target ownership |
| --- | --- | --- | --- |
| Artifact catalog and downloads | `domain/artifact/manager.py` | Lazily creates a private one-worker `ThreadPoolExecutor`; shared immutable state records catalog, local files, and progress | Named one-worker artifact I/O pool initially; shared network pool only after SSH safety is resolved |
| Plugin loading and updates | `domain/plugin/manager.py` | Stores one ad hoc updater thread and the FastAPI loop; waits on async DB work with `run_coroutine_threadsafe` | Named serialized plugin-management pool plus jobs DB pool |
| Plugin store initialization | `domain/plugin/store.py` | Creates one ad hoc thread for HTTP/file store discovery | Named network pool |
| Scheduled execution | `domain/experiment/scheduling/background.py` | Custom long-lived thread stores the FastAPI loop, condition/event state, and liveness fields | Execution-manager long-lived thread plus jobs DB pool |
| Run compilation/submission | `domain/run/service.py`, `domain/run/background.py` | Uses the asyncio default executor; worker retains the FastAPI loop for DB calls | Named run-submission pool plus jobs DB and artifact/network pools |
| Run log ZIP creation | `routes/run.py` | Uses the asyncio default executor | Named general pool |
| Lens process start | `routes/lens.py`, `domain/lens/manager.py` | A synchronous FastAPI route starts a subprocess; FastAPI may run the route in a framework thread | Async route awaiting a named general-pool task; subprocess lifecycle remains domain-owned |
| Root status probes | `routes/status.py` | Synchronous route performs network calls and directly inspects scheduler/plugin globals | Async route using named pools and composed execution/dispatcher status |
| Jobs SQLite access | `utility/db.py` and domain DB modules | One global `asyncio.Lock`; background threads send coroutines to the FastAPI loop | One-worker jobs DB pool, sync DB helpers, regular jobs lock |
| Users SQLite access | Auth/admin DB modules | Shares the jobs async lock in some helpers; FastAPI Users sessions bypass that shared helper | Independent users async lock and retry path |
| Cross-domain template reaction | `domain/plugin/manager.py` | In-body imports breach the domain hierarchy for ingest and unload | Producer events and consumer-owned handlers |
| Notification delivery | None | No WebSocket endpoint or notification broker | Event handler plus process-local WebSocket hub |
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
- Keep existing route response fields during the transition. New operational
  detail should be additive or exposed separately.

## Phase 1: add the runtime beside the old system

### 1.1 Split utility helpers without breaking old imports

Create:

```text
utility/concurrency/__init__.py
utility/concurrency/manager.py
utility/concurrency/ports.py
utility/concurrency/shutdown.py
utility/concurrency/synchronization.py
utility/dispatcher.py
```

Move or copy the free-port, shutdown, and timed-acquire implementations into
their target modules. Keep `utility/concurrent.py` as a compatibility layer
until all imports migrate. Do not move `delayed_thread`; it becomes obsolete
when plugin startup uses `submit_after`.

### 1.2 Add central configuration

Add pool sizes, pending limits, event queue capacity, failure history size, and
shutdown timeout with backwards-compatible defaults. Validate:

- positive worker and capacity counts;
- required pool names;
- exactly one jobs DB worker;
- any dedicated serialized pool has one worker.

Recommended initial pools:

| Pool | Workers | Initial consumers |
| --- | ---: | --- |
| `general` | 2 | Compilation/submission, archive creation, short blocking setup |
| `network` | 4 | Catalogs, downloads, store HTTP, status probes |
| `run-submission` | 2 | Long run compilation/submission tasks and artifact waits |
| `artifact-io` | 1 | Catalog scans and downloads while one SSH command handle is shared |
| `plugin-management` | 1 | Pip/install/import/reload operations that must not overlap |
| `jobs-db` | 1 | All jobs SQLite reads and writes |

The extra `plugin-management` pool is recommended because import and
environment mutation are serialized for correctness, not merely because they
use network and disk. `artifact-io` preserves the existing serialization of a
shared SSH command handle. `run-submission` prevents hour-long artifact waits
from consuming all general-purpose capacity.

### 1.3 Start the unused runtime

In `entrypoint/app.py`, after schema creation:

1. Start all configured pools.
2. Discover `domain.*.dispatchers`.
3. Register and freeze handlers.
4. Start `event-dispatcher` through the execution manager.

At this stage, old scheduler and manager threads continue unchanged. The new
pools may be mostly idle, which proves coexistence without double-owning work.

The lifespan shutdown stops the dispatcher and execution manager after old
components have been joined. As concerns migrate, remove their old join calls.

### 1.4 Add operational status

Compose execution and dispatcher snapshots into an operational status surface.
Keep the current `api`, `cascade`, `ecmwf`, `scheduler`, `version`, and `plugins`
fields while they remain public. Choose during review whether detailed pool and
thread data is:

- added as optional nested fields to `/api/v1/status`; or
- exposed by a separate admin-only route.

Do not make a GET status call restart threads. If restart is exposed, use an
explicit mutating admin operation.

## Phase 2: separate and serialize database access

This phase removes the reason background workers retain the FastAPI loop.

### 2.1 Split users and jobs synchronization

Replace the generic global lock in `utility/db.py` with explicitly named paths:

- a regular `threading.RLock` and synchronous retry helper for jobs DB work;
- an independent `asyncio.Lock` and async retry helper for users DB work.

Update the FastAPI Users database adapter and admin user helpers to share the
users lock. Acquire it around individual adapter persistence methods, not
around the lifetime of the request-scoped session: an authenticated admin route
may call an admin DB helper before the authentication dependency releases its
session. Retryable adapter methods must roll back or replace failed session
state before retry; otherwise they surface the operational error. They remain
on the async users engine and never submit to `jobs-db`.

This users change can land separately because it affects a different SQLite
file.

### 2.2 Convert the jobs runtime engine and DB helpers

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
# TODO investigate concurrent reads
```

### 2.3 Move every jobs DB caller in the same cutover

Async services and routes use:

```python
await execution_manager.submit_and_wait(
    JOBS_DB_POOL,
    task_name,
    partial(db_function, ...),
)
```

Background workers use:

```python
execution_manager.submit_unmonitored(
    JOBS_DB_POOL,
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
    # long-running execution task without waiting for it.
    ...


async def execute(...) -> Either[ExecuteResult, str]:
    return await execution_manager.submit_and_wait(
        GENERAL_POOL,
        TaskName("run.submit"),
        partial(submit_run_sync, ...),
    )
```

The scheduler can call `submit_run_sync` from its own managed thread after
Phase 4; async routes retain the `execute` wrapper. Similarly, convert
`experiment2runnable` into a synchronous operation submitted as one `jobs-db`
task, so the scheduler can retrieve its result with a concurrent future and no
async loop.

Search all jobs DB helpers and direct session-maker imports before switching.
The cutover is complete only when no old runtime path can access the jobs file
under the old async lock.

### 2.4 Database migration risks

- Do not submit from the jobs DB worker back to `jobs-db` and wait.
- Do not hold domain state locks while waiting for a DB future.
- Keep a transaction inside one database task.
- Ensure SQLite connections are created and used on the worker thread expected
  by the selected SQLAlchemy pool configuration.
- Treat queue saturation as an explicit service-busy failure, not as a direct
  fallback DB call.
- Database tasks are not automatically retried by the execution manager; only
  the narrow SQLite retry policy applies.

## Phase 3: migrate executor-backed work

These cases can migrate independently after the execution manager exists.

### 3.1 Artifact catalog and downloads

In `domain/artifact/manager.py`:

- remove `ArtifactManager.executor` and `_ensure_pool`;
- initially submit catalog refresh and downloads to the centrally configured
  one-worker `artifact-io` pool;
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
connection. After that refactor, file/HTTP-safe work may move to `network`.

The existing delete/download race is not caused by this architecture and should
not be expanded into this migration unless moving submission exposes it.

### 3.2 Plugin store initialization

In `domain/plugin/store.py`:

- remove `stores_updater`;
- submit initialization to `network`;
- preserve immutable publication of the completed store map;
- record failure through monitored task status and the existing domain-facing
  status/error surface as needed;
- remove `join_stores_thread`.

Store initialization now shares network capacity with other safe HTTP probes
and becomes visible in the common pool status. Artifact catalog work remains on
`artifact-io` until the shared SSH handle constraint is removed.

### 3.3 Plugin installation, import, and reload

In `domain/plugin/manager.py`:

- remove `PluginManager.updater` and its manual thread creation;
- remove `PluginManager.loop`;
- submit initial load and single updates to the one-worker
  `plugin-management` pool;
- keep the one-at-a-time behavior by pool configuration;
- derive busy/failed status from manager task state plus existing domain errors;
- use `submit_after(catalog_future, ...)` for initial loading instead of
  `delayed_thread`;
- remove `join_updater_thread`.

`submit_after` should skip initial load when the catalog dependency failed
unless existing behavior is explicitly retained. The current helper proceeds
after dependency failure; this needs a deliberate decision rather than an
accidental carry-over.

Plugin DB work uses the jobs DB pool from Phase 2. Do not wait for a
plugin-management task while holding the plugin state lock.

### 3.4 Run compilation and submission

In `domain/run/service.py` and `domain/run/background.py`:

- replace `loop.run_in_executor(None, ...)` with a monitored
  `run-submission` task;
- remove the event-loop parameter and local `run_async` bridge if it was not
  already removed in the atomic Phase 2 caller cutover;
- retain the Phase 2 jobs DB future calls;
- preserve the current rule that every background failure records a failed run
  state;
- preserve immediate route return after the initial run row is committed.

The task currently mixes compilation, database state changes, gateway network
calls, and waiting for artifact downloads. The first migration may keep it as
one general-pool task for behavioral safety. A later refinement may split
network stages, but must preserve failure state and ordering.

Artifact waits may last up to an hour, so they must not occupy the general pool.
The initial configuration uses the dedicated, centrally managed
`run-submission` pool. Its worker count remains a configuration decision based
on the desired uniform progress across concurrent runs.

### 3.5 Run log archive creation

In `routes/run.py`, replace the default executor call with:

```python
await execution_manager.submit_and_wait(
    GENERAL_POOL,
    TaskName("run.logs.build-archive"),
    _build_zip,
)
```

Keep gateway I/O out of the async loop as well. It may run on `network` before
the archive task, or the complete existing blocking operation may initially run
on `general`.

### 3.6 Blocking synchronous routes

Convert migrated blocking route handlers to `async def` and explicitly submit
their blocking sections. Initial cases:

- lens subprocess startup to `general`;
- root status network probes to `network`;
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
  thread specification;
- make the entrypoint accept the manager-owned stop event;
- retain a domain-owned wake/prod event for schedule changes;
- use `stop_event.wait(timeout)` or a bounded wakeable condition;
- move liveness, native thread id, failure, and restart reporting to execution
  status;
- submit jobs DB operations to `jobs-db`;
- retrieve the synchronous `experiment2runnable` jobs DB task and call the
  Phase 2 `submit_run_sync` service boundary;
- remove the stored FastAPI loop and `run_coroutine_threadsafe`;
- remove `Globals.scheduler` after all call sites use the manager thread id.

Register the scheduler thread only when scheduling is enabled. A recommended
restart policy is capped on-failure restart, requested by an explicit
supervisor/admin action. The scheduling loop must tolerate being entered by a
new `Thread` instance after failure.

`prod_scheduler()` remains a domain operation but only sets the wake event. It
does not own or start the thread.

Once migrated, preserve the existing `scheduler` status field by translating
the execution snapshot into `off`, `up`, or `down`.

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

Register these handlers on `general`, never on `plugin-management` or
`jobs-db`. The producer occupies the one-worker `plugin-management` pool while
waiting for required dispatch completion, so using that pool for the handler
would deadlock. The handler submits its DB operations to `jobs-db`.

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
2. Wait for completion if route success must mean templates are removed.
3. Remove in-memory plugin state at the agreed point.

The exact unload ordering is an open decision. Removing templates before
unpublishing gives stronger consistency on handler failure; unpublishing first
prevents new use immediately. The handler only needs the id for deletion, so
either is technically possible.

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

## Phase 6: proof-of-concept WebSocket notifications

This is new backend behavior, not a migration of an existing endpoint.

### 6.1 Add a small notification domain

Add a process-local notification hub that owns:

- active connection/subscription ids;
- recipient identity;
- one bounded `asyncio.Queue` per connection;
- register, unregister, and fan-out operations;
- the FastAPI loop reference needed only to use
  `loop.call_soon_threadsafe(queue.put_nowait, message)` from a dispatcher
  handler.

This loop reference belongs to the WebSocket adapter/hub, not to background
business workers or database code.

Define a notification event payload containing at least:

```python
recipient: str | None
level: Literal["info", "warning", "error"]
message: str
context: dict[str, object]
```

`recipient=None` means broadcast only if review explicitly approves that
behavior.

### 6.2 Register a notification handler

Add `domain/notification/dispatchers.py` with a handler for a name such as
`notification.emitted`. The handler runs in a suitable named pool and asks the
hub to enqueue the immutable notification onto matching per-connection async
queues.

Any background task can then call `submit_event(Event(...))`; it does not know
about WebSockets or the async loop.

Dispatch completion means the notification was queued to connection buffers.
It does not acknowledge network delivery.

### 6.3 Add the WebSocket route

Add an auto-discovered route module with one endpoint, provisionally:

```text
/api/v1/notifications
```

On connection:

1. Authenticate the user with the existing backend auth mode.
2. Accept the socket.
3. Register a bounded queue in the hub.
4. Await queue items and send JSON messages.
5. Unregister in `finally` on disconnect or cancellation.

The endpoint does not poll execution state and does not read either database.
No frontend contract is part of this change.

### 6.4 Slow clients and shutdown

Recommended PoC behavior:

- bounded queue per connection;
- when full, record the condition and disconnect that slow client rather than
  blocking the dispatcher or silently dropping arbitrary messages;
- no replay for clients that reconnect;
- close all sockets and unregister queues during lifespan shutdown before the
  dispatcher is stopped.

### 6.5 PoC questions

1. What authentication mechanism should the WebSocket handshake use in
   authenticated mode?
2. Is broadcast (`recipient=None`) allowed, or must every notification be
   addressed?
3. What stable JSON envelope and version field should the PoC expose?
4. Is disconnecting a slow client acceptable, or should oldest notifications
   be dropped with an explicit overflow message?
5. Does the first PoC need delivery acknowledgements or replay? The design
   recommends neither.

## Phase 7: consolidate startup, shutdown, and status

Update `entrypoint/app.py` to the final sequence from the design document.
Remove direct calls to:

- `start_scheduler` / `stop_scheduler`;
- `join_updater_thread`;
- `join_stores_thread`;
- `join_artifact_manager`.

The entrypoint should contain declarations and ordering, not component-specific
join algorithms.

On shutdown:

1. stop accepting WebSocket/domain submissions;
2. close notification sockets;
3. signal scheduler and other producer threads;
4. close and drain events within the deadline;
5. stop the dispatcher;
6. shut down pools;
7. retain existing external process and tunnel cleanup.

Use the execution snapshot for all migrated thread/pool health. Keep separate
business checks, such as remote service reachability, outside the manager.

## Phase 8: remove compatibility code

After all call sites migrate:

- delete private executor/thread fields from manager classes;
- delete stored FastAPI loop fields used by background work;
- delete `delayed_thread`;
- remove `run_coroutine_threadsafe` and default-executor calls from backend
  business code;
- migrate remaining imports from `utility/concurrent.py`;
- delete `utility/concurrent.py`;
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

1. Runtime modules, configuration, discovery, lifecycle, and status.
2. Users DB lock separation.
3. Atomic jobs DB cutover, caller rewrite, and sync run/scheduler service
   boundaries.
4. Artifact I/O and store network work.
5. Plugin serialized work and startup continuation.
6. Run background work and route archive creation.
7. Scheduler long-lived thread.
8. Circular dependency events.
9. WebSocket notification PoC.
10. Blocking route cleanup, final startup/status consolidation, and removal of
    compatibility code.

The database cutover is intentionally early: every later background migration
then uses the final sync database path and never needs a temporary event-loop
bridge.

## Cross-document decisions still required

- Initial pool counts and whether run submission receives a dedicated pool.
- Event completion receipts in the first dispatcher implementation.
- Explicit versus periodic restart requests.
- Status endpoint shape.
- Event shutdown drain guarantee.
- Single-process backend invariant.
- Plugin unload event ordering.
- WebSocket authentication, addressing, envelope, and overflow behavior.
