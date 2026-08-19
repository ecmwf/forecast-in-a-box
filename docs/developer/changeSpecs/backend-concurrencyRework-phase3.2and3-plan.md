# Backend concurrency rework: Phase 3.2 and 3.3 implementation plan

## Purpose and scope

Implement Phase 3.2 (plugin-store initialization) and Phase 3.3 (plugin
installation, import, reload, and related plugin-operation ownership) together.
The work moves both concerns from domain-owned ad hoc threads to already running,
bounded `ExecutionManager` pools. It also reduces the current plugin manager's
mixed responsibilities into a few small, domain-local modules.

This is deliberately not a general plugin-framework redesign. The domain has a
fixed, small set of operations, so the implementation should use direct
functions, the existing immutable state snapshots, and the existing execution
manager APIs rather than introduce new generic operation registries, task
objects, or domain-specific executors.

### Original design references

Look at these original files only if you encounter an unexpected situation. This
plan is self-contained and implementation should not normally require reading
them.

- [`backend-concurrencyRework-design.md`](backend-concurrencyRework-design.md)
- [`backend-concurrencyRework-migration.md`](backend-concurrencyRework-migration.md)
- [`backend-concurrencyRework-phase0-result.md`](backend-concurrencyRework-phase0-result.md)
- [`backend-concurrencyRework-phase1-result.md`](backend-concurrencyRework-phase1-result.md)
- [`backend-concurrencyRework-phase2-result.md`](backend-concurrencyRework-phase2-result.md)
- [`backend-concurrencyRework-phase2.1-result.md`](backend-concurrencyRework-phase2.1-result.md)

## Delivered baseline and boundaries

The implementation must rely on these existing facts rather than recreate them.

- Phase 0 moved concurrency helpers to `utility/concurrency/` and isolated the
  users database lock/retry path.
- Phase 1 created and starts the module-level `execution_manager`, including
  bounded `Io` and one-worker `PluginManagement` pools. It also provides
  `submit_monitored`, `submit_after`, `awaitable_submit`, task failure history,
  pool status, and lifecycle-owned pool shutdown.
- Phase 2 made jobs-database helpers synchronous and internally protected by
  the jobs `RLock`. Plugin-management workers must call those helpers directly,
  not submit them back through `JobsDb` and not retain an event-loop reference.
- Phase 2.1 maps unhandled `ExecutionManagerError` subclasses, including
  `SubmissionRejected`, to the common 503 route response.
- The notification dispatcher handler and its FastAPI-loop bridge are already
  operational. This work must keep the existing `PluginGlobalErrorEvent` path
  and must not redesign notification delivery or dispatcher registration.
- The artifact manager is still on its legacy private executor because Phase
  3.1 is intentionally out of scope. Its startup `Future` remains the initial
  plugin-load dependency.
- Phase 5 is also out of scope. The current temporary plugin-to-blueprint
  template-ingestion and unload coupling must remain behaviorally intact. It
  may be isolated into a small module, but must not be converted to events in
  this change.

No configuration changes are needed. `ConcurrentPools.Io` and
`ConcurrentPools.PluginManagement` already have the required configured limits
and are registered before domain startup work begins.

## Current state to replace

### Plugin stores

`domain/plugin/store.py` stores `StoresManager.stores_updater` and creates a
`threading.Thread` in `submit_initialize_stores`. `initialize_stores` performs
blocking file/HTTP store discovery and PyPI version lookups, then atomically
publishes a `pyrsistent` store map under `stores_lock`. `join_stores_thread` is
called from the application lifespan.

### Plugin operations

`domain/plugin/manager.py` currently combines all of the following in one
large module:

- mutable immutable-snapshot state (`plugins`, `errors`, and `updater_error`);
- ownership and joining of `PluginManager.updater`;
- startup dependency waiting through `delayed_thread`;
- pip/install/import/reload worker logic;
- plugin status and readiness queries;
- configuration editing and uninstall orchestration; and
- the temporary template-ingestion/unload implementation that reaches into the
  blueprint domain.

