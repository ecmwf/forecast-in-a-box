# Backend concurrency rework: design

## Status

First design iteration. This document defines the target architecture and records
decisions that still need review. It deliberately uses generic examples; concrete
migration cases are in
[`backend-concurrencyRework-migration.md`](backend-concurrencyRework-migration.md).

## Goals

- Make every application-owned thread and thread pool centrally configured,
  named, supervised, and visible through one status snapshot.
- Share bounded pools by purpose instead of letting components create executors.
- Keep the async request loop responsive without treating higher throughput as
  the primary goal.
- Provide one process-local event bus for indirect, one-to-many reactions and
  notification delivery.
- Remove the need for background threads to retain the FastAPI event loop only
  to perform jobs-database operations.
- Serialize jobs-database access on a dedicated worker while preserving a
  separate async synchronization model for the users database.
- Support incremental adoption: the new runtime may coexist with old
  implementations, but one concrete concern must never be owned by both.

## Non-goals

- Managing child processes, remote workers, or work in another backend process.
- Increasing CPU parallelism. Python work remains subject to the GIL; a process
  pool is not part of this change.
- Durable messaging, replay, delivery across processes, or delivery after a
  backend restart.
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

During migration, `utility/concurrent.py` remains as a compatibility module that
re-exports or retains the old helpers. It is removed only after all old imports
have moved. The new `concurrency/__init__.py` must not re-export symbols; callers
import from the defining module.
*> review: this could be simplified. First step, say, "phase 0", of the work would create this new org structure in the utility module and re-route all existing imports. Then "phase 1" is introducing the new code, "phase 2" individual migrations

Both new abstractions are general-purpose utility code. They must not import
schemata, routes, entrypoint code, or domain modules.

## Central configuration

Add a backwards-compatible `backend.concurrency` section with defaults. Pool
definitions are data, while the entrypoint remains responsible for deciding
which pools and long-lived threads to start.

```python
class PoolSettings(FiabBaseModel):
    max_workers: int
    max_pending: int


class ConcurrencySettings(FiabBaseModel):
    pools: dict[str, PoolSettings] = Field(
        default_factory=lambda: {
            "general": PoolSettings(max_workers=2, max_pending=32),
            "network": PoolSettings(max_workers=4, max_pending=64),
            "jobs-db": PoolSettings(max_workers=1, max_pending=128),
        }
    )
    event_queue_capacity: int = 1024
    failure_history_size: int = 100
    shutdown_timeout_seconds: float = 10
```
*> review: I would separate ConcurrencySettings and event queue capacity -- because event queue capacity deals with one particular customer of the ConcurrencySettings, ie, from the PoV of that module, event queue dispatcher is just another long lived thread like scheduler is

Pool identifiers are validated at startup. `jobs-db` must have exactly one
worker. Code should define shared `PoolName` constants rather than repeating raw
strings.
*> review: Include the PoolName enum in the python snippet for the config

`max_pending` bounds submitted work that has not completed, including running
tasks. `ThreadPoolExecutor` has an unbounded internal queue, so the manager must
enforce this bound with its own semaphore and fail submission explicitly with a
typed `SubmissionRejected` exception. Async callers must never block the event
loop while waiting for capacity.
*> review: do we want to introduce our own ThreadPoolExecutor wrapper, to abstract this? In other unrelated projects, I've run into limitations of ThreadPoolExecutor, so I can imagine we will one day replace it with a custom one... Or would we handle this wrapping logic in the submit methods that are in front of the thread pool executor?

The exact defaults are an open decision; the important requirement is that all
counts and queue limits are visible in one configuration object.

## Unified Execution Manager

### Ownership

There is one `ExecutionManager` instance per backend process. It is created at
module level in `utility/concurrency/manager.py`, configured and started by the
FastAPI lifespan, and shut down by that lifespan. Low-level modules may import
it without depending on the entrypoint.

