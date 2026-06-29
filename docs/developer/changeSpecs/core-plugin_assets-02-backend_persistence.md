# Task 02 -- backend persistence: stateful plugin install lifecycle

**Read `core-plugin_assets-00-overview.md` first, then
`core-plugin_assets-01-result_summary.md`.**

Goal: make plugin installation **stateful and persisted**. Add a DB table that
records, per plugin, its settings and install state; populate/update it through
the existing install lifecycle; and make the plugin status endpoint synthesise
DB-persisted install state with the in-memory import state.

**No blueprint templates are read or inserted in this task.** That is task 03.

## What to persist (the new table)

One row per plugin (keyed by the readable composite id, e.g. `localTest:single`).
Columns (proposal "First phase of backend"):

* `plugin_id` (string, primary key) -- the `PluginCompositeId` rendered via
  `PluginCompositeId.to_str(...)` (form `store:local`).
* `version` (string, nullable) -- installed plugin version at last (re)install.
* `updated_at` (datetime) -- timestamp of the last (re)install.
* `error` (string, nullable) -- the **install** error (pip/install failure), if
  any. Distinct from import errors (see "Status synthesis").
* `excluded_templates` (JSON, default empty list) -- template `display_name`s the
  admin chose to exclude. **Add the column now with an empty-list default**; it is
  written by task 04. Defining it here avoids a later schema change (we have no
  migrations).
* `glyph_remapping` (JSON, default empty dict) -- glyph-name rename map. **Add the
  column now with an empty-dict default**; written by task 05.
* `template_errors` (JSON, nullable) -- per-template validation errors. **Add the
  column now**; written by task 06.

Defining the task-04/05/06 columns up front (with safe defaults) is intentional:
the "no migrations / don't alter existing classes" rule means it is far cheaper
to add them once here than to add new ORM classes later. Insert default
(empty/no-override) values on first install; update version/timestamp on updates.

### Where to declare it

* Add a **new ORM class** (suggested name `PluginState`) to
  `schemata/jobs.py`. Reusing the jobs-DB `async_session_maker` keeps all app
  state on one connection pool, exactly as `domain/blueprint/db.py` does (it
  imports `forecastbox.schemata.jobs as _jobs_module` and uses
  `_jobs_module.async_session_maker`). Do **not** create a new engine/session
  maker or a new schemata module unless you find a concrete blocker -- if you do,
  document it in the result summary.
* Follow the existing ORM style in `jobs.py` (sqlalchemy `Column`, `UTCDateTime`
  from `forecastbox.utility.time`, `JSON` for the dict/list columns). **Only add**
  the class; do not touch `Blueprint`, `Run`, etc. `create_db_and_tables` already
  creates all tables on `Base.metadata.create_all`, so the new table is picked up
  automatically.

## Files to inspect

* `schemata/jobs.py` -- ORM patterns, `Base`, engine/session maker,
  `create_db_and_tables`.
* `domain/blueprint/db.py` -- the template to copy for a domain `db.py`: it uses
  `_jobs_module.async_session_maker`, `dbRetry`, `executeAndCommit`,
  `querySingle` from `utility/db.py`, and `current_time("dbref")` from
  `utility/time.py`.
* `domain/plugin/manager.py` -- `PluginManager`, `load_plugins`,
  `update_single`, `unload_single`, `status_full`, `status_brief`,
  `submit_load_plugins`, `submit_update_single`. The lifecycle you hook into.
* `domain/plugin/store.py` -- `submit_install_plugin` (config write + triggers
  `submit_update_single`).
* `domain/run/background.py` -- the canonical
  `asyncio.run_coroutine_threadsafe(coro, loop).result()` pattern for writing to
  the DB from a background thread.
* `entrypoint/app.py` -- `lifespan`; `submit_load_plugins(start_after=...)` is
  called here inside the running loop.
* `routes/plugins.py` -- `get_plugins_status_full` (`/plugin/status`) and
  `PluginsStatus`; the status surface you extend.
* `utility/auth.py` -- `AuthContext` (use an admin context for system writes if a
  helper requires one; this table is not user-scoped so you may not need it).

## Implementation

### 1. ORM + domain `db.py`

Add `PluginState` to `schemata/jobs.py`. Create
`domain/plugin/db.py` (new file; the plugin domain currently has no `db.py`) with
async helpers, e.g.:

* `async def upsert_plugin_state(*, plugin_id: str, version: str | None, error: str | None) -> None`
  -- insert the row with default empty exclusion/remap on first install; on
  subsequent installs update `version`, `updated_at`, and `error` **without
  clobbering** `excluded_templates` / `glyph_remapping` (those are owned by tasks
  04/05). Use `dbRetry` and the jobs session maker; set `updated_at` via
  `current_time("dbref")`.
* `async def get_plugin_state(plugin_id: str) -> PluginState | None` and/or
  `async def get_all_plugin_states() -> list[PluginState]` for the status
  endpoint.

