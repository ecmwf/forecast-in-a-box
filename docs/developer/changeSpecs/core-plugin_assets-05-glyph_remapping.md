# Task 05 -- glyph remapping at install time

**Read `core-plugin_assets-00-overview.md`, then the result summaries of tasks
03 and 04.**

Goal: implement **glyph-name remapping** so that, at install time, a plugin's
glyph names can be rewritten to match this backend's global glyph names. The
remapping map is already persisted (task 04); this task **applies** it during
ingestion, just before the blueprint is upserted.

## Semantics (proposal step 5 + Technical Details)

* The remapping is a flat, **"regexp-style" rename of glyph names** -- a single
  pass over each occurrence. **Do not** resolve glyphs recursively or evaluate
  them; you only rename the glyph *identifiers* (the `name` inside `${ name ... }`
  references), and rename local-glyph **keys**.
* Given a `glyph_remapping: dict[str, str]` (old name -> new name), for a template
  being ingested you apply it to:
  * every **configuration option value** string in every block (rename glyph
    references inside `${...}` expressions);
  * every **local glyph value** string (same rename inside `${...}`);
  * every **local glyph key**: if a local-glyph key is in the remapping, rename
    the key itself.
* This runs in the plugin manager **after** exclusion filtering and **before** the
  DB upsert (and before task 06's validation). Only run it when the plugin's
  stored remapping is non-empty.

## Where the code goes (respect layering)

Two levels, per the proposal:

* **Low level -- "remap glyphs in a string"** belongs in `domain/glyphs/`
  (suggested: a new function in `domain/glyphs/resolution.py` or a small
  dedicated module). Signature idea:
  `def remap_glyph_names(value: str, mapping: dict[str, str]) -> str`. It rewrites
  the glyph identifiers referenced in `${...}` expressions of `value` according to
  `mapping`, leaving everything else (filters, literals, non-referenced text)
  intact.
* **High level -- "remap glyphs in a builder"** belongs in `domain/blueprint/`
  (suggested: a function in `domain/blueprint/service.py` or a sibling module),
  which iterates a `BlueprintBuilder` (or the template's blocks/local_glyphs) and
  calls the low-level function on each configuration-option value and each
  local-glyph value, and renames local-glyph keys present in the mapping.
  Signature idea:
  `def remap_builder_glyphs(builder: BlueprintBuilder, mapping: dict[str, str]) -> BlueprintBuilder`
  (return a remapped copy; keep it pure/non-mutating if practical).

Keep the import direction legal: `glyphs` depends on no other domain;
`blueprint` may depend on `glyphs` (it already does). Do not make `glyphs` depend
on `blueprint`.

## Implementing the low-level rename (caveats)

* The glyph reference syntax is Jinja-flavoured (`${ name }`, `${ name | filter }`,
  nested expressions). Use the existing machinery rather than hand-rolling a
  fragile regex:
  * `domain/glyphs/jinja_interpolation.py` exposes `extract_glyph_names(raw)` (AST
    walk that returns the set of referenced glyph names, excluding filter/global
    names). Use it to know which names are present.
  * For the actual substitution, the cleanest robust approach is to **render the
    expression with a renaming context**: build a context mapping each referenced
    name `n` to the *placeholder string* `"${" + mapping.get(n, n) + "}"`, but that
    risks double-processing filters. Given the proposal explicitly says this is a
    **non-recursive, regexp-style** rename and not a resolution, a **bounded
    textual substitution of identifier tokens** is acceptable and simpler: replace
    only whole-word occurrences of mapped names that appear as glyph identifiers
    (those returned by `extract_glyph_names`). Take care to:
    * only rename names that are keys in `mapping` (leave others untouched);
    * match identifiers on word boundaries so `root` does not match `rootDir`;
    * not touch filter/global names (`extract_glyph_names` already excludes them,
      so restrict the rename to names it reports).
  * Decide and document your approach in the result summary. Whatever you choose,
    it must be a single non-recursive pass (renaming to a name that is itself a
    mapping key must **not** be re-applied).
* Add unit tests pinning the tricky cases: word-boundary safety, filters
  preserved (`${ x | floor_day }` -> renamed `x` only), multiple references in one
  string, names not in the mapping left alone, and the no-double-application
  guarantee.

## Wiring into ingestion

In the task-03/04 ingestion routine, for each non-excluded template:

1. build the `BlueprintBuilder` from the template (task 03 helper);
2. load the plugin's `glyph_remapping` from `PluginState` (task 04 helper);
3. if non-empty, `builder = remap_builder_glyphs(builder, mapping)`;
4. upsert as before.

This is the seam task 04 left for you. Do not change the exclusion behaviour.

## Files to inspect

* `domain/glyphs/jinja_interpolation.py` -- `extract_glyph_names`,
  `render_expression`, `_FILTER_NAMES`.
* `domain/glyphs/resolution.py` -- `extract_glyphs`, `extract_glyphs_per_option`,
  `resolve_configurations`; style for glyph helpers.
* `domain/blueprint/service.py` -- `BlueprintBuilder` shape; where the high-level
  remap fits.
* The task-03 ingestion path and task-04 settings helpers.
* `tests/unit/domain/glyphs/test_resolution.py` -- unit-test style for glyphs.

## Tests

* **Unit (focused):** the low-level `remap_glyph_names` cases above, and a small
  high-level `remap_builder_glyphs` test (a builder with one block referencing a
  glyph + a local glyph key/value; assert references, local-glyph value, and the
  local-glyph key are all renamed).
* **Integration (extend the task-04 test):** add a `testRemapping` template to the
  test plugin (a small valid template that references a glyph name unique to this
  case). In the **same** integration test that already exercises `/plugin/settings`
  for exclusion, additionally set a `glyph_remapping` for `testRemapping` and
  assert that after re-ingest `GET /blueprint/list` returns the `testRemapping`
  item with the renamed glyph reflected (e.g. retrieve it via `/blueprint/get` and
  check the builder's configuration value/local glyph shows the new name). Keep it
  to that one test; do not add a separate heavyweight test.

## Out of scope

* Validation-with-examples (task 06).
* Any recursive glyph resolution or value evaluation -- this is rename-only.

## Definition of done

* Low-level glyph-name remap in `domain/glyphs/`; high-level builder remap in
  `domain/blueprint/`; both pure and non-recursive.
* Ingestion applies the plugin's stored remapping before upsert.
* `testRemapping` fixture added; the task-04 integration test extended to verify
  the rename in the list/get output.
* Focused unit tests; `just val` and `uv run prek` pass.
* `core-plugin_assets-05-result_summary.md` written: the two function signatures,
  the chosen substitution strategy and its guarantees, and where in ingestion the
  remap runs -- task 06 inserts validation immediately after this step.