*> review: there already are Singletons of this kind across the codebase, most notably the plugin and artifact managers. Is it worth it to create some utility/singleton.py to standardize definition of those classes?

The manager owns:

- named `ThreadPoolExecutor` instances;
- named long-lived `threading.Thread` instances;
- stop events for long-lived threads;
- task counters and monitored task failures;
- thread failure and restart history;
- lifecycle and submission gates.
*> review: add "graceful shutdown logic of the pools and threads" to this? And "unified status endpoint"?

It does not own the business state manipulated by tasks.

### Identifiers and contracts

Use semantic identifier types and immutable status DTOs:

```python
PoolName = NewType("PoolName", str)
ThreadName = NewType("ThreadName", str)
TaskName = NewType("TaskName", str)

SyncTask = Callable[[], T]
ThreadEntrypoint = Callable[[threading.Event], None]
```
*> review: I think PoolName and ThreadName are probably enums, we are fine with these being static, defined in the configuration.py file. For TaskName, new type seems appropriate.

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
- Task submission is permitted only in `running`.
- Shutdown closes submission before stopping and joining owned resources.
- A stopped manager is not restarted. A fresh process, or an explicit
  test-only reset, creates a fresh instance.
- Double registration, double start, submission before start, and submission
  during shutdown are errors.

`start_pool()` creates the executor at application startup, rather than lazily
on first use. It warms all configured workers with a startup barrier so the
status can verify the intended worker count without reading private executor
attributes. Worker initializers register their thread identity with the
manager.

### Public API

Names are illustrative, but the implementation should preserve these
semantics:

```python
execution_manager.start_pool(
    pool_name: PoolName,
    *,
    max_workers: int,
    max_pending: int,
) -> None

execution_manager.start_thread(
    thread_name: ThreadName,
    entrypoint: ThreadEntrypoint,
    *,
    restart_policy: RestartPolicy = RestartPolicy.NEVER,
) -> None

execution_manager.stop_thread(
    thread_name: ThreadName,
    *,
    timeout: float,
) -> ThreadStatus

execution_manager.submit_unmonitored(
    pool_name: PoolName,
    task_name: TaskName,
    task: SyncTask[T],
) -> Future[T]

execution_manager.submit_monitored(
    pool_name: PoolName,
    task_name: TaskName,
    task: SyncTask[object],
) -> None

await execution_manager.submit_and_wait(
    pool_name: PoolName,
    task_name: TaskName,
    task: SyncTask[T],
) -> T

execution_manager.status(*, restart: bool = False) -> ExecutionStatus
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

`submit_and_wait` is only an async convenience over `submit_unmonitored` and
`asyncio.wrap_future`; it does not run work on the async loop's default
executor.
*> review: rename to awaitable_submit? That would be more clear I think?

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
    pool_name: PoolName,
    task_name: TaskName,
    task: SyncTask[object],
    *,
    run_if_dependency_failed: bool = False,
) -> None
```

The continuation is registered on the dependency future and only submits the
task after completion. It consumes and records dependency failure. It does not
occupy a worker while waiting.

### Long-lived threads

A long-lived entrypoint receives a manager-owned `threading.Event` and must
return promptly after it is set. Its polling and condition waits must therefore
be bounded or wakeable.

The manager wraps each entrypoint so an uncaught exception is recorded with
thread name, timestamps, restart count, exception representation, and
traceback. Python `Thread` objects are never reused; restart creates a new
thread from the registered specification.

`stop_thread` sets only that thread's stop event and joins it within the supplied
deadline. It does not close pool submission or stop other threads. This permits
producer threads to stop while the dispatcher and handler pools remain alive to
drain already emitted events. Stopping an already stopped thread is
idempotent; stopping an unknown thread is an error.

`status(restart=True)` may restart only a dead thread whose policy permits it.
It must not:

- retry failed tasks;
- recreate a stopped or broken pool in place;
- restart a thread during application shutdown;
- restart external processes;
- restart indefinitely.

