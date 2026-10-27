# Backend concurrency rework: Phase 5 implementation plan

## Purpose and scope

Remove the plugin -> blueprint dependency breach. Today the plugin domain
imports blueprint code (lazily, inside functions) to ingest plugin-provided
blueprint templates after a plugin is loaded/updated, and to soft-delete them
after a plugin is unloaded. After this phase:

- the plugin domain emits two producer-owned events,
  `PluginTemplatesChangedEvent` and `PluginTemplatesRemovedEvent`, and waits
  for their dispatch receipts where ordering matters;
- the blueprint domain owns the template ingestion/removal code and registers
  handlers for these events in `domain/blueprint/dispatchers.py`;
- no module under `domain/plugin/` imports from `domain/blueprint/`;
- the event dispatcher aggregates handler completion without blocking its own
  thread, so a long template ingestion no longer stalls all other events.

Out of scope: the database maintenance thread (Phase 6), entrypoint/status
consolidation (Phase 8), changes to the notification events the plugin domain
already emits.

### Original design references

Look at these original files only if you encounter an unexpected situation.
This plan is self-contained and implementation should not normally require
reading them.

- [`backend-concurrencyRework-design.md`](backend-concurrencyRework-design.md) (section "Global Event Dispatcher")
- [`backend-concurrencyRework-migration.md`](backend-concurrencyRework-migration.md) (section "Phase 5: remove the circular domain dependency with events")

## Delivered baseline you can rely on

All paths below are relative to `backend/src/forecastbox/`.

### Event dispatcher (`utility/dispatcher.py`)

- `Event(name: EventName, payload: object)` - frozen; `name` is a label for
  logs/status only. **Routing is by type**: a `DispatcherRegistration(handler_id, handler_type, pool_name, handler)`
  receives every event whose `isinstance(event.payload, handler_type)` holds.
  `handler_type` may be a concrete class or a `runtime_checkable` Protocol.
- `submit_event(event) -> Future[DispatchResult]` is non-blocking; it raises
  `DispatcherNotRunning`, `DispatcherClosed`, or `DispatcherQueueFull`. The
  receipt resolves with a `DispatchResult` once all matched handlers
  completed, or with `AggregateDispatchError` if any failed. An event with no
  matching handler succeeds immediately.
- Handlers run on the registration's pool via the manager's internal
  `_submit_monitored_receipt`, so failures also appear in
  `ExecutionStatus.monitored_failures`.
- Discovery: `entrypoint/initializers.py::_discover_dispatchers` imports
  `forecastbox.domain.<pkg>.dispatchers` for every domain package and
  registers its `dispatchers: tuple[DispatcherRegistration, ...]`, then
  freezes registration. Only a missing `dispatchers` module is ignored.
- Existing consumer: `domain/notification/dispatchers.py` registers one handler
  on `ConcurrentPools.General` for the `ClientNotificationSource` protocol
  (payloads with an `as_client_notification()` method) and pushes them to
  websocket clients. Its handler blocks up to 5 s on the event loop.

### Plugin domain (split since the original design was written)

- `domain/plugin/state.py` - `PluginManager` namespace with immutable
  `plugins`/`errors` maps, `operation_in_progress`, `updater_error`; short
  publish/reserve helpers.
- `domain/plugin/loading.py` - synchronous workers run on the one-worker
  `ConcurrentPools.PluginManagement` pool: `load_plugins()` (initial bulk
  load), `update_single(...)`, `unload_single(plugin_id)`,
  `uninstall_plugin_sync(plugin_id)`.
- `domain/plugin/submit.py` - reservation + submission to `PluginManagement`;
  `_run_managed` records any exception in `updater_error`, emits
  `PluginGlobalErrorEvent`, and re-raises.
- `domain/plugin/template_ingest.py` - **the hierarchy breach**:
  `ingest_plugin_templates(plugin_id, plugin)` and
  `unload_plugin_templates(plugin_id)` with in-function imports of
  `domain.blueprint.db` / `domain.blueprint.service`.
- `domain/plugin/events.py` - notification events (`PluginInstalledEvent`
  etc.), all implementing `as_client_notification`.
