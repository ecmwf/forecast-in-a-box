# Task 03 -- Result Summary

## What was implemented

Plugin blueprint templates are now ingested into the `blueprint` table as
`plugin_template` rows on every (re)install.  The `testBasic` template from
`fiab-plugin-test` appears in `GET /blueprint/list` for any authenticated user
after startup.

### Key files changed / added

* `backend/src/forecastbox/domain/blueprint/db.py` -- added
  `find_plugin_template_id(*, created_by, display_name) -> BlueprintId | None`.
* `backend/src/forecastbox/domain/blueprint/service.py` -- added
  `template_to_builder(template, plugin_id) -> BlueprintBuilder` (pure helper);
  also imported `BlueprintTemplate`, `PluginCompositeId`, and `SelfPluginId`
  from `fiab_core.fable`.
* `backend/src/forecastbox/domain/plugin/manager.py` -- added the async
  `_ingest_plugin_templates(plugin_id, plugin)` coroutine (uses lazy imports to
  avoid a circular dependency between the plugin and blueprint domains); wired
  `_run_async_from_thread(_ingest_plugin_templates(...))` into both
  `load_plugins` (per-plugin, after `upsert_plugin_state`) and `update_single`
  (after `upsert_plugin_state`, only when the load produced a `Plugin`).
* `backend/tests/unit/domain/blueprint/test_blueprint_service.py` -- 6 new
  unit tests for `template_to_builder` (SelfPluginId replacement, environment
  propagation, local_glyphs copy, example_values isolation).
* `backend/tests/integration/test_blueprint.py` -- added
  `test_plugin_template_in_blueprint_list`, which polls `/plugin/status` until
  the loader is ready then asserts `GET /blueprint/list` returns exactly one
  item with `source == "plugin_template"` and `display_name == "testBasic"`.

## Mapping helper signature

```python
# backend/src/forecastbox/domain/blueprint/service.py
def template_to_builder(
    template: BlueprintTemplate,
    plugin_id: PluginCompositeId,
) -> BlueprintBuilder:
```

* Iterates `template.blocks`; replaces any `factory_id.plugin == SelfPluginId`
  with `plugin_id`.
* Builds `EnvironmentSpecification(environment_variables=...)` from
  `template.environment.environment_variables` if present, else leaves
  `builder.environment = None`.
* Copies `template.local_glyphs` verbatim.
* Does **not** copy `example_values` or `example_glyphs` -- these are
  guiding-only and must not appear in `configuration_values`.

## `find_plugin_template_id` signature

```python
# backend/src/forecastbox/domain/blueprint/db.py
async def find_plugin_template_id(
    *,
    created_by: str,
    display_name: str,
) -> BlueprintId | None:
```

Queries for the latest non-deleted `plugin_template` blueprint with the given
`created_by` (plugin composite id string) and `display_name`.  Returns `None`
if no row exists.

## Where the ingestion call sits in the lifecycle

`_ingest_plugin_templates` is an `async def` coroutine declared in
`domain/plugin/manager.py`.  It uses lazy (function-body) imports of
`domain.blueprint.db` and `domain.blueprint.service` to avoid a circular
dependency (`blueprint.service` imports `plugin.manager`).

Both `load_plugins` and `update_single` call it via
`_run_async_from_thread(_ingest_plugin_templates(plugin_id, plugin))` -- the
same pattern used for `upsert_plugin_state` -- immediately after the
`upsert_plugin_state` call, and only when the plugin loaded successfully.

A per-template `try/except` logs failures without aborting ingestion of the
remaining templates.

## How example_values / example_glyphs were handled

They are **ignored** in this task.  The `template_to_builder` function does not
copy them anywhere; the stored `BlueprintBuilder` JSON contains only `blocks`,
`environment`, and `local_glyphs`.  Tasks 04/05/06 may read them directly from
the `BlueprintTemplate` object (available at install time) or choose a
persistence strategy.

## Deviations from plan

* Lazy imports inside `_ingest_plugin_templates` were used rather than placing
  the function in `domain/blueprint/`.  This keeps the plugin domain
  self-contained and avoids restructuring the existing circular-import
  relationship between `blueprint.service` and `plugin.manager`.

## What tasks 04/05/06 will build on

* `find_plugin_template_id(created_by, display_name) -> BlueprintId | None` --
  task 04 (exclusion) can use this to locate the row to soft-delete.
* `template_to_builder(template, plugin_id) -> BlueprintBuilder` -- task 05
  (glyph remapping) should apply the remapping map to the builder returned by
  this function before persisting.
* `_ingest_plugin_templates` -- tasks 04/05/06 hook exclusion, remapping, and
  validation into this same per-template loop by extending the function body.
* `PluginState.excluded_templates`, `PluginState.glyph_remapping` (from task
  02) -- task 03 does not read them; tasks 04/05 will read them here to filter
  and remap templates before upsert.