A restart policy should include a maximum count and minimum interval. The
default is `NEVER`. Whether production status checks should request restart is
an open decision; a read-only HTTP GET should not acquire hidden side effects.

### Status

`ExecutionStatus` is one immutable snapshot containing:

- manager lifecycle state and overall health;
- each pool's configured workers and capacity;
- observed live worker count and thread names;
- submitted, pending, active, succeeded, failed, and cancelled task counts;
- each long-lived thread's alive flag, native thread id, start time, last stop
  time, restart count, and last failure;
- bounded recent monitored failures;
- currently visible Python threads not registered with the manager.

Counters are maintained by task wrappers; no private `ThreadPoolExecutor`
attributes are inspected. A pool is unhealthy when it is broken, shut down
unexpectedly, or has fewer live workers than configured after warm-up. A task
failure is visible but does not by itself declare the pool dead.

Status must not call arbitrary business health checks. Those remain separate
and can be composed by an HTTP status route.

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

### Registration contract

```python
EventHandler = Callable[[Event], None]


@dataclass(frozen=True, eq=True, slots=True)
class DispatcherRegistration:
    handler_id: str
    event_name: EventName
    pool_name: PoolName
    handler: EventHandler
```

Handler ids are globally unique and stable enough to appear in status output.
Registration is permitted only before dispatch starts. Duplicate ids and
unknown pool names fail startup.

Handlers are ordinary synchronous functions. Database work is submitted to the
database pool rather than performed directly on a different pool.

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
a restartable long-lived thread in the execution manager. Shutdown also places
a sentinel so it does not wait for the poll timeout.

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

The internal receipt-bearing submission has one owner for capacity accounting:
its completion callback releases pool capacity exactly once, while both the
manager monitor and dispatch aggregator may safely inspect `future.exception()`.
The aggregate callback must not resubmit work while holding manager or
dispatcher registry locks.

Delivery is at most once and in memory. "Completed" means all handlers returned;
for a notification handler it may only mean that data was queued for a socket,
not that a client received it.

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

The backend status surface should compose this with `ExecutionStatus`.

*> review: I'm wondering -- wouldn't it be easier to make the status reporting of the long lived threads unified? I mean, for the pools, the manager completely owns the status reporting of the pool (queue lengths, alive threads, etc). Why wouldnt we mandate, when a long running thread is submitted, that it should specify entrypoint and status retrieval callable as well? That would make the overall status message programmatically composable very easily, just iterating over all the registered objects?

## Jobs database serialization

The jobs SQLite database uses a synchronous SQLAlchemy engine and session maker
for runtime operations. Every public database operation is a synchronous
callable submitted to the `jobs-db` pool. Async services use
`submit_and_wait`; background workers use the returned concurrent future and do
not retain an event-loop reference.

The `jobs-db` pool:

- has exactly one worker;
- is started after schema creation;
- serializes reads and writes;
- owns connections used for runtime operations;
- uses a regular `threading.RLock` in `utility/db.py` as a defensive invariant
  for schema setup, retries, and any explicitly allowed direct maintenance
  operation.

*> review: there is a concern I did not realize -- say we initialize the managers, we can safely start the pools, as they have no requirements, they just sit there and wait. But as we go on starting the long lived threads, those may start doing things and have expectations, in particular, the scheduler thread expects the db to be already readable, ie, the corresponding thread must be alive and serving already. So maybe we need to have a tiered start logic? Like 'manager.add_long_lived_thread(jobs_db, stage=0); managed.add_long_lived_thread(scheduler, stage=1); ... and the manager would make sure that all threads from stage I are up and alive before starting any thread in stage I+1?

The executor queue provides serialization in normal operation; the regular lock
prevents accidental concurrent direct access during transitional or maintenance
code. The lock is not used as a reason to run database work on arbitrary
threads.
*> review: you may want to add that this is due to SQLite internal limitation of no concurrent writes