- `domain/plugin/status.py::plugins_ready()` is `status_brief() == "ok"`, which
  is false while `operation_in_progress` is set and while `updater_error` is
  set.
- Startup: `entrypoint/initializers.py` submits the initial load with
  `submit_after(catalog_future, PluginManagement, ...)`; its future feeds the
  `PluginsCatalogInitialized` barrier (gates the scheduler).

### Current ingestion behaviour to preserve

`ingest_plugin_templates(plugin_id, plugin)`:

1. reads the plugin's DB state (`get_plugin_state`); raises `RuntimeError` if
   missing; returns early if `asset_ingest_needed` is false;
2. `clear_asset_ingest_needed` **before** ingesting;
3. for each `plugin.blueprint_templates`: excluded names are soft-deleted;
   others are converted (`template_to_builder`), glyph-remapped
   (`remap_builder_glyphs`) if a remapping is stored, validated
   (`resolve_builder_with_examples` + `validate_expand_sync` + `tag_name_errors`)
   and upserted (`upsert_blueprint`) if valid; per-template failures are
   collected, not raised;
4. persists the collected per-template errors (`update_template_errors`).

`unload_plugin_templates(plugin_id)` soft-deletes all `plugin_template`
blueprints with `created_by == plugin_id_str` (idempotent).

Call sites in `loading.py`:

- `load_plugins`: after `publish_bulk_snapshot`, ingests each loaded plugin in
  sequence; an exception aborts the loop and fails the whole operation.
- `update_single`: after publishing and the DB upsert, ingests if the plugin
  loaded.
- `unload_single`: `publish_unloaded` first, then `unload_plugin_templates`.
- `uninstall_plugin_sync`: `delete_plugin_state`, then `unload_single`.

## Implementation steps

### 1. Make dispatch aggregation non-blocking (`utility/dispatcher.py`)

Today `EventDispatcher._dispatch` submits all handlers and then calls
`future.result()` on each, so the single dispatcher thread waits for every
handler of an event before dequeuing the next one. With template ingestion
(seconds per plugin, sequential at startup) every other event, including
notifications, would queue behind it, and any handler that emitted an event
and waited for its receipt would deadlock. Change it to callback-based
aggregation:

1. In `_dispatch`, after collecting `registrations`:
   - if there are none, complete the receipt immediately (as today);
   - create a small private `_Aggregation` object (dataclass, not frozen) with
     `remaining: int = len(registrations)`, `failed: list[str]`, and a
     `threading.Lock`;
   - for each registration, submit via `self.manager._submit_monitored_receipt(...)`
     and attach `future.add_done_callback(partial(self._handler_done, queued, registrations, aggregation, registration.handler_id))`;
     if submission raises, record the failure and call the same completion
     path directly (it must count down too);
   - return without waiting.
2. `_handler_done(...)`: record a failure if the future was cancelled or has an
   exception (append to `_aggregate_failures` under `self._lock`); decrement
   `remaining` under the aggregation lock; the call that brings it to zero
   builds the `DispatchResult`, updates `_in_flight_handlers`/`_completed`/`_failed`
   under `self._lock`, **releases all locks**, and only then resolves the
   receipt (`set_result` or `set_exception(AggregateDispatchError(...))`).
   Receipt callbacks can run arbitrary code, so never resolve a receipt while
   holding a dispatcher lock.
3. On entrypoint exit, fail every envelope still in the queue: after the main
   loop ends, drain with `get_nowait()` and for each `_QueuedEvent` call
   `receipt.set_exception(DispatcherClosed("event dispatcher stopped before dispatch"))`
   and append to `_queue_failures`. Without this, a producer waiting on a
   receipt (step 4 below) could wait for an envelope that will never be
   dispatched.
4. Update the class docstring: dequeue order is FIFO; handlers of one event
   are submitted in registration order; handler execution and completion
   order across events is not guaranteed; receipts resolve from the pool
   thread that finishes the last handler.

Consequence worth knowing: notifications from consecutive events may now reach
clients in a different order (they run concurrently on `General`). Nothing
relies on that ordering today.

### 2. Producer-owned event contracts (`domain/plugin/events.py`)

Add two frozen dataclasses. They deliberately do **not** implement
`as_client_notification`, so the notification handler does not match them.