The updater thread is used for both initial loading and single-plugin updates.
It is not centrally supervised. The current exception notifier records a domain
error but swallows the exception, so the execution manager would not be able to
record the managed task failure if this behavior were copied unchanged.

`detail.build_plugin_listing()` also currently holds `PluginManager.lock` while
awaiting a jobs-DB-pool operation. This is not necessary for its immutable
in-memory snapshot and can cause an unnecessarily long lock hold.

## Target ownership and behavior

| Concern | Target owner | Submission and failure ownership |
| --- | --- | --- |
| Plugin-store initialization | `ConcurrentPools.Io` | Fire-and-forget monitored task; manager records unexpected task failures. |
| Initial plugin load after catalog refresh | `ConcurrentPools.PluginManagement` | `submit_after(catalog_future, ...)`; manager monitors the worker task and the domain maintains readiness/error state. |
| Install, import, and reload one plugin | `ConcurrentPools.PluginManagement` | Fire-and-forget monitored task; manager records uncaught task failures and the domain preserves its error notification/status surface. |
| Unload and uninstall mutation | `ConcurrentPools.PluginManagement` | Request-owned awaited task, because the caller needs completion before reporting success; domain records its failure state before re-raising. |
| Jobs database work from a plugin-management worker | Current worker thread plus jobs `RLock` | Call synchronous plugin/blueprint DB helpers directly. |

The one-worker `PluginManagement` pool is a correctness boundary, not merely an
I/O pool. Add a concise comment beside its use explaining that pip installation,
module reload/import, and plugin catalogue publication mutate process-global
state and therefore must not overlap. Do not hold `PluginManager.lock` across
pip, import/reload, blueprint processing, database work, or a wait for a
future. The existing short locks remain only for atomic state transitions and
immutable snapshot swaps.

The plugin store does not share this restriction. Its HTTP/file reads are safe
to use the shared `Io` pool. Artifact work remains on the legacy artifact
executor until Phase 3.1 migrates it; do not move it to `Io` in this work.

## Module layout and responsibility split

Refactor only the code currently in `domain/plugin/manager.py` and
`domain/plugin/store.py`; do not add a new cross-domain abstraction. The layout
below is the target for that extracted/reorganized code, not a complete listing
of the plugin package. Existing `compatibility.py`, `db.py`, `detail.py`,
`errors.py`, `events.py`, and `exceptions.py` remain separate concerns unless a
step below explicitly updates their imports or documentation.

```text
state.py             shared immutable plugin state and short synchronized state changes
manager.py           execution-manager submission boundary and public operation orchestration
loading.py           synchronous plugin load/update/reload/unload worker orchestration
template_ingest.py   temporary synchronous plugin-to-blueprint template work
store.py             store models, fetch/populate work, immutable store publication, Io submission
compatibility.py     version compatibility and isolated environment-install policy
```

Do not add compatibility re-exports. Every consumer must import from the module
that defines the symbol after the split. In particular, callers that currently
need `PluginManager` (`routes/plugins.py`, `routes/blueprint.py`,
`domain/blueprint/service.py`, `domain/run/compile.py`, and
`domain/plugin/detail.py`) import it from `forecastbox.domain.plugin.state`;
callers of submission, unload, readiness, status, and catalogue operations
import those functions from `forecastbox.domain.plugin.manager`. Update all production and test
imports atomically, then ensure `manager.py` does not re-export `PluginManager`
or worker implementation details merely to preserve an old path.

`template_ingest.py` should contain the existing `_ingest_plugin_templates`
logic and the temporary direct blueprint imports. Those imports remain lazy only
because they are required to avoid the existing circular domain dependency.
Its module docstring and the plugin domain docstring must explicitly say that
the dependency is temporary and will move to blueprint-owned dispatcher
handlers in Phase 5. Do not make the imports top-level and do not change the
current per-template error isolation, glyph remapping, validation, soft-delete,
or persistence behavior.

`loading.py` owns the synchronous worker workflow: loading one plugin, version
extraction, initial bulk loading, deciding whether installation is necessary,
calling the compatibility policy, import/reload, state publication, template
ingestion, and the synchronous unload primitive. It uses state helpers for
short publications and calls synchronous locked DB helpers directly. It must
not import routes, the entrypoint, or an event loop.

