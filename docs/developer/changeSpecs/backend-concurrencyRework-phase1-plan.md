# Backend concurrency rework: Phase 1 implementation plan

## Purpose and scope

Implement Phase 1 only: add a configured, centrally owned concurrency runtime
alongside the existing execution mechanisms, start its otherwise idle
infrastructure during the FastAPI lifespan, and expose its read-only operational
status.

This phase introduces:

1. Backwards-compatible concurrency and dispatcher configuration.
2. The execution manager, its named pools, lifecycle, submission contracts,
   long-lived-thread support, and immutable status snapshot.
3. The process-local event dispatcher, including registration, bounded queue,
   dispatch receipts, and shutdown behavior.
4. Entrypoint discovery/wiring for the dispatcher and the new runtime.
5. A `concurrency` object in the existing status response.

Do not migrate jobs database access, the scheduler, artifacts, plugins, run
work, routes, event-producing domain behavior, notifications, or periodic
maintenance. Existing domain-owned threads, executors, joins, loop references,
and status fields remain in place. The new pools will be mostly idle, and the
dispatcher will have no domain handlers in this phase.

The Phase 0 result is already present: utility concurrency helpers live in
`utility/concurrency/`, its `__init__.py` remains empty, and users-database
locking is independent from `utility/db.py`. Do not revisit that work.

For additional background only, look at these original files only if you
encounter an unexpected situation:

- [`backend-concurrencyRework-design.md`](backend-concurrencyRework-design.md)
- [`backend-concurrencyRework-migration.md`](backend-concurrencyRework-migration.md)
- [`backend-concurrencyRework-phase0-result.md`](backend-concurrencyRework-phase0-result.md)

This plan is self-contained; reading those documents is not required to
implement Phase 1.

## Current state

- `forecastbox.utility.config` has no concurrency or dispatcher settings.
  `FIABConfig` reads TOML and nested environment settings, so new settings must
  have defaults for existing installations and exported child-process
  configuration.
- `entrypoint/app.py` creates database schemata, then directly starts the old
  scheduler and startup work. On shutdown it directly stops/joins existing
  domain components. No central runtime exists.
- `utility/concurrency/` contains only the Phase 0 `ports`, `shutdown`, and
  `synchronization` helpers. There is no manager or dispatcher module.
- No immediate package under `forecastbox.domain` currently provides a
  `dispatchers.py` module. Discovery must therefore succeed with zero
  registrations.
- `routes/status.py` returns a six-field frozen dataclass and performs its
  current synchronous remote probes and direct scheduler/plugin status checks.
  The frontend's Zod schema currently strips unknown response keys, but
  frontend changes are explicitly outside this backend phase.

## Implementation steps

### 1. Add the static configuration contract

Modify `backend/src/forecastbox/utility/config.py`.

1. Define these `StrEnum` identifiers in this low-level configuration module:

   ```python
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
   ```

   Pool and thread names are static configuration/API identifiers, not
   free-form task labels.

2. Add `PoolSettings(max_workers: int, max_pending: int)`,
   `ConcurrencySettings`, and `DispatcherSettings` as `FiabBaseModel`
   configuration types. `ConcurrencySettings` must provide these exact
   defaults:

   | Pool | `max_workers` | `max_pending` |
   | --- | ---: | ---: |
   | `General` | 2 | 32 |
   | `Io` | 4 | 64 |
   | `RunSubmission` | 2 | 32 |
   | `ArtifactIo` | 1 | 64 |
   | `PluginManagement` | 1 | 16 |
   | `JobsDb` | 1 | 128 |

   It also defaults `failure_history_size` to `100` and
   `shutdown_timeout_seconds` to `10`. `DispatcherSettings` defaults
   `queue_capacity` to `1024`.

3. Add `concurrency` and `dispatcher` fields with default factories to
   `FIABConfig`. Keep the existing TOML and nested-environment behavior; no
   existing configuration file must acquire new keys.

