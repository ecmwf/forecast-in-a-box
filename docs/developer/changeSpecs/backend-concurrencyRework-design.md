# Backend concurrency rework: design

## Status

Final design iteration. This document defines the target architecture and
records explicitly deferred follow-up work. It deliberately uses generic
examples; concrete migration cases are in
[`backend-concurrencyRework-migration.md`](backend-concurrencyRework-migration.md).

## Goals

- Make every application-owned thread and thread pool centrally configured,
  named, supervised, and visible through one status snapshot.
- Share bounded pools by purpose instead of letting components create executors.
- Keep the async request loop responsive without treating higher throughput as
  the primary goal.
- Provide one process-local event bus for indirect, one-to-many reactions and
  notification handoff.
- Remove the need for background threads to retain the FastAPI event loop only
  to perform jobs-database operations.
- Serialize jobs-database access with one regular lock, using a dedicated
  one-worker pool only to bridge async callers to synchronous database
  operations, while preserving a separate async synchronization model for the
  users database.
- Support incremental adoption: the new runtime may coexist with old
  implementations, but one concrete concern must never be owned by both.

## Non-goals

- Managing child processes, remote workers, or work in another backend process.
- Increasing CPU parallelism. Python work remains subject to the GIL; a process
  pool is not part of this change.
- Durable messaging, replay, delivery across processes, or delivery after a
  backend restart.
- A real WebSocket endpoint or notification delivery contract.
- Replacing domain-owned immutable state snapshots and their short critical
  sections.
- Concurrent jobs-database reads in the first implementation.
- Managing threads created internally by Uvicorn, FastAPI, AnyIO, SQLAlchemy, or
  other libraries.

The execution status should report application-owned threads precisely and also
include a diagnostic list of currently visible, unregistered Python threads.
Unregistered threads are observable, not restartable or stoppable by the
manager.

## Target modules

The current `forecastbox/utility/concurrent.py` should eventually become:

```text
forecastbox/utility/concurrency/
    __init__.py          # intentionally empty
    manager.py           # execution ownership and status
    ports.py             # free-port allocation
    shutdown.py          # child-process shutdown helpers
    synchronization.py   # timed lock acquisition helpers
forecastbox/utility/dispatcher.py
forecastbox/utility/db.py
```

Migration begins with a preparatory phase that creates the concurrency package,
moves every existing helper, updates all imports, and deletes
`utility/concurrent.py`. `manager.py` and `utility/dispatcher.py` are then added
with the new runtime in Phase 1. `delayed_thread` moves to
`synchronization.py` with a docstring marking it for removal once dependency
submission is available. The new `concurrency/__init__.py` must not re-export
symbols; callers import from the defining module.

Both new abstractions are general-purpose utility code. They must not import
schemata, routes, entrypoint code, or domain modules.

## Central configuration

Add a backwards-compatible `backend.concurrency` section with defaults. Pool
definitions are data, while the entrypoint remains responsible for deciding
which pools and long-lived threads to start.

```python
from enum import StrEnum


class ConcurrentPools(StrEnum):
    General = "general"
    Io = "io"
    RunSubmission = "run-submission"
    ArtifactIo = "artifact-io"
    PluginManagement = "plugin-management"
    JobsDb = "jobs-db"


class ConcurrentThreads(StrEnum):
    EventDispatcher = "event-dispatcher"
    Scheduler = "scheduler"
    DatabaseGarbageCollector = "database-garbage-collector"


class PoolSettings(FiabBaseModel):
    max_workers: int
    max_pending: int


class ConcurrencySettings(FiabBaseModel):
    pools: dict[ConcurrentPools, PoolSettings] = Field(
        default_factory=lambda: {
            ConcurrentPools.General: PoolSettings(max_workers=2, max_pending=32),
            ConcurrentPools.Io: PoolSettings(max_workers=4, max_pending=64),
            ConcurrentPools.RunSubmission: PoolSettings(max_workers=2, max_pending=32),
            ConcurrentPools.ArtifactIo: PoolSettings(max_workers=1, max_pending=64),
            ConcurrentPools.PluginManagement: PoolSettings(max_workers=1, max_pending=16),
            ConcurrentPools.JobsDb: PoolSettings(max_workers=1, max_pending=128),
        }
    )
    failure_history_size: int = 100
    shutdown_timeout_seconds: float = 10


class DispatcherSettings(FiabBaseModel):
    queue_capacity: int = 1024
```

