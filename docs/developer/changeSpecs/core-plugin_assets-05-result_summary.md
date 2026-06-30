# Task 05 -- Result Summary

## What was implemented

Glyph-name remapping is now applied at install time: when a plugin's stored
`glyph_remapping` is non-empty, every non-excluded template's builder has its
glyph identifier references rewritten before the DB upsert.

### Key files added / changed

* `backend/src/forecastbox/domain/glyphs/resolution.py` -- added
  `remap_glyph_names(value, mapping) -> str`.
* `backend/src/forecastbox/domain/blueprint/service.py` -- added
  `remap_builder_glyphs(builder, mapping) -> BlueprintBuilder`; also imported
  `remap_glyph_names` from the glyphs domain.
* `backend/src/forecastbox/domain/plugin/manager.py` -- wired remapping into
  `_ingest_plugin_templates`: renamed `_glyph_remapping` to `glyph_remapping`,
  added `remap_builder_glyphs` to the lazy import, and applied it to each
  non-excluded builder when the remapping is non-empty.
* `backend/packages/fiab-plugin-test/src/fiab_plugin_test/__init__.py` -- added
  `_testRemapping` template and exposed it via the `plugin` lambda.
* `backend/tests/unit/domain/glyphs/test_resolution.py` -- added 13 focused
  unit tests for `remap_glyph_names`.
* `backend/tests/unit/domain/blueprint/test_blueprint_service.py` -- added 2
  unit tests for `remap_builder_glyphs`.
* `backend/tests/integration/test_blueprint.py` -- extended
  `test_plugin_template_exclusion` to also set `glyph_remapping` and assert the
  renamed glyph appears in the persisted builder for `testRemapping`.

## Function signatures

```python
# backend/src/forecastbox/domain/glyphs/resolution.py
def remap_glyph_names(value: str, mapping: dict[str, str]) -> str:
    ...
```

Rewrites glyph identifier names referenced inside `${...}` expressions of
`value` according to `mapping`.  Only names returned by `extract_glyph_names`
(AST-level variable identifiers, excluding filter and global names) are
candidates; everything else is left untouched.

```python
# backend/src/forecastbox/domain/blueprint/service.py
def remap_builder_glyphs(builder: BlueprintBuilder, mapping: dict[str, str]) -> BlueprintBuilder:
    ...
```

Returns a new `BlueprintBuilder` with:
* every block configuration-option value run through `remap_glyph_names`;
* every local-glyph value run through `remap_glyph_names`;
* every local-glyph key renamed if it is a key in `mapping`.

Returns the same object unchanged when `mapping` is empty.

## Substitution strategy and guarantees

`remap_glyph_names` uses a two-level regex pass:

1. Outer: `re.sub` over `\$\{([^}]+)\}` -- processes each `${...}` expression
   once, left to right, without re-scanning the result.
2. Inner: for each matched expression body, a single `re.sub` replaces all
   identifier tokens in `to_rename` at once using a union pattern
   `\b(name1|name2|...)\b`, where names are ordered longest-first to avoid
   prefix-ambiguity in alternation.

The non-recursive, no-double-application guarantee follows from `re.sub`
semantics: replacement strings are not re-scanned by the engine.  Mapping
`{"a": "b", "b": "c"}` on `${a}` yields `${b}`, not `${c}`.

Filter and global names (e.g. `floor_day`, `timedelta`) are already excluded
by `extract_glyph_names` and are therefore never touched by the inner pass.

## Where in ingestion the remap runs

In `_ingest_plugin_templates` (in `domain/plugin/manager.py`), for each
non-excluded template:

```python
builder = template_to_builder(template, plugin_id)
if glyph_remapping:
    builder = remap_builder_glyphs(builder, glyph_remapping)
# then upsert_blueprint(... builder ...)
```

This is after exclusion filtering and before the DB upsert.  Task 06 inserts
its validation step immediately after the `remap_builder_glyphs` call.

## Deviations from plan

None.  The implementation follows the plan verbatim.

## What task 06 will build on

* `remap_builder_glyphs` and `remap_glyph_names` -- already applied; task 06
  does not need to touch remapping.
* The seam in `_ingest_plugin_templates` after the remapping call is where task
  06 inserts its `validate_with_examples` step before `upsert_blueprint`.
* `_testRemapping` is now in the test plugin; it references `pluginGlyphOld`
  (renamed to `pluginGlyphNew` in the integration test settings fixture).