4. Validate at model construction/startup:

   - all worker, pending-capacity, failure-history, shutdown-timeout, and
     dispatcher-capacity values are positive;
   - exactly the six required pool identifiers are configured (a partial
     `pools` mapping is an error rather than silently creating an incomplete
     runtime);
   - `JobsDb` has exactly one worker;
   - the initial serialized pools, `ArtifactIo` and `PluginManagement`, also
     remain single-worker pools. Their one-worker setting represents a current
     correctness constraint, not a tunable throughput choice.

   Use Pydantic validation for value constraints and an after-model validator
   for cross-entry checks. The execution manager must defensively reject an
   invalid registration as well, but configuration is the primary early error.

5. Do not add a configuration option for pools or threads that are not in the
   static enums, a database policy, startup tasks, a dispatcher handler, or
   an administrative restart endpoint.

### 2. Implement `utility/concurrency/manager.py`

Create `backend/src/forecastbox/utility/concurrency/manager.py`. It is general
utility code and must not import schemata, routes, entrypoint modules, or
domain modules.

#### 2.1 Public contracts and module instance

Define the semantic contracts needed by callers:

- `TaskName = NewType("TaskName", str)`;
- a lifecycle enum with `new`, `starting`, `running`, `stopping`, and
  `stopped`;
- frozen, slotted DTOs for component status, pool/thread status, monitored
  failure records, start/shutdown results, and the complete execution status;
- `RestartPolicy`, `NEVER_RESTART`, sync task/entrypoint/status-provider/stop
  callback aliases, and typed lifecycle/submission exceptions including
  `SubmissionRejected`;
- one module-level `execution_manager = ExecutionManager()`.

All status DTOs must contain only immutable, serializable snapshot data. The
manager must copy/freeze mappings and bounded histories before returning them;
callers cannot mutate manager state through a prior status result.

Use a module-level instance rather than a generic singleton mechanism. Permit
an explicit test-only reset/factory path so isolated unit tests do not attempt
to restart a production-stopped manager.

#### 2.2 Managed pools and task submission

Keep `ThreadPoolExecutor` private behind a `ManagedPool` adapter owned by the
manager. Do not subclass the executor and do not expose it to callers.

For each pool, the adapter must:

- retain its configured worker/capacity values and stage;
- create named executor workers and register each worker's native identity and
  name through the executor initializer;
- warm every configured worker during manager startup with a barrier, so
  status verifies the configured worker count without reading executor private
  attributes;
- use a semaphore for `max_pending`, where a permit covers every submitted
  task from acceptance until completion, including active tasks;
- release that permit exactly once for success, failure, cancellation, and
  executor submission failure;
- maintain submitted, pending, active, succeeded, failed, and cancelled
  counters in wrappers/callbacks;
- never make an async caller wait for capacity;
- shut down without silently cancelling pending accepted work.

Provide and enforce these methods:

```python
register_pool(pool_name, *, max_workers, max_pending, stage=0) -> None
register_thread(thread_name, entrypoint, *, status_provider, stop_request=None,
                stage, restart_policy=NEVER_RESTART) -> None
start() -> StartStatus
stop_thread(thread_name, *, timeout) -> ThreadStatus
restart_thread(thread_name) -> ThreadStatus
submit_unmonitored(pool_name, task_name, task) -> Future[T]
submit_monitored(pool_name, task_name, task) -> None
awaitable_submit(pool_name, task_name, task) -> T
submit_after(dependency, pool_name, task_name, task, *,
             run_if_dependency_failed=False) -> None
status() -> ExecutionStatus
shutdown(*, timeout) -> ShutdownStatus
```

Callers bind arguments with `functools.partial`; the manager receives only a
zero-argument synchronous callable. Reject coroutine functions and tasks that
return coroutine objects. `awaitable_submit` must wrap the returned
`concurrent.futures.Future` with `asyncio.wrap_future`, never use the async
loop's default executor.

`submit_unmonitored` gives the caller failure ownership. `submit_monitored`
must retrieve failures in a completion callback, record a bounded failure
entry, and discard successful completions. It must not retry or restart a pool
because a task failed. Add a private receipt-bearing monitored submission for
the dispatcher only; do not make it a general public escape hatch.