Pool and thread identifiers are static enums in `utility/config.py`; dynamic
task names remain a separate type. Pool definitions are validated at startup.
`ConcurrentPools.JobsDb` must have exactly one worker. It is the async bridge
for an already serialized resource, so additional workers would only wait on
the same jobs-database lock and would not increase throughput. Keeping this
bridge separate prevents queued async database operations from consuming the
general pool. Dispatcher capacity is dispatcher configuration because the
execution manager treats it like any other long-lived component.

`max_pending` bounds submitted work that has not completed, including running
tasks. `ThreadPoolExecutor` has an unbounded internal queue, so the manager must
enforce this bound with its own semaphore and fail submission explicitly with a
typed `SubmissionRejected` exception. Async callers must never block the event
loop while waiting for capacity.

Do not subclass `ThreadPoolExecutor`. Introduce a private `ManagedPool` adapter
owned by the manager. It encapsulates the executor, capacity semaphore, worker
registration, counters, submission, and shutdown. The public manager methods
delegate to this adapter and never expose the executor. A future executor
implementation can therefore replace `ManagedPool` internals without changing
callers.

The listed defaults are the accepted initial configuration. All counts and
queue limits remain configurable in one concurrency object.

## Unified Execution Manager

### Ownership

There is one `ExecutionManager` instance per backend process. It is created at
module level in `utility/concurrency/manager.py`, configured and started by the
FastAPI lifespan, and shut down by that lifespan. Low-level modules may import
it without depending on the entrypoint.

Do not add a generic singleton utility. A module-level instance already has
process-local singleton semantics, is directly type-checkable, and avoids
concealing construction behind metaclasses or mutable class attributes. Other
state managers can adopt module-level instances independently when migrated;
that refactoring is not required by this design.

The manager owns:

- named `ThreadPoolExecutor` instances;
- named long-lived `threading.Thread` instances;
- stop events for long-lived threads;
- task counters and monitored task failures;
- thread failure and restart history;
- lifecycle and submission gates;
- staged startup and graceful shutdown of pools and threads;
- the unified concurrency status snapshot exposed by the backend status route.

It does not own the business state manipulated by tasks.

### Identifiers and contracts

Use semantic identifier types and immutable status DTOs:

```python
TaskName = NewType("TaskName", str)


@dataclass(frozen=True, eq=True, slots=True)
class RestartPolicy:
    max_restarts: int
    minimum_interval_seconds: float


NEVER_RESTART = RestartPolicy(max_restarts=0, minimum_interval_seconds=0)

SyncTask = Callable[[], T]
ThreadEntrypoint = Callable[[threading.Event], None]
ThreadStatusProvider = Callable[[], ComponentStatus]
ThreadStopRequest = Callable[[float], None]
```

Tasks are synchronous callables. Coroutine functions and returned coroutine
objects are rejected. Async callers await a `concurrent.futures.Future` with
`asyncio.wrap_future`; the manager never needs a reference to their event loop.

Every submission includes a stable task name for status and diagnostics.

### Lifecycle

The manager state machine is:

```text
new -> starting -> running -> stopping -> stopped
```

- Registration and pool/thread creation are permitted only in `new` or
  `starting`.
- External task submission is permitted only in `running`. During `starting`,
  a manager-owned thread may submit to a pool that has already reported ready;
  this is required for a newly started operational thread to verify database or
  event dependencies before its stage is declared ready.
- Startup processes registered resources in ascending stage order.
- Shutdown processes registered resources in descending stage order and closes
  general pool submission only after long-lived threads have stopped.
- A stopped manager is not restarted. A fresh process, or an explicit
  test-only reset, creates a fresh instance.
- Double registration, double start, and submission before a destination pool
  is ready are errors. During shutdown, external submission is rejected, while
  not-yet-stopped managed threads may continue submitting to live lower-stage
  pools so they can drain and terminate cleanly.

