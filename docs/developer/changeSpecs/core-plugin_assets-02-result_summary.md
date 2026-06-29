# Task 02 -- Result Summary

## What was implemented

Added a persistent install-state DB table for plugins (`plugin_state`), wired it
into the install lifecycle, surfaced install errors on the `/plugin/status`
endpoint, and added unit + integration tests.

### Key files added / changed

* `backend/src/forecastbox/schemata/jobs.py` -- added `PluginState` ORM class.
* `backend/src/forecastbox/domain/plugin/db.py` -- new file; async helpers
  `upsert_plugin_state`, `get_plugin_state`, `get_all_plugin_states`.
* `backend/src/forecastbox/domain/plugin/manager.py` -- added
  `PluginManager.loop`, helper `_run_async_from_thread`, wired DB persistence
  into `load_plugins` and `update_single`; made `status_full` async; added
  `plugin_install_errors` field to `PluginsStatus`.
* `backend/src/forecastbox/domain/plugin/__init__.py` -- updated docstring.
* `backend/src/forecastbox/entrypoint/app.py` -- stash running loop on
  `PluginManager.loop` before `submit_load_plugins`.
* `backend/src/forecastbox/routes/plugins.py` -- made `get_plugins_status_full`
  and `get_plugin_details` `async def` (both call `await status_full()`).
* `backend/tests/unit/domain/plugins/test_plugin_db.py` -- 5 unit tests for
  `upsert_plugin_state` insert/update semantics, error persistence, and
  `get_all_plugin_states`.
* `backend/tests/integration/test_db_startup.py` -- added
  `test_plugin_install_state_persisted` asserting `/plugin/status` reflects
  the test plugin install with no install error after startup.

## Final column names / types (`PluginState` in `schemata/jobs.py`)

| column | type | nullable | default |
|---|---|---|---|
| `plugin_id` | `String(255)` | no | PK |
| `version` | `String(255)` | yes | |
| `updated_at` | `UTCDateTime` | no | |
| `error` | `String(4096)` | yes | |
| `excluded_templates` | `JSON` | no | `[]` |
| `glyph_remapping` | `JSON` | no | `{}` |
| `template_errors` | `JSON` | yes | |

## `domain/plugin/db.py` function signatures

```python
async def upsert_plugin_state(*, plugin_id: str, version: str | None, error: str | None) -> None
async def get_plugin_state(plugin_id: str) -> PluginState | None
async def get_all_plugin_states() -> list[PluginState]
```

`plugin_id` is `PluginCompositeId.to_str(pluginId)` (i.e. `"store:local"`).

## How the loop is stashed

In `entrypoint/app.py` `lifespan`, just before `submit_load_plugins`:

```python
PluginManager.loop = asyncio.get_running_loop()
```

Background threads (`load_plugins`, `update_single`) read `PluginManager.loop`
and call `asyncio.run_coroutine_threadsafe(coro, loop).result()` via
the private `_run_async_from_thread` helper in `manager.py`.

## Status synthesis

`PluginsStatus` gains a new optional field (default `{}`):

```python
plugin_install_errors: dict[str, str] = {}
```

`status_full()` is now `async def`; it calls `get_all_plugin_states()` and
populates `plugin_install_errors` from rows where `error is not None`. DB
failures are caught and logged; the field defaults to `{}` on error.

Both routes that call `status_full` (`GET /plugin/status` and
`GET /plugin/details`) are now `async def`.

## Deviations from plan

* `load_plugins` now wraps each plugin's install in a per-plugin try/except,
  persists the per-plugin install error to DB, and continues to the next
  plugin rather than aborting the whole load on the first install failure. This
  is a minor behavioral improvement. Import errors (`PluginManager.errors`) are
  unchanged.
* The outer `PluginManager.updater_error` is still set if an unexpected
  exception escapes the per-plugin loop (e.g. a lock acquisition failure).

## What tasks 03-06 will build on

* `PluginState.plugin_id` (string `store:local`) -- the stable upsert key.
* `PluginState.excluded_templates` (JSON list of `display_name` strings) --
  task 04 writes this via a new settings-update route.
* `PluginState.glyph_remapping` (JSON dict `{old_name: new_name}`) -- task 05
  writes this.
* `PluginState.template_errors` (JSON, nullable) -- task 06 writes per-template
  validation errors here.
* `upsert_plugin_state` -- task 03 calls this after reading templates; tasks
  04/05/06 call it to write their respective columns (use direct SQLAlchemy
  `update` on the columns they own, not `upsert_plugin_state`, to avoid
  clobbering the `version`/`error` fields).
* `get_all_plugin_states` / `get_plugin_state` -- task 03+ use these to read
  persisted settings when (re)installing templates.
* `PluginsStatus.plugin_install_errors` -- already exposed at `/plugin/status`;
  tasks 04-06 may extend the status surface with additional fields.