Each submitted callable represents one complete database operation and owns its
session/transaction. Read-modify-write sequences must be one callable, not
multiple separately queued calls. SQLite operational-error retries happen
inside the database worker and retry the whole operation.

```python
result = await execution_manager.submit_and_wait(
    JOBS_DB_POOL,
    TaskName("records.upsert"),
    partial(records_db.upsert, command),
)
```
*> review: JOBS_DB_POOL => ConcurrentPools.JobsDb

```python
result = execution_manager.submit_unmonitored(
    JOBS_DB_POOL,
    TaskName("records.upsert"),
    partial(records_db.upsert, command),
).result()
```

Database helper modules expose synchronous functions. They do not submit
themselves back to the same pool; orchestration happens at their service or
handler boundary.

Add this comment beside the serialized jobs-database access:

```python
# TODO investigate concurrent reads
```
*> review: add explanation -- smth like 'sqlite should in theory support concurrent reads, but we do not want to concern ourselves with that now. But this comment is to not forget to do the investigation in the future'.

### Users database

The users SQLite database remains on its async SQLAlchemy/aiosqlite path. It has
its own `asyncio.Lock`, separate retry helper, and no dependency on the
execution manager or jobs-database lock. Authentication and administrative user
operations must share that users-database lock.

The lock must be acquired at individual persistence-operation boundaries. It
must not be held for the lifetime of an injected request-scoped session because
an authenticated administrative request may perform another users-database
operation before dependency teardown. The FastAPI Users database adapter should
therefore be wrapped or subclassed with lock-aware methods. On an
`OperationalError`, a retryable method rolls back/discards its failed session
state before retrying; operations that cannot be safely replayed surface the
error rather than pretending to succeed.

The two database locks, engines, session makers, and retry helpers must have
explicit `jobs_` and `users_` names. There is no generic global lock spanning
both files.

*> review: keep in mind that the Users database thing should be "works kinda like today". The description you give here evokes me 'more work, more refactoring'. Try to emphasize the 'preserve and isolate' meaning more. Ideally, the things we need from utility/db.py for the users db to work, in particular the lock and the dbRetry, can be basically copied/replicated to the domain/auth/db.py. This could actually happen during the "phase 0", similarly to how I suggest to handle the utility/concurrent.py initial migration

## Startup sequence

The FastAPI lifespan performs these steps in order:

1. Validate configuration.
2. Create/check both database schemata.
3. Configure and start all named pools.
4. Discover and register event handlers.
5. Freeze event registration.
6. Start the event-dispatcher thread through the execution manager.
7. Start other enabled long-lived threads through the execution manager.
*> review: keep in mind my comment about stages and long lived threads. I'd say event dispatcher and jobs db are stage 0, and other threads are stage 1. Probably no need for stage 2 now, but we can make the manager be capable of handling that.
8. Submit startup tasks and continuations to named pools.
9. Yield control to FastAPI.

No domain manager creates a thread or executor during import or lazily during a
request.

## Shutdown sequence

Shutdown is bounded and reports incomplete joins:

1. Close route-level/domain submission gates.
2. Call `stop_thread` for producer long-lived threads and wake any domain-owned
   waits.
*> review: actually, the stages can be re-used in shutdown as well, in the reverse order. It won't be perfect, but still more graceful than a random order. Ie, first shut down stage N long lived threads, then N-1, then stage 0 (the db and events dispatcher), then the generic pools
3. Stop accepting new external events.
4. Allow already queued events and handler futures to drain within the shared
   shutdown deadline.
*> review: this should be concern of the events dispatcher itself, not of the manager. Basically, the stop call to the events dispatcher thread would make it close the gate first, then drain for allowed time, then terminate. But to the manager, it looks like "I've just issued a stop call to all stage-0 long lived threads"
5. Call `stop_thread` for the event-dispatcher thread.
6. Call `ExecutionManager.shutdown` with the remaining deadline. Only now does
   the manager enter `stopping`, close all pool submission, and shut down pools;
   pending work is not silently discarded.