Registration records definitions but does not start resources. `start()`
processes stages in ascending order. Within a stage it creates and warms pools
before starting threads, then waits for every resource in that stage to report
ready before advancing. Failure or readiness timeout aborts startup and
gracefully stops everything already started.

Pool creation warms all configured workers with a startup barrier so status can
verify the intended worker count without reading private executor attributes.
Worker initializers register their thread identity with the manager.

The accepted initial stages are:

| Stage | Resources | Reason |
| ---: | --- | --- |
| 0 | All pools, including `ConcurrentPools.JobsDb`; event dispatcher | Infrastructure required by later threads |
| 1 | Operational producer threads | May use database, events, and shared pools |
| 2 | Periodic database garbage collector | Starts last and stops first |

The API accepts any non-negative stage so later use cases do not require a
manager redesign.

### Public API

Names are illustrative, but the implementation should preserve these
semantics:

```python
execution_manager.register_pool(
    pool_name: ConcurrentPools,
    *,
    max_workers: int,
    max_pending: int,
    stage: int = 0,
) -> None

execution_manager.register_thread(
    thread_name: ConcurrentThreads,
    entrypoint: ThreadEntrypoint,
    *,
    status_provider: ThreadStatusProvider,
    stop_request: ThreadStopRequest | None = None,
    stage: int,
    restart_policy: RestartPolicy = NEVER_RESTART,
) -> None

execution_manager.start() -> StartStatus

execution_manager.stop_thread(
    thread_name: ConcurrentThreads,
    *,
    timeout: float,
) -> ThreadStatus

execution_manager.restart_thread(
    thread_name: ConcurrentThreads,
) -> ThreadStatus

execution_manager.submit_unmonitored(
    pool_name: ConcurrentPools,
    task_name: TaskName,
    task: SyncTask[T],
) -> Future[T]

execution_manager.submit_monitored(
    pool_name: ConcurrentPools,
    task_name: TaskName,
    task: SyncTask[object],
) -> None

await execution_manager.awaitable_submit(
    pool_name: ConcurrentPools,
    task_name: TaskName,
    task: SyncTask[T],
) -> T

execution_manager.status() -> ExecutionStatus
execution_manager.shutdown(*, timeout: float) -> ShutdownStatus
```

Arguments should be bound with `functools.partial` at the call site so the
manager deals with a uniform zero-argument callable.

`submit_unmonitored` transfers failure ownership to the caller. The caller must
retrieve the future result.

`submit_monitored` transfers failure ownership to the manager. A completion
callback retrieves the exception immediately, releases queue capacity, and
adds a bounded failure record. Successful completed futures are discarded.
Monitored task failure does not kill or restart a pool and does not retry the
task.

`awaitable_submit` is only an async convenience over `submit_unmonitored` and
`asyncio.wrap_future`; it does not run work on the async loop's default
executor.

The manager should also have an internal receipt-bearing monitored submission
used by the event dispatcher. It has the same monitoring behavior but returns
the future so a dispatch completion can be aggregated. It should not be a
general public escape hatch.

### Dependency submissions

Waiting for one future inside a pool worker can deadlock a small or
single-worker pool. Startup and workflow dependencies therefore use a
non-blocking continuation:

```python
execution_manager.submit_after(
    dependency: Future[object],
    pool_name: ConcurrentPools,
    task_name: TaskName,
    task: SyncTask[object],
    *,
    run_if_dependency_failed: bool = False,
) -> None
```

The continuation is registered on the dependency future and only submits the
task after completion. It consumes and records dependency failure. It does not
occupy a worker while waiting.

The first manager contract waits on one future. A later workflow may need
`submit_after_all` for a group of prerequisites, but group aggregation is not
part of this rework and must not be added speculatively.

### Long-lived threads

A long-lived entrypoint receives a manager-owned `threading.Event` and must
return promptly after it is set. Its polling and condition waits must therefore
be bounded or wakeable.

Every registration includes a component status provider. It returns a compact,
immutable `ComponentStatus` with readiness/health plus component-owned details,
such as queue depth, last successful iteration, or next wake time. The provider
must be lock-free or use a short bounded lock; it must perform no database,
network, disk, or other potentially blocking I/O. The manager combines this
component snapshot with the physical thread lifecycle fields it owns.