Use thread-local current-pool state in task wrappers. Reject a pool worker's
attempt to submit back to the same pool, preventing single-worker and
saturated-pool self-deadlocks. `submit_after` must register a non-blocking
continuation on one dependency future, consume/record dependency failure, and
submit only after completion; it must not occupy a worker while waiting.

#### 2.3 Long-lived threads and lifecycle

Registration records definitions only. It is allowed only while the manager is
`new` or `starting`; duplicate names are errors. External submissions are
allowed only while `running`. During staged startup/shutdown, already-running
managed threads may submit to ready lower-stage pools so they can establish
dependencies and drain cleanly.

Implement staged lifecycle behavior:

1. `start()` advances resources in ascending non-negative stage order.
2. In each stage, create/warm pools before creating threads.
3. Wrap each thread entrypoint to record start/stop metadata, uncaught
   exception representation and traceback, restart history, and physical
   liveness. The wrapper gives the entrypoint a manager-owned stop event.
4. Wait for each stage resource to report readiness through its non-blocking
   component status provider before advancing. On failed readiness or timeout,
   abort startup and gracefully stop every resource already started.
5. `stop_thread()` sets only that thread's stop event, invokes its optional
   bounded `stop_request`, and joins within the supplied budget. It is
   idempotent for an already stopped known thread and errors for an unknown
   name.
6. `restart_thread()` can create a fresh Python `Thread` only for a dead
   registered thread whose capped policy permits it. It must never retry a
   task, revive a pool, restart during manager shutdown, or restart
   indefinitely.
7. `shutdown()` transitions to `stopping`, stops long-lived threads in
   descending stage order, then closes pool submissions and shuts down pools.
   It must use the supplied single deadline with fair-share allocation across
   remaining shutdown groups and report incomplete joins in `ShutdownStatus`.
   A stopped manager cannot restart in production.

The manager's status must be lock-safe and non-blocking. It includes lifecycle
and overall health, every pool's configuration/observed workers/thread names
and counters, every registered thread's physical and component status,
bounded monitored failures, and a diagnostic list of currently visible Python
threads not registered with the manager. It must not inspect private executor
state or perform business I/O.

### 3. Implement `utility/dispatcher.py`

Create `backend/src/forecastbox/utility/dispatcher.py`. It may depend on the
manager and static configuration identifiers, but neither it nor the manager
may import a domain, route, schemata, or entrypoint module.

1. Define immutable event and registration contracts:

   ```python
   EventName = NewType("EventName", str)

   @dataclass(frozen=True, eq=True, slots=True)
   class Event:
       name: EventName
       kwargs: Mapping[str, object]

   @dataclass(frozen=True, eq=True, slots=True)
   class DispatcherRegistration:
       handler_id: str
       event_name: EventName
       pool_name: ConcurrentPools
       handler: Callable[[Event], None]
   ```

   `Event` must defensively copy and freeze `kwargs`. Document that payloads
   contain stable plain data, not sessions, futures, event loops, locks, or
   mutable manager objects. Handler IDs are globally unique and event names
   are producer-owned, namespaced past-tense facts.

2. Provide a process-local dispatcher instance with:

   ```python
   register_dispatcher(registration) -> None
   freeze_registration() -> None
   submit_event(event) -> Future[DispatchResult]
   async_submit_event(event) -> DispatchResult
   event_dispatcher_entrypoint(stop_event) -> None
   stop_request(timeout) -> None
   status() -> DispatcherStatus
   ```

   Registration is valid only before freeze/start. Reject duplicate handler
   IDs, registrations for unknown pools, malformed registration exports, and
   later registration attempts. The registration and handler lookup paths must
   be thread-safe without holding locks during handler execution.

3. Use one bounded `queue.Queue` sized from `DispatcherSettings`. Event
   submission uses `put_nowait`; it is safe from sync and async callers and
   rejects full, not-yet-running, or closed intake with typed errors. No event
   is silently dropped. `async_submit_event` awaits its receipt using
   `asyncio.wrap_future`.