```python
@dataclass(frozen=True, eq=True, slots=True)
class PluginTemplatesChangedEvent:
    """Emitted by the plugin-management worker after a plugin has been published to
    PluginManager.plugins, asking consumers to (re)ingest its blueprint templates.
    Consumers read the plugin from the catalogue and its template settings from the
    plugin_state table."""

    plugin_id: PluginCompositeId


@dataclass(frozen=True, eq=True, slots=True)
class PluginTemplatesRemovedEvent:
    """Emitted by the plugin-management worker before a plugin is removed from
    PluginManager.plugins, asking consumers to remove its blueprint templates.
    Handling must be idempotent."""

    plugin_id: PluginCompositeId
```

`PluginCompositeId` is a frozen pydantic model, safe as a payload field. Event
name labels: `EventName("plugin.templates.changed")` and
`EventName("plugin.templates.removed")`; define them as module constants next
to the classes.

Update the module docstring: it now holds both client-notification events and
the template events consumed by the blueprint domain.

### 3. Move the reaction logic to the consumer

1. Move `domain/plugin/template_ingest.py` to
   `domain/blueprint/template_ingest.py` (use `git mv` to keep history) and
   rewrite it:
   - all imports at module top level (no more in-function imports);
   - `ingest_plugin_templates(plugin_id: PluginCompositeId) -> None`: look up
     `plugin = PluginManager.plugins.get(plugin_id)`; if `None`, raise
     `PluginTemplatesUnavailable` (new, `domain/blueprint/exceptions.py`) - the
     producer always publishes before emitting, so this is a programming error;
     then the current body unchanged (DB state read, `asset_ingest_needed`
     check, clear, per-template loop, `update_template_errors`). Calls to
     blueprint DB/service functions become ordinary module-level references.
   - `remove_plugin_templates(plugin_id: PluginCompositeId) -> None`: the
     current `unload_plugin_templates` body.
   - Module docstring: "Blueprint-side reaction to plugin template events.
     Runs on a `ConcurrentPools.General` worker via `dispatchers.py`, calls
     jobs-DB helpers directly. Reads the plugin catalogue and plugin_state
     (blueprint depends on plugin) and persists per-template errors and the
     `asset_ingest_needed` flag back into plugin_state through the plugin
     domain's DB helpers."
2. Create `domain/blueprint/dispatchers.py`, following
   `domain/notification/dispatchers.py`:

   ```python
   def _handle_templates_changed(event: Event) -> None:
       if not isinstance(event.payload, PluginTemplatesChangedEvent):
           raise TypeError(event.payload.__class__.__name__)
       ingest_plugin_templates(event.payload.plugin_id)


   def _handle_templates_removed(event: Event) -> None:
       ...
       remove_plugin_templates(event.payload.plugin_id)


   dispatchers = (
       DispatcherRegistration(
           handler_id="blueprint.plugin_templates_changed",
           handler_type=PluginTemplatesChangedEvent,
           pool_name=ConcurrentPools.General,
           handler=_handle_templates_changed,
       ),
       DispatcherRegistration(
           handler_id="blueprint.plugin_templates_removed",
           handler_type=PluginTemplatesRemovedEvent,
           pool_name=ConcurrentPools.General,
           handler=_handle_templates_removed,
       ),
   )
   ```

   Pool choice: **must not** be `PluginManagement` (the producer occupies its
   only worker while waiting for the receipt, so this would deadlock) and
   **must not** be `JobsDb` (it is reserved for single async-bridged DB
   calls). Put a short comment with this reason next to the tuple.

### 4. Producer side (`domain/plugin/loading.py`)

1. Add one private helper:

   ```python
   TEMPLATE_DISPATCH_TIMEOUT_SECONDS = 600.0

   def _emit_and_wait(name: EventName, payload: PluginTemplatesChangedEvent | PluginTemplatesRemovedEvent) -> None:
       """Emit a template event and block until all consumers handled it; raises on
       dispatch rejection, handler failure, or timeout."""
       receipt = submit_event(Event(name=name, payload=payload))
       receipt.result(timeout=TEMPLATE_DISPATCH_TIMEOUT_SECONDS)
   ```

   Exceptions (`DispatcherError` subclasses, `AggregateDispatchError`,
   `TimeoutError`) propagate to `_run_managed`, which records `updater_error`
   and emits `PluginGlobalErrorEvent` exactly as for any other failure today.
   The timeout is only a safety net; with step 1 every receipt eventually
   resolves.