Keep these helpers free of HTTP concerns. Per `backend/development.md`, domain
`db.py` modules own version/auth concerns -- this table is unversioned app state,
so just keep writes idempotent and document that in the module docstring.

Update `domain/plugin/__init__.py`'s docstring if this task changes the domain's
responsibilities (it now owns persisted install state).

### 2. Wire persistence into the lifecycle (mind the loop!)

The writes happen inside the **background updater threads** (`load_plugins`,
`update_single`), which are not on the event loop. You must:

* Capture the running loop where `submit_load_plugins` is invoked (in `lifespan`,
  `entrypoint/app.py`, which runs on the loop) and stash it on `PluginManager`
  (e.g. `PluginManager.loop: asyncio.AbstractEventLoop | None`). The route-driven
  `submit_update_single` path runs in a threadpool (sync `def` routes) and
  cannot call `get_running_loop()`, so it must reuse the stashed loop. Thread the
  loop into the thread targets (or read it off `PluginManager` inside the thread).
* Inside the thread, run DB coroutines via
  `asyncio.run_coroutine_threadsafe(upsert_plugin_state(...), loop).result()`,
  exactly like `domain/run/background.py`. Never call `asyncio.run(...)` in the
  thread.
* On a successful install: write `version` (use `try_version(...)` already
  computed in the manager), clear `error`. On an install failure
  (`install_plugin_compatibly` raised): write the `error` string and still record
  the attempt timestamp. Keep the existing in-memory `PluginManager.versions` /
  `errors` updates intact.

### 3. Atomicity / single-flight

Installs of the same plugin must not overlap. The existing `submit_update_single`
already refuses to start when the updater thread is alive (it returns
`"plugin updater is not idle"` and the route maps that to a 500). Confirm this
guarantee still holds with your changes and that a repeated user trigger during
an in-progress install is rejected, not run concurrently. Do not weaken the
existing locking. If you add any new shared state, follow the
`pyrsistent` + `PluginManager.lock` swap pattern. Note the install path can be
slow (pip), so do not hold the async DB lock across the whole install -- only
across the short `upsert_plugin_state` coroutine.

### 4. Status synthesis (install error vs import error)

The proposal: **install errors live in the DB; import errors live in in-memory
state; the status endpoint synthesises both.**

* Import errors are the existing `PluginManager.errors` (a plugin installed fine
  but failed to import/`plugin()`).
* Install errors are the new `PluginState.error`.
* Extend the status surface so a caller can see both. Prefer adding a **new
  field** to `PluginsStatus` (e.g. `plugin_install_errors: dict[str, str]`)
  populated from the DB, rather than changing the meaning of the existing
  `plugin_errors`. **Do not change** the existing `PluginsStatus` fields or the
  `/plugin/status` response shape in a breaking way -- additive only (see
  `routes/__init__.py`). `status_full` currently reads only in-memory state; have
  it (or the route) also load persisted install state. `status_full` runs on the
  loop via the route, so it can `await` the DB directly.

  Caveat: `status_full`/`status_brief` are sometimes called without the lock and
  must not block; keep DB reads best-effort and tolerant of a missing row (plugin
  configured but never installed yet).

## Tests

* **Unit (minimal, mocked):** test `upsert_plugin_state` insert-then-update
  semantics against an in-memory SQLite (monkeypatch `async_session_maker` as
  other unit tests do -- see `tests/unit/test_jobs.py` / how blueprint db tests
  inject a memory DB), asserting first install creates a row with empty
  exclusion/remap defaults and a second install updates version/timestamp without
  clobbering them. Optionally a small test of the status-synthesis merge logic
  with mocked DB + in-memory states.
* **Integration (one assertion only):** the integration harness already installs
  `fiab-plugin-test` (`tests/integration/conftest.py`). Add an assertion -- to an
  existing plugin/status test if one exists, otherwise a small new test -- that
  after startup the test plugin's install is **reported** via the status surface
  (a `PluginState` row exists / `/plugin/status` reflects it with no install
  error). Do not restructure the harness. Keep it to the minimal assertion the
  proposal asks for ("test plugin install is correctly reported").

## Out of scope

* Reading or inserting blueprint templates (task 03).
* The settings-update route, exclusion, remapping, validation (tasks 04-06) --
  but **do** create their columns now, as specified above.

## Definition of done

* `PluginState` ORM added to `schemata/jobs.py` (with the exclusion/remap/error
  columns and safe defaults); `domain/plugin/db.py` helpers added.
* Install lifecycle writes/updates the row from the updater threads via the
  stashed loop; install errors persisted; import errors unchanged.
* Single-flight install preserved.
* `/plugin/status` additively exposes persisted install state; existing fields
  unchanged.
* Minimal unit tests + one integration assertion; `just val` and `uv run prek`
  pass.
* `core-plugin_assets-02-result_summary.md` written: the final `PluginState`
  column names/types, the `domain/plugin/db.py` function signatures, how/where the
  loop is stashed, and how status synthesis is exposed -- tasks 03-06 build
  directly on all of these.