An optional `stop_request(timeout)` lets a component close its own intake gate
and wake internal waits. It must respect the supplied budget. The event
dispatcher uses it to reject new events, wake its queue loop, and begin its own
bounded drain; to the manager this is the same staged stop operation as any
other registered thread.

The manager wraps each entrypoint so an uncaught exception is recorded with
thread name, timestamps, restart count, exception representation, and
traceback. Python `Thread` objects are never reused; restart creates a new
thread from the registered specification.

`stop_thread` sets only that thread's stop event, calls its optional stop
request, and joins it within the supplied deadline. It does not close pool
submission or stop other threads. This permits producer threads to stop while
the dispatcher and handler pools remain alive to drain already emitted events.
Stopping an already stopped thread is idempotent; stopping an unknown thread is
an error.

`restart_thread` is an explicit mutating operation. It may restart only a dead
thread whose policy permits it. It must not:

- retry failed tasks;
- recreate a stopped or broken pool in place;
- restart a thread during application shutdown;
- restart external processes;
- restart indefinitely.

A restart policy should include a maximum count and minimum interval. The
default is `NEVER`. Restart is requested only through an explicit internal or
administrative operation. The read-only status endpoint never restarts
resources as a side effect.

### Status

`ExecutionStatus` is one immutable snapshot containing:

- manager lifecycle state and overall health;
- each pool's configured workers and capacity;
- observed live worker count and thread names;
- submitted, pending, active, succeeded, failed, and cancelled task counts;
- each long-lived thread's alive flag, native thread id, start time, last stop
  time, stage, restart count, last failure, and component status;
- bounded recent monitored failures;
- currently visible Python threads not registered with the manager.

Counters are maintained by task wrappers; no private `ThreadPoolExecutor`
attributes are inspected. A pool is unhealthy when it is broken, shut down
unexpectedly, or has fewer live workers than configured after warm-up. A task
failure is visible but does not by itself declare the pool dead.

The existing `/api/v1/status` route exposes this snapshot under
`concurrency.pools` and `concurrency.threads`. Migrated thread-specific status,
including scheduler and dispatcher detail, moves under its registered thread
entry. Existing top-level status fields may move or be renamed during
migration; corresponding client work is intentionally outside this backend
change. Remote service probes remain separate from execution status and are
composed by the same route.

### Reentrancy and deadlock protection

The manager records the current pool in thread-local state. Submitting work to
the same pool and synchronously waiting for it is rejected, especially for
single-worker pools. Code already executing on a serialized worker should call
private implementation helpers directly when composing one transaction,
rather than enqueueing nested work.

The same rule applies to event receipts: a producer that waits for dispatch
completion must not occupy a worker in any pool containing one of the awaited
handlers.

## Global Event Dispatcher

### Event contract

Events are immutable process-local facts:

```python
EventName = NewType("EventName", str)


@dataclass(frozen=True, eq=True, slots=True)
class Event:
    name: EventName
    kwargs: Mapping[str, object]
```

Construction defensively copies `kwargs` into an immutable mapping. Payloads
should contain stable identifiers and plain data, not database sessions,
futures, event loops, locks, or mutable manager objects.

Event names use a namespaced past-tense convention such as
`producer.resource.changed`. A producer owns the name and payload contract.
Consumers validate payloads into their own typed dataclass or Pydantic model.

### Choosing continuations or events

Use `submit_after` when a concern is a linear workflow that follows the allowed
dependency hierarchy but successive steps need different pools, locks, or
resource limits. The producer knows the next operation and needs its completion
to advance.

Use events when a reaction crosses or reverses the dependency hierarchy, is
loosely coupled, has dynamic fan-out, or should allow consumers to be added
without changing the producer. Event producers publish facts; they do not
encode the consumer sequence. Do not use the event bus merely as an indirect
function call for an otherwise linear same-direction workflow.

### Registration contract

```python
EventHandler = Callable[[Event], None]


@dataclass(frozen=True, eq=True, slots=True)
class DispatcherRegistration:
    handler_id: str
    event_name: EventName
    pool_name: ConcurrentPools
    handler: EventHandler
```

Handler ids are globally unique and stable enough to appear in status output.
Registration is permitted only before dispatch starts. Duplicate ids and
unknown pool names fail startup.