2. `load_plugins`: after `publish_bulk_snapshot`, emit
   `PluginTemplatesChangedEvent` for each loaded plugin **one at a time**,
   waiting for each receipt (keeps at most one `General` worker busy with
   ingestion, as today's sequential loop). Unlike today, do not abort on the
   first failure: collect failing plugin ids and, after the loop, raise one
   `RuntimeError` listing them. The operation still fails (so
   `plugins_ready()` stays false and `updater_error` is set), but the other
   plugins' templates are still ingested.
3. `update_single`: replace the `ingest_plugin_templates(...)` call with
   `_emit_and_wait(..., PluginTemplatesChangedEvent(pluginId))`, same
   position and condition.
4. `unload_single`: reverse the order:
   1. `_emit_and_wait(..., PluginTemplatesRemovedEvent(plugin_id))`;
   2. only then `publish_unloaded(plugin_id)` (keep its failure handling).

   If dispatch fails, the plugin stays published and the operation fails; a
   retry re-emits safely because removal is idempotent. Unload/uninstall
   reservations already ignore `updater_error`, so retry is possible.
5. `uninstall_plugin_sync`: reverse the order to `unload_single(plugin_id)`
   first, then `delete_plugin_state(...)`. If template removal fails, the
   plugin keeps its DB state and stays installed and published (consistent,
   retryable); the route's "is installed" check keeps working for a retry.
6. Delete `domain/plugin/template_ingest.py` (moved in step 3) and its import.

### 5. Readiness

No code change is needed: `load_plugins` runs inside the managed
`plugin.initial-load` operation and waits for every ingestion receipt before
returning, so `operation_in_progress` stays set (status `running`) until all
required template dispatches complete, and any dispatch failure sets
`updater_error` (status `failure: ...`). `plugins_ready()` therefore already
means "plugin-management startup succeeded and all required template
dispatches completed without failure". Add one sentence saying exactly this to
the `plugins_ready` docstring (it has none today).

### 6. Docstrings and docs

- `domain/plugin/__init__.py`: delete the circularity note; replace "Depends
  on Glyph domain (for glyph remapping)" with the actual dependencies (the
  plugin domain no longer imports glyphs; it depends on the Notification
  domain for event contracts). Add: "Loosely coupled to Blueprint: emits
  `PluginTemplatesChangedEvent`/`PluginTemplatesRemovedEvent` (see
  `events.py`), handled by `domain/blueprint/dispatchers.py`; the plugin
  domain never imports blueprint."
- `domain/blueprint/__init__.py`: delete the circularity note; add "Consumes
  plugin template events via `dispatchers.py` (`template_ingest.py`)".
- `domain/plugin/state.py` and `domain/plugin/submit.py` docstrings mention
  "template ingestion" as work done on the plugin-management worker; reword
  to "waiting for template event dispatch".
- `domain/plugin/errors.py` describes the `template_ingest` error source;
  keep the source value, update wording if it says the plugin domain
  performs the ingestion.

## Tests and validation

Unit tests:

1. Move `tests/unit/domain/plugins/test_plugin_template_ingest.py` to
   `tests/unit/domain/blueprint/test_template_ingest.py`; adapt to the new
   signature (populate `PluginManager.plugins` with the fake plugin in the
   fixture and reset it afterwards); add a test that a plugin missing from the
   catalogue raises `PluginTemplatesUnavailable`.
2. `tests/unit/utility/test_dispatcher.py`, using a fake manager that returns
   *pending* futures it controls:
   - `_dispatch` returns while handler futures are still pending, and the
     receipt is not done;
   - completing the futures in arbitrary order resolves the receipt once, with
     all handler ids; one failing handler yields `AggregateDispatchError` and
     the others still count as completed;
   - a submission that raises synchronously is counted as a failed handler and
     the receipt still resolves;
   - envelopes left in the queue when `entrypoint` exits get
     `DispatcherClosed`.
   The existing inline-fake tests must keep passing (callbacks fire
   synchronously on already-done futures).
