# Task 04 -- Result Summary

## What was implemented

Added a `POST /plugin/settings` admin-guarded route that persists per-plugin
install settings (`excluded_templates`, `glyph_remapping`) and triggers a
re-ingest so exclusions take effect immediately.  The ingestion path (from
task 03) now honours the `excluded_templates` list: excluded templates are
soft-deleted from the DB and skipped; non-excluded templates are upserted as
before.

### Key files added / changed

* `backend/src/forecastbox/domain/plugin/db.py` -- added
  `update_plugin_settings` (partial update of settings columns) and
  `get_plugin_settings` (returns `(excluded_templates, glyph_remapping)`
  tuple with empty defaults when no state exists yet).
* `backend/src/forecastbox/domain/blueprint/db.py` -- added
  `soft_delete_plugin_template(*, created_by, display_name)` bulk
  soft-delete helper.
* `backend/src/forecastbox/domain/plugin/manager.py` -- modified
  `_ingest_plugin_templates` to load `excluded_templates` from
  `PluginState`, soft-delete excluded templates, and skip their upsert.
  Glyph remapping is loaded but not applied (task 05 seam is noted inline).
* `backend/src/forecastbox/routes/plugins.py` -- added
  `PluginSettingsUpdateRequest` and `async def update_plugin_settings_endpoint`
  at `POST /plugin/settings`, admin-guarded.
* `backend/packages/fiab-plugin-test/src/fiab_plugin_test/__init__.py` --
  added `_testExclusion` template and exposed it via the `plugin` lambda
  alongside `_testBasic`.
* `backend/tests/unit/domain/plugins/test_plugin_db.py` -- 5 new unit tests
  for `update_plugin_settings` (partial update, explicit clear, missing row)
  and `get_plugin_settings`.
* `backend/tests/unit/domain/blueprint/test_blueprint_db.py` -- new file;
  2 unit tests for `soft_delete_plugin_template` (matching rows deleted,
  other plugins unaffected).
* `backend/tests/integration/conftest.py` -- added `backend_admin_client`
  session fixture (separate httpx.Client authenticated as `admin@somewhere.org`).
* `backend/tests/integration/test_blueprint.py` -- added
  `test_plugin_template_exclusion` integration test.

## Route + request class

```python
class PluginSettingsUpdateRequest(FiabBaseModel):
    pluginCompositeId: PluginCompositeId
    excluded_templates: list[str] | None = None  # None => leave unchanged
    glyph_remapping: dict[str, str] | None = None  # None => leave unchanged

@router.post("/settings")
async def update_plugin_settings_endpoint(
    request: Request,
    body: PluginSettingsUpdateRequest,
    admin: UserRead | None = Depends(get_admin_user),
) -> Response:
```

The route `await`s `update_plugin_settings`, then calls
`submit_update_single(..., install=False, version=None)` to trigger a
re-ingest without a pip install. Returns the 202 `get_catalogue_redirect`
pattern.

## Settings / DB helper signatures

```python
# domain/plugin/db.py
async def update_plugin_settings(
    *,
    plugin_id: str,
    excluded_templates: list[str] | None,
    glyph_remapping: dict[str, str] | None,
) -> None: ...

async def get_plugin_settings(plugin_id: str) -> tuple[list[str], dict[str, str]]: ...
```

`update_plugin_settings` is a partial update: `None` means "leave stored value
unchanged".  An empty list/dict explicitly clears.  If no row exists yet, a new
row is inserted with `plugin_version="not installed"` and provided settings (or
empty defaults for omitted fields).

## Exclusion seam in `_ingest_plugin_templates`

```python
excluded_templates, _glyph_remapping = await get_plugin_settings(plugin_id_str)
excluded_set = set(excluded_templates)

for template in plugin.blueprint_templates:
    if template.display_name in excluded_set:
        await soft_delete_plugin_template(created_by=plugin_id_str, display_name=template.display_name)
        continue
    # ... upsert as before
```

`_glyph_remapping` is intentionally unused here; the underscore prefix signals
that task 05 should replace it with an application step between
`template_to_builder(template, plugin_id)` and the `upsert_blueprint` call.

## Where task 05 applies remapping

In `_ingest_plugin_templates`, immediately after:

```python
builder = template_to_builder(template, plugin_id)
```

task 05 should apply `_glyph_remapping` to rewrite glyph names in `builder`
before calling `upsert_blueprint`.  The variable `_glyph_remapping` (currently
a `dict[str, str]`) is already in scope at that point; task 05 only needs to
rename it to `glyph_remapping` (remove the leading underscore) and add the
application logic.

## Re-inclusion semantics for previously-excluded templates

When a template is re-included after having been excluded (soft-deleted),
`find_plugin_template_id` returns `None` (it ignores soft-deleted rows).  The
upsert therefore creates a fresh blueprint with a new UUID.  The old
soft-deleted rows remain untouched (historical references via pinned
`blueprint_id` + version remain resolvable).

## Deviations from plan

* `update_plugin_settings` creates rows with sentinel `plugin_version="not
  installed"` when no state exists yet.  This matches the pattern already
  established by `upsert_plugin_state` which uses `"install failed"` for failed
  installs.
* The integration test uses a new `backend_admin_client` session fixture
  (separate httpx.Client) rather than reusing `backend_client_with_auth`.
  This avoids cookie-state interference between the shared clients.  The
  fixture relies on `admin@somewhere.org` being a superuser (registered first
  by `test_admin_flows.py`), consistent with the existing known ordering
  dependency in the test suite.

## What task 05 will build on

* `get_plugin_settings(plugin_id) -> (list[str], dict[str, str])` -- already
  called in `_ingest_plugin_templates`; task 05 uses the returned
  `glyph_remapping` dict to rewrite glyph names.
* `_glyph_remapping` variable in `_ingest_plugin_templates` -- rename to
  `glyph_remapping` and apply it to the builder.
* `update_plugin_settings` -- task 05 can call it (or call
  `domain/plugin/db.py`'s `update` directly) to write the `glyph_remapping`
  column via the same settings route; no new DB helpers needed.
