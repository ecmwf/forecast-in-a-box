# Task 06 -- Result Summary

## What was implemented

Template ingestion is now gated behind validation.  After exclusion and glyph
remapping, each template's builder is overlaid with the template's example
values and example glyphs, then run through `validate_expand(validate_only=True)`
before any DB upsert.  Templates that fail are skipped and their errors are
collected and persisted.  The plugin status endpoint surfaces them under a new
`plugin_template_errors` field.

### Key files added / changed

* `backend/src/forecastbox/domain/blueprint/service.py` -- added
  `resolve_builder_with_examples(builder, example_values, example_glyphs) -> BlueprintBuilder`.
* `backend/src/forecastbox/domain/plugin/db.py` -- added
  `update_template_errors(*, plugin_id, template_errors) -> None`.
* `backend/src/forecastbox/domain/plugin/manager.py` -- several changes:
  - `_ingest_plugin_templates`: wired in `resolve_builder_with_examples` +
    `validate_expand(validate_only=True)` before upsert; collects
    `template_errors`; calls `update_template_errors` after the loop.
  - `load_plugins`: restructured to a two-pass approach -- all plugins are
    installed/loaded and `PluginManager.plugins` is published before template
    ingestion starts.  This ensures `validate_expand` can resolve factory
    references during validation.
  - `PluginsStatus`: added `plugin_template_errors` field.
  - `status_full`: populates `plugin_template_errors` from
    `PluginState.template_errors`.
* `backend/packages/fiab-plugin-test/src/fiab_plugin_test/__init__.py` --
  added `_testFailValidation` template (references `nonexistent_factory`;
  always fails validation).
* `backend/tests/unit/domain/blueprint/test_blueprint_service.py` -- added 5
  unit tests for `resolve_builder_with_examples`.
* `backend/tests/integration/test_blueprint.py` -- added
  `test_plugin_template_validation_failure` integration test.

## `resolve_builder_with_examples` contract

```python
# backend/src/forecastbox/domain/blueprint/service.py
def resolve_builder_with_examples(
    builder: BlueprintBuilder,
    example_values: dict[BlockInstanceId, dict[ConfigurationOptionId, str]],
    example_glyphs: dict[str, str],
) -> BlueprintBuilder:
```

Returns a deep copy of `builder` with:

* Each block's missing `configuration_values` keys filled from
  `example_values[block_id]`; existing template values are never overwritten.
* `local_glyphs` extended by `example_glyphs` for any key absent from the
  template's own `local_glyphs`; existing local glyphs take precedence.

The function is pure: the caller's `builder` is never mutated.

## Pass/fail criteria

A template is considered failed if `validate_expand(validate_only=True)` returns
any non-empty `global_errors` list OR any entry in `block_errors` with at least
one error string.  The missing-glyphs soft path does not count as a hard failure
(missing glyph references are stripped from the block and reported separately).
On pass, any prior error recorded for that `display_name` is cleared (not
present in the dict written to `template_errors`).

An unexpected exception during per-template resolve+validate is also treated as
a failure: the `repr()` of the exception becomes that template's error string,
and ingestion continues with the remaining templates.

## Example value overlay precedence

"Example fills missing, does not clobber" -- chosen because example values are
documented as guiding defaults that the user is expected to override.  A value
already set in the template's `configuration_values` (e.g. a partial default the
plugin author wants locked in) must not be silently overwritten by an example.

## Load ordering change in `load_plugins`

The original `load_plugins` interleaved install, state-upsert, and template
ingestion in a single per-plugin loop, with `PluginManager.plugins` published
only at the end.  During validation, `validate_expand` reads
`PluginManager.plugins` to resolve factory references; since the plugin was not
yet published, every block reported "Plugin not found".

The fix restructures `load_plugins` into two passes:
1. Install + load all plugins; call `upsert_plugin_state` per plugin.
2. Publish `PluginManager.plugins = pmap(lookup)`.
3. Run `_ingest_plugin_templates` for each loaded plugin.

The updater thread remains alive throughout, so `status_brief()` still reports
"running" until the full process (including ingestion) completes.  No change was
needed for `update_single`, where the plugin is already published before
ingestion.

## How template errors are surfaced

`PluginState.template_errors` (JSON column added in task 02) stores a
`dict[str, str]` mapping `display_name` to error string, or `None` when all
templates validated successfully.  `status_full` reads this column and populates
`PluginsStatus.plugin_template_errors: dict[PluginCompositeId, dict[str, str]]`.
The field is omitted from the JSON response for plugins with no errors (Pydantic
default_factory).

Note: `PluginCompositeId` dict keys in `PluginsStatus` are serialized using
Python's `str()` of the frozen Pydantic model (e.g.
`"store='localTest' local='single'"`), not the `store:local` colon format
returned by `PluginCompositeId.to_str()`.  This is consistent with the existing
`plugin_errors` / `plugin_versions` fields.  Client code should use `str(plugin_id)`
to construct the lookup key.

## Deviations from plan

* `load_plugins` was restructured (two-pass) rather than using a temporary
  `PluginManager.plugins` mutation inside `_ingest_plugin_templates`.  The
  two-pass approach is cleaner and keeps all validation concerns inside the
  ingestion function.

## Follow-ups

* `PluginsStatus` dict keys should ideally use `PluginCompositeId.to_str()` as
  the serialized string (e.g. `"localTest:single"`).  This would require a
  custom Pydantic serializer on `PluginsStatus` or on `PluginCompositeId`
  itself, and affects all existing fields, so it is left as a separate cleanup.
* The lazy-import breach (plugin domain importing blueprint domain) noted in
  task 03 is still present; the planned refactor to an event/bus pattern remains
  deferred.