3. `tests/unit/domain/plugins/`: tests for `loading.py` with `submit_event`
   patched to return controllable futures:
   - `unload_single` does not call `publish_unloaded` when the receipt fails,
     and calls it after a successful receipt;
   - `uninstall_plugin_sync` keeps the DB state when template removal fails;
   - `load_plugins` emits one changed event per loaded plugin, continues after
     a failed receipt, and raises at the end listing the failed plugin.
4. `tests/unit/domain/blueprint/test_dispatchers.py`: the tuple contains the
   two registrations on `ConcurrentPools.General` with the expected
   `handler_type`s, and the handlers call the ingestion/removal functions with
   the payload's id.
5. Add a static guard test (or a check in an existing test module) that no
   file under `domain/plugin/` contains `forecastbox.domain.blueprint` - cheap
   and prevents regressions.

Integration tests: the existing ones in `tests/integration/test_blueprint.py`
cover the observable behaviour and must pass unchanged:
`test_plugin_template_in_blueprint_list` (ingestion at startup),
`test_plugin_template_exclusion` (settings change -> re-ingest with
exclusion), `test_plugin_template_validation_failure` (per-template error
persistence). If no integration test covers disable/uninstall removing
templates, add one: disable the test plugin via `POST /plugin/settings` with
`isEnabled: false`, wait for `/status` plugins `ok`, assert its templates are
gone from `/blueprint/list`, then re-enable it and wait until they are back
(restore state for later tests).

Then `just val` and `uv run prek`.

## Completion criteria

- `grep -rn "domain.blueprint" backend/src/forecastbox/domain/plugin` returns nothing.
- `domain/plugin/template_ingest.py` no longer exists; the circularity notes
  are gone from both domain docstrings.
- The dispatcher thread never blocks on handler futures.
- Startup still reports plugins `ok` only after templates have been ingested,
  and the scheduler gate (Phase 4) still opens only after that.

## Outdated information in the original documents

- The design's event contract (`Event(name, kwargs)` routed by
  `event_name`; `DispatcherRegistration.event_name`) was replaced during
  implementation by type-based routing: `Event(name, payload)` with
  `DispatcherRegistration.handler_type`. Event names are labels only. The
  migration's "event names `plugin.templates.changed` / `.removed`" are kept
  as labels; the contract is the payload class.
- The migration refers to `domain/plugin/manager.py` and
  `_ingest_plugin_templates`. The plugin domain has since been split into
  `state.py`, `loading.py`, `submit.py`, `status.py`, `store.py`, and the
  ingestion lives in `domain/plugin/template_ingest.py`.
- The design states that dispatch completion is aggregated without the
  dispatcher waiting ("the aggregate callback must not resubmit work while
  holding manager or dispatcher registry locks"); the delivered dispatcher
  blocks on each handler. Step 1 aligns it with the design.
- The migration's readiness requirement ("prevent `plugins_ready()` from
  returning true while required startup reactions are incomplete or failed")
  is already satisfied by the existing `operation_in_progress` /
  `updater_error` mechanism once the producer waits on the receipts.
- The notification Phase 7 was delivered as a real websocket broadcaster
  (`domain/notification`), not the `ActiveWebsocketClientRegistry` PoC; it is
  only relevant here because the new events must not implement
  `as_client_notification`.

## Open questions

1. **Per-plugin failure during initial load.** This plan continues ingesting
   the remaining plugins and fails the operation at the end; today the first
   failure aborts the loop. Both leave `updater_error` set. Confirm the
   change is welcome.
2. **Who should own `asset_ingest_needed` and `template_errors` writes.** The
   plan keeps them in the blueprint handler (calls into
   `domain/plugin/db.py`), as the migration prescribes and so that a rejected
   dispatch leaves the flag set for the next load. The alternative is the
   producer checking/clearing the flag before emitting, which keeps plugin
   state writes inside the plugin domain but loses that "retry next time"
   property. Confirm.
3. **Timeout value.** `TEMPLATE_DISPATCH_TIMEOUT_SECONDS = 600` per plugin is
   a guess at "never hit in practice" for large template sets. Is there a known
   upper bound for ingestion time of the ECMWF plugin?