Keep `compatibility.py` intact as the independent policy/helper module. Its
public version helpers are used outside plugin loading by route code, and its
installation function encapsulates the detailed environment-freeze,
constraints, dry-run, real-install, and post-install policy without knowing
about `PluginManager`, pool submission, plugin state, or database publication.
`loading.py` invokes `check_environment_baseline()` and
`install_plugin_compatibly()` at the existing points in the worker workflow;
those calls must not move into `manager.py` or be duplicated. This gives a
clear separation: `compatibility.py` answers whether and how the active Python
environment may change, while `loading.py` decides when a particular configured
plugin is installed, imported, reloaded, and published.

`state.py` should retain the existing `PMap` publication pattern and the one
short state lock. Replace thread-object state with minimal semantic state:

- `operation_in_progress: bool`, true from accepted startup/update/unload/
  uninstall work until its wrapper completes;
- `updater_error: str | None`, preserving the existing global failure surface;
- the existing `plugins` and `errors` immutable maps.

Provide a small set of private, lock-protected state transitions/snapshot
helpers rather than allow each worker path to edit these fields ad hoc. They
should reserve an operation, publish initial/bulk/single/unloaded snapshots,
finish successfully, and finish with a recorded error. The helpers must not
perform I/O. There is no need for a new public status DTO: `status_brief()` can
read a compact state snapshot and continue returning `running`, `ok`, or
`failure: ...`, while pool-level task and failure details remain in the existing
execution-manager status response.

Preserve the present policy that a recorded global updater failure prevents a
later single update until the process is restarted. Do not add an implicit
retry, reset endpoint, or automatic task retry.

## Implementation steps

### 1. Move plugin-store initialization to `Io`

Modify `backend/src/forecastbox/domain/plugin/store.py` as follows.

1. Retain `StoresManager.stores` and its short lock, because the completed map
   must still be published as one immutable `pmap` swap and readers remain
   lock-free.
2. Remove `stores_updater`, the `threading` lifecycle dependency that exists
   only for that updater, and `join_stores_thread`.
3. Keep `initialize_stores(plugin_stores_config)` synchronous. It continues to
   own all blocking HTTP/file/PyPI work and publishes only after the complete
   map is available. A partial store map must never be published.
4. Change `submit_initialize_stores()` to submit a `functools.partial` of that
   synchronous function through:

   ```python
   execution_manager.submit_monitored(
       ConcurrentPools.Io,
       TaskName("plugin.stores.initialize"),
       partial(initialize_stores, config.external.plugin_stores),
   )
   ```

   Do not create a fallback thread, block for completion, or silently suppress
   `SubmissionRejected`. The common FastAPI handling applies if this is ever
   called from a request path. An unexpected task exception is recorded by the
   execution manager; existing callers continue to see an empty store map until
   a successful immutable publication.
5. Preserve `submit_install_plugin` behavior. It continues to read the
   immutable store map and then asks the plugin-operation facade to submit the
   requested install; it does not itself perform pip work.

### 2. Establish plugin operation state and synchronous worker wrappers

Create the state and worker split described above before changing submission
sites. Move code without changing its business ordering first, then replace the
thread ownership.

1. Move `PluginManager` and its immutable-map publication plus short state
   transitions into `state.py`. Keep `manager.py` limited to operation
   reservation, execution-manager submission, readiness/status/catalogue
   queries, and async request-facing orchestration. Remove the `updater` field
   entirely and migrate every production/test import to the defining module;
   do not leave a `PluginManager` re-export in `manager.py`.
2. Move the current template-ingestion body to `template_ingest.py`, preserving
   its synchronous direct DB calls and existing temporary lazy blueprint
   imports. Update the current template-ingest unit tests to import it from its
   defining module.