Handlers are ordinary synchronous functions. They call synchronous locked
database helpers directly from their assigned worker rather than submitting
back through the async jobs DB bridge.

### Queue and submission

`EventDispatcher` owns one bounded, thread-safe `queue.Queue` of private
envelopes. An envelope contains the public `Event` and a completion future.

```python
submit_event(event: Event) -> Future[DispatchResult]
async_submit_event(event: Event) -> DispatchResult
register_dispatcher(registration: DispatcherRegistration) -> None
event_dispatcher_entrypoint(stop_event: threading.Event) -> None
status() -> DispatcherStatus
```

`submit_event` uses `put_nowait`. It is safe from async and sync code and never
blocks the request loop. A full or closed queue raises a typed exception; events
are never silently dropped.

`async_submit_event` calls `submit_event` and awaits its completion future with
`asyncio.wrap_future`. Callers that only need to enqueue from async code may
call the non-blocking sync method and ignore the returned receipt.

The dispatcher thread performs a bounded `queue.get` loop and is registered as
a restartable stage-0 long-lived thread in the execution manager. Its stop
request first closes event intake, then places a sentinel so the queue loop can
drain accepted events within its allocated shutdown budget before returning.

### Fan-out, ordering, and completion

- Queue dequeue order is FIFO.
- All handlers registered for an event are submitted in registration order.
- Handler execution is concurrent according to the selected pools.
- Completion order is not guaranteed.
- A dedicated one-worker pool is used when a consumer requires strict ordering.
- An event with no handlers succeeds immediately.
- One handler failure does not prevent other handlers from running.
- The dispatch completion future completes after all selected handlers finish.
  It raises an aggregate dispatch error when any handler failed.
- Every handler future is monitored by the execution manager even when the
  event producer ignores the dispatch receipt.

This completion contract allows a producer to wait for a causal reaction
without importing the consumer. Producers should normally emit and continue.
Synchronous waits must not form cycles or wait on a handler scheduled to the
same saturated pool.

When a producer must complete a reaction before applying its next in-memory
state transition, it awaits the dispatch receipt first. The handler should be
idempotent so a failed caller may safely retry and cause the reaction again.
This is at-least-once-safe application behavior, not an at-least-once delivery
guarantee from the in-memory dispatcher.

The internal receipt-bearing submission has one owner for capacity accounting:
its completion callback releases pool capacity exactly once, while both the
manager monitor and dispatch aggregator may safely inspect `future.exception()`.
The aggregate callback must not resubmit work while holding manager or
dispatcher registry locks.

Delivery is at most once and in memory. "Completed" means all handlers returned;
for the notification PoC it means only that the async-loop handoff was
scheduled, not that any client received data.

### Discovery

Discovery belongs in the entrypoint, not in `utility/dispatcher.py`.

At startup, the entrypoint iterates the immediate packages under
`forecastbox.domain`. For each package it attempts to import:

```text
forecastbox.domain.<package>.dispatchers
```

If present, that module must expose:

```python
dispatchers: tuple[DispatcherRegistration, ...]
```

Only the absence of that exact optional module is ignored. Import errors raised
inside an existing module fail startup and must not be mistaken for "no
dispatchers". Registration modules have no import-time side effects beyond
constructing immutable registration values.

After all modules are imported, the entrypoint registers every item, validates
handler and pool uniqueness, freezes registration, and starts the dispatcher
thread.

This arrangement preserves dependency direction:

- a producing domain imports only the utility event contract;
- a consuming domain imports the producer's public event name/payload contract
  if needed;
- the entrypoint discovers and connects consumers;
- the utility dispatcher imports neither side.

Top-level domains are the initial discovery scope. Nested discovery can be
added later only if a concrete use case requires it.

### Dispatcher status

`DispatcherStatus` includes:

- accepting/running/stopping state;
- queue capacity and current depth;
- submitted, dispatched, completed, and failed event counts;
- handler count by event name;
- in-flight handler count;
- recent queue and aggregate dispatch failures.

The dispatcher supplies this as its registered component status provider. The
execution manager composes it with physical thread state, so the backend status
route can render every long-lived component by iterating one
`ExecutionStatus.threads` mapping.