7. Shut down independently managed child processes and connections.
8. Return a final status containing resources that did not stop.

Events emitted after event intake closes fail explicitly. The first
implementation provides bounded best-effort drain, not an unlimited guarantee.
The manager must use one shared deadline rather than applying the full timeout
independently to every resource.
*> review: agreed with the shared deadline, though we should not give the full deadline to the first shutdown call, otherwise it may consume all, leaving others with 0. Say deadline is 'shutdown in 10 seconds' and there are 5 steps, so each step would get max of 2 seconds + extra left by previous steps

The manager remains in `running` state through steps 1-5 so the dispatcher can
submit handlers during drain. Route/domain gates and dispatcher intake are
separate from the manager's final pool-submission gate.

## Architectural invariants

- Only the entrypoint starts or stops the concurrency runtime.
- Only the execution manager creates application-owned threads and executors.
- Domain code submits named callables; it does not store executor or event-loop
  references.
- Long-lived threads accept a stop event and are restartable only by explicit
  policy.
- Event producers never import consumers.
- Event registration happens before dispatch starts.
- Jobs-database access occurs only on the single jobs-database worker, apart
  from explicitly locked startup/maintenance operations.
- Users-database synchronization is independent.
- No work is silently dropped because a queue is full or shutdown has started.
- Status is a snapshot; it does not execute business work.

## Questions for review

1. Are `general=2`, `network=4`, and `jobs-db=1` acceptable initial pools, or
   should any serialized activity receive another dedicated one-worker pool?
*> answer: acceptable. Maybe rename network to io -- mostly they are network2disk, sometimes memory2disk, sometimes network2memory, ...
2. Should `status(restart=True)` remain an explicit internal/admin operation, or
   should a periodic supervisor request restarts automatically?
*> answer: lets keep it simple for now, must be explicit
3. Is the event completion future required in the first implementation? It is
   recommended because it preserves causal readiness without direct imports.
*> answer: yes
4. Is bounded best-effort event drain during shutdown sufficient, or must
   shutdown wait indefinitely for queued events?
*> answer: sufficient, staying up forever is worse than leaving db uncomplete (though ideally not corrupted... but sqlite should be robust enough)
5. Should queue saturation reject immediately as proposed, or may background
   producers block for a configured timeout? Async producers must always remain
   non-blocking.
*> answer: if the queue is full, it suggests something likely has gone wrong, and immediate rejection is a better idea
6. Is one backend process/Uvicorn worker a supported invariant? The proposed
   bus, manager state, and WebSocket fan-out are process-local.
*> answer: process locality is supported, we don't expect to have multi worker setting any time soon
7. Should execution details be added to the existing status response or exposed
   through a separate administrative endpoint?
*> answer: utilize the existing status endpoint. As we will be migrating, this will cause API change for the client who consume the current status endpoint, for example, the scheduler status will be nested differently -- today its I think top level field, but as we'll migrate it, it would move to eg concurrency.threads.scheduler -- that is ok   
8. Is converting the jobs database to synchronous SQLAlchemy in one coordinated
   cutover acceptable? The alternative is a dedicated thread owning a second
   asyncio loop, which retains more complexity and library-created threads.
*> answer: yes, one coordinated cutover is valid. We would not want a mixed up world. One PR that migrates all db accesses at once is fine (note also how I suggested first migrating the users db interactions to their own utility in "stage 0" -- this could happen first, and would shrink the scope of this all-DB-migration PR)

*> review: there is one novel concern I forgot -- our database is in some sense 'immutable' today, that is, for some entities, when the user calls Update route, it actually triggers an insert of a new row with version+1. This will leave number of dead rows in the db. We will need another long lived thread, periodically to be woken up and delete tombstoned things in a cascade fashion. It does not change anything we discussed so far, but adds another interesting use case / example which is neither event, nor general purpose pool, nor existing long lived thread. But justifies the "staged long lived thread start/stop", ie, this one should probably start last and stop first.