3. Move `load_single`, `_version_from_install`, `load_plugins`,
   `update_single`, and the synchronous unload body to `loading.py`. Keep
   `compatibility.py` as the environment/version policy dependency described
   above, rather than merging its tested resolver policy into the loader.
   Preserve:
   - current bulk load ordering and all per-plugin DB writes;
   - publish-before-template-ingestion behavior so validation can resolve the
     newly loaded plugin catalogue;
   - per-plugin install/load errors versus unexpected operation-wide failures;
   - current plugin-state/template-error persistence; and
   - direct synchronous calls to the jobs DB helpers.
4. Wrap each managed operation in one small synchronous wrapper that:
   - assumes the operation reservation has already been made;
   - runs the worker operation without holding the state lock;
   - marks the state idle on normal completion;
   - records `updater_error` and emits the existing `PluginGlobalErrorEvent` on
     an unexpected exception; and
   - re-raises that exception after recording the domain error.

   Re-raising is intentional. It lets the manager's monitored submission record
   the failure in its bounded common history, while the existing domain status
   and notification behavior remain available. Expected per-plugin outcomes
   that are currently represented as persisted/in-memory `PluginErrors` remain
   normal completion and must not be converted into global task failures.
5. Replace the current unsafe no-lock error fallback with the centralized short
   state transition. Long-running operations no longer hold the state lock, so
   a bounded failed acquisition should be exceptional and logged rather than
   writing a shared field without synchronization.
6. Change `detail.build_plugin_listing()` to capture copies of `plugins` and
   `errors` under the short lock, release it, then await
   `execution_manager.await_jobs_db(...)` for database state. Update its
   docstring to describe a best-effort composed snapshot rather than claiming
   the lock covers database work. This keeps the route's existing response
   shape and `PluginManagerBusy` handling while preventing a jobs-pool wait
   from blocking publication or status reads.

### 3. Replace startup loading and update threads with managed submissions

Implement the facade methods in `domain/plugin/manager.py` using the state and
worker wrappers.

1. Make the limited catalog-future contract correction before wiring the
   continuation: in the legacy
   `domain/artifact/manager.py::_refresh_catalog_task`, retain the existing
   `refresh_error` update and logging, then re-raise the original exception.
   This does not migrate the artifact executor, state, or shutdown ownership
   from Phase 3.1; it makes the already returned startup `Future` accurately
   represent a failed refresh so its existing consumer can honor the dependency
   contract. Add focused coverage for the failed future and retained
   `refresh_error` state.
2. `submit_load_plugins(catalog_future)` must atomically reserve the initial
   operation, set readiness to not-ready while the catalog is pending, and call:

   ```python
   execution_manager.submit_after(
       catalog_future,
       ConcurrentPools.PluginManagement,
       TaskName("plugin.initial-load"),
       partial(run_initial_load, config.external.plugins),
   )
   ```

   This replaces `delayed_thread`. It is a continuation, so no worker is
   occupied while waiting for catalog refresh. It is manager-monitored and does
   not return a domain-owned thread or executor.
3. Attach a small completion callback to `catalog_future` solely to update the
   domain operation state if the dependency itself fails. It must consume the
   dependency exception, record a clear startup dependency error, leave
   `plugins_ready()` false, and not invoke the load worker. The manager's
   `submit_after` implementation already records the dependency failure in its
   monitored failure history. The callback must only make a short state update;
   it must not acquire the jobs lock, publish plugins, or submit work while
   holding the state lock.
4. `submit_update_single(...)` must retain its current synchronous acceptance
   contract for routes: validate that the configured plugin exists, reject an
   existing global failure or in-progress operation, reserve the operation, and
   submit the worker wrapper with `submit_monitored` to
   `PluginManagement` using `TaskName("plugin.update")`. The route may still
   return its current immediate 202-style response after acceptance.
5. If normal monitored submission is rejected synchronously, roll back the
   in-progress reservation before re-raising `SubmissionRejected`. Do not mark
   it as a completed plugin update and do not leave the domain permanently
   `running`. The existing common 503 handler then reports temporary pool or
   lifecycle saturation.
6. Remove `join_updater_thread` and all thread liveness/join logic. Replace
   `status_brief()`'s `updater.is_alive()` check with the semantic operation
   state. It must correctly handle the pre-startup and waiting-for-catalog
   cases without dereferencing a missing thread.