4. Register the dispatcher entrypoint as the stage-0
   `ConcurrentThreads.EventDispatcher` thread. Its bounded queue loop dequeues
   FIFO. For each event, submit matching handlers in registration order via
   the manager's private receipt-bearing monitored submission. Handler
   execution remains concurrent according to each selected pool. An event
   with no handlers succeeds immediately. Complete the event receipt only
   when every handler finishes, and raise an aggregate dispatch error if any
   handler failed without preventing other handlers from running.

5. Its stop request closes intake, wakes the queue loop with a sentinel, and
   lets the loop perform a bounded best-effort drain of already accepted
   events. It must leave general pool submission available until the dispatcher
   returns. Dispatcher status must expose accepting/running/stopping state,
   queue capacity/depth, submitted/dispatched/completed/failed counts, handler
   counts by event, in-flight handlers, and bounded queue/aggregate failures.

### 4. Wire discovery and lifecycle in `entrypoint/app.py`

After both schema modules have completed creation, but before existing startup
work begins:

1. Build a small entrypoint-only discovery helper that iterates only immediate
   packages under `forecastbox.domain`.
2. For each package, attempt to import
   `forecastbox.domain.<package>.dispatchers`. Ignore only absence of that
   exact optional module. An import error raised inside an existing module must
   fail startup rather than being misclassified as absence.
3. Require a `dispatchers` tuple in every discovered module. Validate and
   register every `DispatcherRegistration`, then freeze registration. With the
   current repository this completes with zero registrations.
4. Register every configured `ConcurrentPools` entry at stage 0, register the
   dispatcher's entrypoint/status provider/stop request as the stage-0
   `EventDispatcher` thread, then call `execution_manager.start()`.
5. Only after the runtime has started successfully, continue the existing
   scheduler start, release/version setup, artifact/store/plugin startup, and
   `ArtifactsProvider` setup unchanged. Do not route any of that work through
   the new pools in this phase.

If runtime registration/discovery/startup fails, fail the lifespan before old
startup work is submitted and ensure partially started manager resources are
stopped. Do not leave a manager thread or executor behind.

During lifespan shutdown, preserve the current shutdown of old components and
perform it first. Then call `execution_manager.shutdown()` with
`config.concurrency.shutdown_timeout_seconds` so it stops the stage-0
dispatcher before closing its pools. Do not remove any existing direct join or
cleanup in this phase.

### 5. Extend the operational status response

Modify `backend/src/forecastbox/routes/status.py`.

1. Add a `concurrency` field to the route-owned `StatusResponse` contract.
   Its serialized value comes from `execution_manager.status()` and exposes,
   at minimum, `concurrency.pools` and `concurrency.threads`, including the
   dispatcher's component status under
   `concurrency.threads.event-dispatcher`.
2. Preserve every existing top-level status field and its current probing
   behavior. Phase 1 does not move scheduler or plugin detail under
   `concurrency`, make the route async, or move remote probes to the I/O pool.
3. Fetching status must only read snapshots. It must not start, stop, restart,
   drain, or otherwise mutate manager or dispatcher state.
4. Keep frontend types/mocks/components unchanged. Their update is explicitly
   outside this backend migration phase; the added backend field is additive.

## Validation

Add focused backend unit coverage for the new utility modules and configuration.

1. Configuration:
   - defaults yield all six named pools and the specified limits;
   - values must be positive;
   - missing required pool names and non-single-worker serialized pools fail
     validation;
   - a legacy configuration with no new sections still loads defaults.
2. Execution manager:
   - registration and lifecycle gates reject invalid state transitions and
     duplicate resources;
   - pool warm-up observes the configured worker count without private
     executor access;
   - task counters, bounded capacity, `SubmissionRejected`, unmonitored
     result ownership, monitored failure history, async wrapping, and
     coroutine rejection behave as specified;
   - same-pool nested submission is rejected;
   - stages start pools before threads and stop in reverse order;
   - startup rollback, bounded thread stop, restart-policy limits, and
     post-shutdown non-restart behavior leave no live test resources;
   - status is immutable/snapshot-based and reports controlled unregistered
     thread diagnostics.
