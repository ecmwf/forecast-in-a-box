# Task 04 -- plugin settings route + template exclusion

**Read `core-plugin_assets-00-overview.md`, then the result summaries of tasks
02 and 03.**

Goal: add a backend route that lets an admin update a plugin's **install
settings** -- the set of excluded templates and the glyph remapping map -- and
make the template-ingestion path (task 03) **honour exclusions**. Glyph
remapping is **stored but not yet applied** in this task (task 05 applies it).

## Behaviour (proposal step 4 + Technical Details)

* A single route accepts a request object carrying **both optional** fields:
  `excluded_templates` and `glyph_remapping`. Persist whatever is provided into
  the plugin's `PluginState` row (the `excluded_templates` / `glyph_remapping`
  columns added in task 02). Omitted fields leave the stored value unchanged.
* Settings are **persisted**, so updating the plugin or revisiting the install
  later reuses them without redefining from scratch (user story 3).
* Applying settings is part of (re)install: after updating settings, trigger a
  re-install / re-ingestion so the effect (exclusions) is reflected. The proposal:
  "This happens every time the user updates the installation instructions ... or
  the plugin itself is updated."
* **Exclusion semantics (key = `display_name`):** for each excluded
  `display_name`, find any blueprint with that `display_name` **created by this
  plugin** and set `is_deleted = True` (soft delete, all versions). Non-excluded
  templates are upserted as in task 03. The user story requires that previous
  executions/derived templates remain runnable -- soft-deleting the
  `plugin_template` rows hides them from the list but does not delete pinned
  `(blueprint_id, version)` rows referenced by runs (runs reference specific
  versions and `get_blueprint`/run paths still resolve them as needed; do not
  hard-delete).

## Files to inspect

* `routes/plugins.py` -- the plugin route module. Add the new route here (all
  plugin routes live in this file; autodiscovery requires a single file per
  router). Note the admin dependency `Depends(get_admin_user)` used by mutating
  routes (`/update`, `/install`, ...), the `get_catalogue_redirect` 202 response
  pattern, and that these routes are sync `def` and call `submit_*` to kick the
  background updater.
* `routes/__init__.py` -- **read the docstring** before adding a route. New
  request/response classes only; encapsulate the contract; no path parameters
  (pass `pluginCompositeId` as a query/body param like the existing routes).
* `domain/plugin/db.py` (task 02) -- add settings-mutation helpers here.
* `domain/plugin/manager.py` / `store.py` -- `submit_update_single` /
  `submit_install_plugin`; how a reinstall/re-ingest is triggered.
* `domain/blueprint/db.py` -- `soft_delete_blueprint` (note: it requires
  `expected_version` + auth and targets a known id) and the list/query helpers.
  You likely need a **new** bulk helper to soft-delete by
  `(created_by, display_name)`; do not contort the existing single-id function.
* The task-03 ingestion path -- you add the exclusion filter/soft-delete there.
* `tests/integration/test_blueprint.py` / `conftest.py` -- `testPluginId`, the
  list route, auth client.

## Implementation

### 1. The route

Add to `routes/plugins.py`, admin-guarded, e.g.:

```python
class PluginSettingsUpdateRequest(FiabBaseModel):
    pluginCompositeId: PluginCompositeId
    excluded_templates: list[str] | None = None      # None => leave unchanged
    glyph_remapping: dict[str, str] | None = None     # None => leave unchanged

@router.post("/settings")
def update_plugin_settings(request: Request, body: PluginSettingsUpdateRequest,
                           admin: UserRead | None = Depends(get_admin_user)) -> Response:
    ...
```

* `None` means "not provided -- keep existing"; an empty list/dict means
  "explicitly clear". Document this in the request class.
* The route persists settings, then triggers a re-install/re-ingest so exclusions
  take effect (reuse `submit_update_single(..., install=False, ...)` or an
  equivalent re-ingest trigger -- decide based on task 02/03's wiring and note
  it; you do not necessarily need a pip reinstall, just a re-run of the ingestion
  with the new settings). Return the existing `get_catalogue_redirect(request)`
  202 pattern.
* **Do not** change or remove any existing plugin route.

### 2. Persisting settings (domain)

Add helpers to `domain/plugin/db.py`:

* `async def update_plugin_settings(*, plugin_id: str, excluded_templates: list[str] | None, glyph_remapping: dict[str, str] | None) -> None`
  -- partial update; only overwrite provided fields; create the row if the plugin
  has no `PluginState` yet (configured but never installed). Use `dbRetry`.
* `async def get_plugin_settings(plugin_id: str) -> tuple[list[str], dict[str, str]]`
  (or return the `PluginState`) so the ingestion path can read the current
  exclusion list and (later) remapping.

### 3. Honour exclusions in ingestion

In the task-03 ingestion routine, before/while upserting:

* Load the plugin's `excluded_templates` from `PluginState`.
* For each template whose `display_name` is in the exclusion set: **skip the
  upsert** and ensure any existing plugin-owned blueprint with that
  `display_name` is soft-deleted. Add a domain helper, e.g.
  `async def soft_delete_plugin_template(*, created_by: str, display_name: str) -> None`
  in `domain/blueprint/db.py` that sets `is_deleted=True` for all rows matching
  `(created_by, display_name)` (use a bulk `update(...).where(...)`, like
  `soft_delete_blueprint`'s statement but keyed on created_by+display_name and
  without the version/expected checks, since the plugin owns these rows).
* Non-excluded templates: upsert as in task 03. (If a template was previously
  excluded and is now re-included, the upsert reuses its `blueprint_id` and adds a
  fresh, non-deleted version -- confirm `find_plugin_template_id` ignores
  soft-deleted rows or handle the un-delete explicitly; note your decision.)

Glyph remapping is read/stored but **not applied** in this task; leave a clear
seam (task 05 plugs in here).

## Tests

* **Unit (minimal):** `update_plugin_settings` partial-update semantics
  (provided field overwrites, `None` leaves prior value) against an in-memory DB;
  and `soft_delete_plugin_template` marks matching rows deleted.
* **Integration (the one the proposal specifies):** add `testExclusion` to the
  test plugin (`fiab_plugin_test/__init__.py`) -- a small valid template used
  **only** for this test. Then in the integration suite: call `POST
  /plugin/settings` to exclude `testExclusion`, wait for the re-ingest to settle
  (poll status/catalogue as existing plugin tests do), and assert `GET
  /blueprint/list` no longer contains a `testExclusion` item, while `testBasic`
  remains. Keep this to one focused test; do not restructure the harness.

  Note: the settings route is admin-guarded. Use whatever admin/passthrough
  client the harness provides for admin-only calls (see how existing admin-guarded
  plugin routes are exercised, if at all, or `tests/integration/test_admin_flows.py`).

## Out of scope

* Applying glyph remapping (task 05) -- only store it.
* Validation-with-examples (task 06).

## Definition of done

* `POST /plugin/settings` added (admin-guarded, both fields optional), persisting
  into `PluginState`; existing routes untouched.
* Ingestion honours `excluded_templates` (skip + soft-delete by
  `created_by`+`display_name`).
* `testExclusion` fixture added; integration test proves exclusion removes it from
  the list.
* Minimal unit tests; `just val` and `uv run prek` pass.
* `core-plugin_assets-04-result_summary.md` written: the route + request class,
  the settings/db helper signatures, the exclusion seam, and exactly where task
  05 should apply remapping in the ingestion path.