7. Keep task names stable and specific: `plugin.initial-load` and
   `plugin.update`. These names, along with pool counters/failures, are the
   operational task detail; the top-level plugin status remains the existing
   compact domain-facing readiness/error summary until the later status
   consolidation phase.

### 4. Serialize unload and uninstall mutations too

Although the migration text emphasizes pip/install/import/reload, unloading
also mutates the same process-global plugin catalogue. Leaving it on the route
thread would permit an unload to race a managed update and would undermine the
one-worker correctness boundary. Include it in this combined implementation;
this is a small completion of the same ownership rule, not a new feature. A
recorded global updater failure must continue to block a new update, but it must
not prevent an administrator from unloading or uninstalling the failed plugin;
those cleanup operations are blocked only by an operation that is currently in
progress.

1. Keep the synchronous unload primitive in `loading.py`: remove the immutable
   plugin/error entries under the short state lock, then perform its existing
   blueprint-template soft delete outside that lock. Do not introduce the Phase
   5 event yet.
2. Add an async facade operation that reserves the plugin operation, awaits an
   unmonitored `awaitable_submit` to `PluginManagement` with
   `TaskName("plugin.unload")`, and lets the request own success/failure. The
   worker wrapper still updates the domain error/idle state before re-raising.
3. Make `uninstall_plugin` one synchronous worker operation submitted through
   the same pool and awaited by its async facade. Preserve the current sequence:
   delete the plugin state through the direct locked DB helper, remove/save the
   config entry under `config_edit_lock`, then unload the in-memory catalogue
   and soft-delete templates. Since the code is now on a synchronous
   plugin-management worker, direct DB access is correct and avoids a nested
   async/JobsDb bridge.
4. Update `routes/plugins.py` so the disable-settings path awaits the managed
   unload operation after its existing settings DB write. It should not enqueue
   the old redundant `update_single(..., install=False)` call when the plugin
   is disabled. The normal enabled-settings path continues to submit its
   asynchronous update. Update the uninstall route to use the new awaited
   facade.
5. Map an operation-busy rejection in these async routes to the same 503
   behavior as the existing `PluginManagerBusy` listing route. Reuse the
   existing exception if its documented meaning remains accurate; otherwise
   introduce one narrowly named plugin-operation-busy exception. Do not return
   a misleading 500 for an explicitly serialized operation that is already
   running.

### 5. Integrate startup and shutdown

Modify `backend/src/forecastbox/entrypoint/app.py` only for ownership changes.

1. Keep the current sequence in which the execution runtime starts before
   domain-specific initialization. This guarantees both destination pools exist
   before `submit_initialize_stores`, `submit_refresh_catalog`, and
   `submit_load_plugins` are called.
2. Keep the existing startup order and independence: initialize the already
   delivered notification broadcaster, submit store initialization, begin the
   legacy artifact catalog refresh, then install the initial plugin-load
   continuation from the catalog future. Store initialization is not made an
   artificial dependency of plugin loading because it is not one today.
3. Remove imports and shutdown calls for `join_stores_thread` and
   `join_updater_thread`. Do not replace them with component-specific joins.
   The existing `execution_manager.shutdown(...)` closes managed pools after
   the still-legacy component cleanup and waits/reports according to its common
   lifecycle policy.
4. Retain `join_artifact_manager` unchanged. It belongs to the intentionally
   deferred Phase 3.1 artifact migration.
5. Update module/docstring/comments that describe updater threads to describe
   managed plugin-operation tasks. In particular update `plugin/events.py` so
   its event documentation does not claim that a thread is the failure source.

### 6. Remove only obsolete execution code

At the end of the combined change, remove from production plugin code:

- `PluginManager.updater` and `StoresManager.stores_updater`;
- plugin/store uses of `threading.Thread` and `Thread.is_alive()`;
- `join_updater_thread` and `join_stores_thread`;
- the plugin use/import of `delayed_thread`; and
- the duplicated manual join-budget code.