3. Dispatcher:
   - registration freeze, duplicate/unknown-pool validation, and optional
     discovery behavior are covered;
   - missing optional modules are ignored, but errors inside an existing
     `dispatchers.py` fail discovery;
   - FIFO dequeue/registration submission ordering, no-handler completion,
     bounded queue rejection, handler aggregate failure, monitored accounting,
     and bounded shutdown drain are covered deterministically.
4. Lifespan/status integration:
   - start the existing integration fixture and assert `/api/v1/status`
     contains every configured pool and the live event-dispatcher thread;
   - assert existing top-level status fields remain available;
   - exercise normal application shutdown and confirm the dispatcher/pools
     stop without replacing existing old-component cleanup.
5. Run the targeted new tests, the affected backend unit/integration tests,
   backend type checking, and the repository's existing formatting/lint
   command. Finally search to confirm no existing domain work has been moved
   to `execution_manager` in this phase.

## Completion criteria

- Existing installations start with default `backend.concurrency` and
  dispatcher settings without configuration migration.
- The only application-owned resources added by this phase are the six named
  stage-0 pools and the event-dispatcher thread.
- No existing scheduler, artifact, plugin, run, database, or route operation
  uses a new pool or dispatcher event.
- The manager enforces bounded, explicit submission behavior and exposes an
  immutable status snapshot without private-executor inspection.
- The dispatcher starts with zero handlers, accepts only valid pre-start
  registrations, has bounded event intake, and drains accepted events
  best-effort during shutdown.
- `/api/v1/status` includes `concurrency.pools` and `concurrency.threads`
  without changing existing top-level fields or causing lifecycle side effects.
- Lifespan startup/shutdown leaves no manager-owned resource running after a
  normal stop or a startup failure.

## Open questions and implementation concerns

1. **Startup readiness deadline:** the target design requires a readiness
   timeout and rollback, but the specified configuration contains only
   `shutdown_timeout_seconds`. Before implementation, decide whether startup
   readiness uses that existing 10-second value, a documented fixed timeout,
   or a new configuration field. A silent unlimited wait is not acceptable.
*> response: introduce startup_timeout_seconds as well, with the same default of 10

2. **Serialized-pool configurability:** this plan treats `ArtifactIo` and
   `PluginManagement`, in addition to `JobsDb`, as fixed single-worker pools
   because Phase 1 defines them as serialized correctness boundaries. Confirm
   that users must not be permitted to raise those worker counts through
   configuration. If only `JobsDb` is meant to be invariant, relax the two
   validations before implementation while retaining their default of one.
*> response: there should be the same validation for ArtifactIo and PluginManagement as for JobsDb -- you can implement it using the runtime_validate construct

3. **Status API compatibility:** the existing route guidance normally avoids
   changing established response classes without simultaneous client work, but
   Phase 1 explicitly requires the additive `concurrency` object while
   frontend work is excluded. Current Zod parsing strips unknown fields, so no
   known client breaks; nevertheless, this intentional contract expansion
   should be accepted in review.
*> response: this is intentional. Make it explicit that adding new fields is ok, and that the developer should not consult any frontend or client implementation

4. **Module-level lifecycle in tests:** a production manager is intentionally
   non-restartable after shutdown, while unit tests need isolated fresh
   instances. The test-only reset/factory must be inaccessible to application
   code and must not weaken production lifecycle guarantees.
*> response: the unit tests should mock the global instance in each test that deals with the lifecycle. There must be no test-only methods exposed in the production code -- if something cannot be easily unit tested, because the mocking would be complicated or interfering (keep in mind we run unit tests in parallel!), then leave a `# TODO` comment in the test file about concrete missing coverage, rather than compromise the production code

5. **Existing status route behavior:** status remains synchronous and may block
   on its current Cascade/model-repository probes. This phase only adds a
   fast manager snapshot; converting those probes to the I/O pool is Phase
   3.6 and must not be pulled forward.
*> response: this is ok, the criterion is to not make the status "worse" eg by adding more heavyweight blocking. It is not the goal to fix it completely right away