## Jobs database serialization

The jobs SQLite database uses a synchronous SQLAlchemy engine and session maker
for runtime operations. Every public database operation is synchronous and
acquires the regular jobs `threading.RLock` in `utility/db.py`. Async services
submit these operations to `ConcurrentPools.JobsDb` with `awaitable_submit`.
Synchronous pool workers and long-lived threads call them directly from their
current thread and do not retain an event-loop reference.

`ConcurrentPools.JobsDb`:

- has exactly one worker;
- is started after schema creation;
- provides bounded admission and execution isolation for async database work;
- does not exclusively own runtime connections or database access;
- relies on the same jobs `RLock` as every synchronous caller.

The regular lock is the serialization mechanism for all in-process jobs
database reads and writes. The one-worker executor prevents async submissions
from executing concurrently, while direct synchronous callers contend for the
same lock. `threading.RLock` does not guarantee fairness between those sources,
but neither source bypasses the database safety invariant. The expected
synchronous producers are bounded application-owned pools and long-lived
threads; if sustained contention develops, lock wait time and pool saturation
should be measured before adding a higher-level serialized resource queue.

The separate one-worker pool is retained because async code must leave the
event loop to execute synchronous SQLAlchemy work. Sending it to the general
pool would allow waiting database operations to consume general-purpose worker
capacity without increasing database concurrency. More than one jobs DB worker
would have the same problem within the dedicated pool because only one worker
can hold the database lock.

The pool is a stage-0 resource. It is warmed and reports ready before the
application accepts async database work.

Each callable represents one complete database operation and owns its
session/transaction. The same boundary applies whether async code submits it or
synchronous code invokes it directly. Read-modify-write sequences must be one
locked callable, not multiple separately locked calls. SQLite operational-error
retries happen inside that locked callable and retry the whole operation.

Sessions are created, used, committed or rolled back, and closed on the thread
executing the operation. Sessions and active SQLAlchemy result objects are
never passed between threads. Returned ORM or data values must be fully
materialized before the session closes and must not depend on lazy loading. The
synchronous engine's SQLite connection and SQLAlchemy pool configuration must
explicitly support a pooled connection being checked out by different threads
over its lifetime; the jobs lock prevents simultaneous use.

```python
result = await execution_manager.awaitable_submit(
    ConcurrentPools.JobsDb,
    TaskName("records.upsert"),
    partial(records_db.upsert, command),
)
```

```python
result = records_db.upsert(command)
```

Database helper modules expose synchronous functions and acquire the jobs lock
internally. They never submit themselves to a pool. Async orchestration submits
the complete helper call to `ConcurrentPools.JobsDb`; synchronous orchestration
calls the helper directly. Code already running on the jobs DB worker must call
nested private implementation helpers directly rather than submitting back to
the same pool.

Add this comment beside the serialized jobs-database access:

```python
# TODO investigate concurrent reads. SQLite should support concurrent readers,
# but the first implementation deliberately serializes all access so this
# rework does not also need to solve read/write classification and consistency.
```

### Users database

The users SQLite database is preserved and isolated rather than redesigned. In
the preparatory migration phase, copy the current async lock and `dbRetry`
behavior needed by administrative user helpers into `domain/auth/db.py`, give
them explicit users-database names, and update those helpers to use the local
implementation. The existing async SQLAlchemy/aiosqlite and FastAPI Users paths
otherwise continue to work as they do today.

The users database has no dependency on the execution manager, the synchronous
jobs engine, or the jobs lock. After preparation, `utility/db.py` is
jobs-database-only, so the coordinated jobs cutover cannot accidentally change
authentication persistence.

## Periodic database maintenance

The staged thread model also supports periodic maintenance that is neither an
event reaction nor a pool task initiated by a request. Register a database
garbage-collector entrypoint as `ConcurrentThreads.DatabaseGarbageCollector` at
stage 2, so it starts after operational producers and stops before them.

This effort implements only a lifecycle proof of concept, not garbage
collection policy. The entrypoint wakes every 10 minutes using a hardcoded
interval, directly calls one simple locked read-only query from one domain,
records the result, and sleeps again. The operation creates and closes its
session on the maintenance thread under the same jobs lock as every other
caller. There is no configuration field and no administrative prod.