Leave `utility/concurrency/synchronization.py::delayed_thread` in place for
this phase. Its removal is Phase 9 work even though this migration should leave
no remaining production caller.

Do not alter the legacy artifact executor, scheduler thread, run work, blocking
routes, dispatcher implementation, notification bridge, or status-route
network probes. They belong to other phases.

## Tests and validation

Add focused tests with deterministic fakes or fresh execution-manager instances;
do not run actual pip operations, network calls, or dependency waits in a unit
test.

1. Update the unit-test inline execution-manager fixture, or add narrower
   fixtures for these tests, so it supports the manager API actually used by
   the new code: `submit_monitored`, `awaitable_submit`, and `submit_after`.
   The `submit_after` fake must model both successful and failed dependency
   futures rather than silently running work after failure.
2. Store tests:
   - `submit_initialize_stores` submits exactly one monitored
     `plugin.stores.initialize` task to `ConcurrentPools.Io`;
   - the submitted callable publishes the complete immutable map only after
     successful fetch/population;
   - an exception is allowed to reach monitored task handling and no updater
     thread is created; and
   - `get_plugins_detail` remains lock-free over the published map.
3. Plugin operation tests:
   - startup creates a `submit_after` continuation to
     `PluginManagement`, does not use `delayed_thread`, and remains not-ready
     until the continuation succeeds;
   - a failed catalog dependency leaves readiness false and records the domain
     startup error without running the plugin loader;
   - a worker exception sets the existing domain error, emits the existing
     notification fact, re-raises for manager monitoring, and clears the
     in-progress state;
   - normal per-plugin install/load errors preserve their current
     `PluginErrors` behavior without becoming a global failure;
   - a second update/unload/uninstall cannot overlap a reserved operation,
     while unload/uninstall remain available to clean up after a prior update
     failure;
   - synchronous submission rejection rolls back the reservation; and
   - update, unload, and uninstall use the correct pool/task boundary and do
     not create or join a thread.
4. Preserve and adapt the current template-ingestion tests after the extraction.
   Confirm the extraction did not change excluded-template deletion, glyph
   remapping, validation error collection, or template-error persistence.
5. Add a focused `build_plugin_listing` test proving the plugin state lock is
   released before the awaited jobs-DB call. Preserve the existing 503 behavior
   when the short snapshot lock itself cannot be obtained.
6. Add/update lifespan integration coverage to prove the runtime accepts the
   store/plugin tasks and normal shutdown no longer calls the removed joins.
   The test should avoid a real plugin install by patching the worker functions,
   then assert that the common execution status exposes activity/failure under
   `Io` and `PluginManagement` as appropriate.
7. Run targeted plugin/store/template tests, affected route tests, type
   checking, and `uv run prek`. Before completion, search production sources
   for:

   ```text
   threading.Thread
   ThreadPoolExecutor
   delayed_thread
   join_updater_thread
   join_stores_thread
   PluginManager.updater
   StoresManager.stores_updater
   ```

   The only expected `ThreadPoolExecutor`/`threading.Thread` hits are inside
   the central concurrency runtime and intentionally deferred concerns. There
   must be no plugin store or plugin operation ownership hit.

## Completion criteria

- Plugin stores initialize through the monitored shared `Io` pool and have no
  private updater thread or join function.
- Initial plugin loading uses `submit_after` and the one-worker
  `PluginManagement` pool; single updates, unloads, and uninstalls cannot
  overlap plugin package/catalogue mutation.
- No plugin worker keeps or needs the FastAPI event loop. All jobs DB access in
  those workers is synchronous and protected by the existing jobs `RLock`.
- Plugin state locks are short, immutable maps remain safely published, and the
  plugin listing does not hold the state lock while waiting for database work.
- Unexpected managed plugin task failures appear in both the domain-facing
  error/notification surface and the execution-manager monitored failure
  history.
- The entrypoint no longer directly joins plugin/store threads, while the
  artifact legacy join remains untouched for Phase 3.1.
- Phase 5's event-based blueprint reaction and the already delivered
  notification handler remain behaviorally unchanged.
