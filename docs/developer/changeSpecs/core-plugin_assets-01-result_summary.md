# Task 01 -- Result Summary

## What was implemented

Introduced the `BlueprintTemplate` entity into `fiab-core` and wired it through
to the test plugin. No backend code was changed.

### Key files changed / added

* `backend/packages/fiab-core/src/fiab_core/fable.py` -- added
  `BlueprintTemplateEnvironment` and `BlueprintTemplate` pydantic models.
* `backend/packages/fiab-core/src/fiab_core/plugin.py` -- added the import of
  `BlueprintTemplate` and the `blueprint_templates` field to `Plugin`.
* `backend/packages/fiab-core/tests/test_fable.py` -- added four focused unit
  tests covering construction, extra-field rejection, and round-trip
  serialisation of `BlueprintTemplate` / `BlueprintTemplateEnvironment`.
* `backend/packages/fiab-plugin-test/src/fiab_plugin_test/__init__.py` -- added
  the `testBasic` template and updated the `plugin` lambda.
* `backend/packages/fiab-plugin-test/tests/test_base.py` -- added two unit tests
  asserting the template is present and its `display_name` is correct.

## Final field names and types

### `BlueprintTemplateEnvironment` (in `fiab_core.fable`)

| field | type | default |
|---|---|---|
| `environment_variables` | `dict[str, str]` | `{}` |

### `BlueprintTemplate` (in `fiab_core.fable`)

| field | type | default |
|---|---|---|
| `display_name` | `str` | required |
| `display_description` | `str` | required |
| `blocks` | `dict[BlockInstanceId, BlockInstance]` | required |
| `environment` | `BlueprintTemplateEnvironment \| None` | `None` |
| `local_glyphs` | `dict[str, str]` | `{}` |
| `example_values` | `dict[BlockInstanceId, dict[ConfigurationOptionId, str]]` | `{}` |
| `example_glyphs` | `dict[str, str]` | `{}` |

### `Plugin` new field (in `fiab_core.plugin`)

| field | type | default |
|---|---|---|
| `blueprint_templates` | `tuple[BlueprintTemplate, ...]` | `()` |

## `testBasic` shape (in `fiab_plugin_test`)

```python
display_name      = "testBasic"
display_description = "A minimal test template with a single source_text block."
blocks = {
    BlockInstanceId("text_source"): BlockInstance(
        factory_id = PluginBlockFactoryId(
            plugin  = PluginCompositeId(store="__self__", local="__self__"),
            factory = BlockFactoryId("source_text"),
        ),
        configuration_values = {ConfigurationOptionId("text"): "{{ example_text }}"},
        input_ids = {},
    )
}
local_glyphs    = {"example_text": "hello world"}
example_values  = {BlockInstanceId("text_source"): {ConfigurationOptionId("text"): "hello world"}}
example_glyphs  = {"example_text": "hello world"}
```

The `PluginCompositeId` uses the sentinel `"__self__"` strings; task 03 (or
later) must substitute the real composite ID when reading templates off the
installed plugin.

## Deviations from plan

None.

## What task 03 will build on

* `Plugin.blueprint_templates: tuple[BlueprintTemplate, ...]` -- iterate this
  to read all templates a plugin ships.
* `BlueprintTemplate.display_name` -- the stable upsert key; must be unique
  within a plugin.
* The sentinel `PluginCompositeId(store="__self__", local="__self__")` in the
  test plugin's block factory IDs -- task 03 should replace these with the real
  composite ID at install time.