Its component status includes the last attempt, last success, next scheduled
wake, current activity, query result summary, and last failure. Actual
tombstone/version eligibility, deletion transactions, batching, cascade order,
and dynamic discovery of domain cleanup callables are explicitly deferred to a
separate design.

## Async-loop notification handoff proof of concept

This effort proves event delivery back into the FastAPI loop without adding a
WebSocket route or network contract. A process-local
`ActiveWebsocketClientRegistry` stores the running async loop. A
`notification.emitted` handler runs in `ConcurrentPools.General` and asks the
registry to use `loop.call_soon_threadsafe` to create a small task on that loop.
The task only logs at debug level that the event would have been sent.

The placeholder has no clients, authentication, addressing, per-connection
queues, overflow behavior, replay, or acknowledgement. Its name reserves the
future integration point; actual WebSocket behavior requires a separate
design. Business/background producers know only the notification event.

## Startup sequence

The FastAPI lifespan performs these steps in order:

1. Validate configuration.
2. Create/check both database schemata.
3. Register all named pools with the execution manager.
4. Initialize `ActiveWebsocketClientRegistry` with the running loop.
5. Discover and register event handlers, then freeze dispatcher registration.
6. Register the event dispatcher at stage 0, operational long-lived threads at
   stage 1, and the database garbage collector at stage 2.
7. Call `ExecutionManager.start()`. It starts and verifies resources stage by
   stage, with pools before threads in stage 0.
8. Submit startup tasks and continuations to named pools.
9. Yield control to FastAPI.

No domain manager creates a thread or executor during import or lazily during a
request.

## Shutdown sequence

Shutdown is bounded and reports incomplete joins:

1. Close route-level/domain submission gates.
2. Stop long-lived threads in descending stage order: database garbage
   collection, operational producers, then stage-0 infrastructure.
3. For the event dispatcher, its registered stop request closes event intake
   and performs its own bounded best-effort drain before its entrypoint returns.
4. After the dispatcher returns, clear the loop reference held by
   `ActiveWebsocketClientRegistry`.
5. After all long-lived threads have been asked to stop, close general pool
   submission and shut down pools. Pending work is not silently discarded.
6. Shut down independently managed child processes and connections.
7. Return a final status containing resources that did not stop.

Events emitted after event intake closes fail explicitly. The first
implementation provides bounded best-effort drain, not an unlimited guarantee.
The manager and entrypoint use one shared deadline with fair-share budgeting,
not the full remaining deadline for the first operation. Divide the initial
budget by the remaining shutdown groups. Each group receives at most its base
share plus time left unused by earlier groups, preserving a minimum share for
later stages and pool/process cleanup.

The manager keeps pool submission available while stopping long-lived threads,
including during dispatcher drain. Route/domain gates and dispatcher intake are
separate from the manager's final pool-submission gate.

## Architectural invariants

- Only the entrypoint starts or stops the concurrency runtime.
- Only the execution manager creates application-owned threads and executors.
- Business domain code submits named callables; it does not store executor or
  event-loop references. Explicit async-loop adapters may retain the loop solely
  to bridge managed sync work back into FastAPI.
- Long-lived threads accept a stop event and are restartable only by explicit
  policy.
- Managed resources start in ascending stage order and stop in descending
  stage order.
- Every long-lived thread provides non-blocking component status.
- Event producers never import consumers.
- Event registration happens before dispatch starts.
- Every jobs-database operation is synchronous, operation-local, and protected
  by the jobs `RLock`; async callers reach it through the single jobs-database
  worker, while synchronous callers invoke it directly.
- Users-database synchronization is independent.
- No work is silently dropped because a queue is full or shutdown has started.
- Status is a snapshot; it does not execute business work.

## Deferred follow-up design

No open design questions remain for this concurrency rework. Separate future
specifications may address:

- actual tombstone/version garbage collection, including dynamic discovery,
  eligibility, retention, batching, and cascade order;
- a real WebSocket endpoint and its authentication, addressing, buffering,
  overflow, replay, acknowledgement, and shutdown contracts;
- continuation after a group of futures;
- manager-owned higher-level serialized resources that can queue constrained
  operations before assigning them to a shared pool.
