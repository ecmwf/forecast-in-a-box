# Task 06 -- validate templates (with example values) before insertion

**Read `core-plugin_assets-00-overview.md`, then the result summaries of tasks
03, 04 and 05.**

Goal: gate template ingestion behind validation. After exclusion (task 04) and
glyph remapping (task 05), and **before** the DB upsert, resolve the template's
**example values and example glyphs** into the builder and run the existing
validation. Templates that fail are **not inserted**; their errors are collected
and persisted (the `template_errors` column added in task 02). The status surface
reports them.

## Behaviour (proposal step 6)

* A `BlueprintTemplate` is intentionally **partial** -- it may be missing values,
  so it need not pass validation on its own. But with its `example_values` and
  `example_glyphs` applied, it **must** pass. So:
  1. take the remapped `BlueprintBuilder` for the template;
  2. produce a *validation-only* builder by overlaying the template's example
     values/glyphs (newly implemented `resolve_builder_with_examples`);
  3. run `validate_expand(validation_builder, auth_context, validate_only=True)`
     (already exists in `domain/blueprint/service.py`);
  4. if validation reports errors, **skip the upsert** for that template and
     collect the errors; otherwise upsert the (non-overlaid) builder as before.
* Collect **all** template errors across the plugin (do not abort on the first)
  and persist them into `PluginState.template_errors` (keyed by `display_name`).
  Surface them via the status synthesis from task 02.

Important: the **example values are guiding only** and must **not** be persisted
into the stored `plugin_template` blueprint's `configuration_values`. The overlay
exists purely to make validation pass. The row you upsert is the builder from
tasks 03/05 (template values, not example values). Confirm this -- it is the crux
of "the user is expected to override the examples".

## `resolve_builder_with_examples` (new, in domain/blueprint)

Implement in `domain/blueprint/service.py` (or a sibling in `domain/blueprint/`),
since it needs `BlueprintBuilder` and the core types. Suggested contract:

```python
def resolve_builder_with_examples(
    builder: BlueprintBuilder,
    example_values: dict[BlockInstanceId, dict[ConfigurationOptionId, str]],
    example_glyphs: dict[str, str],
) -> BlueprintBuilder:
    """Return a copy of `builder` with example values/glyphs overlaid for validation only.

    Example configuration values fill in (without overwriting) the per-block
    configuration_values; example glyphs are merged into local_glyphs. The result
    is fed to validate_expand(validate_only=True); it is never persisted.
    """
```

Caveats / decisions to make and document:

* **Overlay precedence:** the proposal says the template need not pass without the
  examples, and the user overrides examples. For validation, examples should
  *fill gaps*. Decide whether an example value overrides an existing
  configuration value or only fills missing keys -- prefer "example fills missing,
  does not clobber an explicit template value" unless you find a reason otherwise;
  state your choice.
* `example_glyphs` merge into `local_glyphs` for the validation copy. Mind the
  existing rule in `validate_expand` that local glyph keys must not collide with
  **intrinsic** glyph names (it emits a global error). Keep example glyph names
  clear of intrinsics in the test fixture.
* Keep the function pure (operate on a deep copy; `validate_expand` itself deep
  copies when `validate_only=True`, but build your overlay on a copy too so you
  never mutate the caller's builder or the ingestion builder).

## Running validation in the ingestion path

* `validate_expand` is `async` and reads plugin/glyph state; call it on the loop
  via the task-02 `run_coroutine_threadsafe(...)` pattern from the updater thread,
  or restructure the per-template ingest coroutine so the whole
  resolve+validate+upsert sequence runs as one coroutine dispatched to the loop
  (cleaner -- prefer this).
* Use an **admin** `AuthContext` (as in task 03) so global-glyph resolution and
  ownership behave consistently.
* Treat a template as failed if `validate_expand` returns any `global_errors` or
  any non-empty `block_errors`. Persist the collected messages under the
  template's `display_name`. On success, clear any prior error for that name.
* Validation must not crash the whole install: wrap per-template
  resolve+validate in try/except; an unexpected exception becomes that template's
  recorded error (do not let it kill the updater thread). This mirrors the
  "offloaded operations must be fully try/except wrapped" rule in
  `backend/development.md`.

## Files to inspect

* `domain/blueprint/service.py` -- `validate_expand(...)` (study what it treats as
  errors: `global_errors`, `block_errors`, the local-glyph-vs-intrinsic collision,
  the soft "missing glyph" path), `BlueprintBuilder`, `save_builder`.
* `domain/glyphs/resolution.py` + `global_db.py` -- how glyphs are merged during
  validation (so your example-glyph overlay lands correctly).
* The task-03 ingestion path, task-04 exclusion seam, task-05 remap seam -- you
  insert validation after remap, before upsert.
* `domain/plugin/db.py` + `PluginState.template_errors` (task 02) and the status
  synthesis (task 02) -- where errors are stored and surfaced.
* `tests/integration/conftest.py` / `test_blueprint.py` -- harness + status route.

## Tests

* **Unit (focused):** test `resolve_builder_with_examples` overlay semantics
  (example fills missing config value; example glyphs merged; original builder
  untouched). Optionally a small test that a builder which validates only with
  examples is correctly classified pass/fail by your gate (can mock
  `validate_expand` or use the real one with the test plugin's catalogue if
  feasible in unit scope -- prefer mocking to keep it light).
* **Integration (the one the proposal specifies):** add a `testFailValidation`
  template to the test plugin -- one that is **invalid even with its example
  values** (e.g. references a non-existent factory, or an example value that the
  test plugin's `validator` rejects). Extend the **existing** plugin status
  integration test (from task 02) to assert that after startup
  `testFailValidation` is reported as a failed template via the status surface
  (its error appears under its `display_name`), and assert it is **absent** from
  `/blueprint/list` (it was not inserted). Keep the other fixtures
  (`testBasic`/`testExclusion`/`testRemapping`) passing. One focused test; do not
  restructure the harness.

## Out of scope

* No new routes (status already surfaces errors from task 02). No frontend.

## Definition of done

* `resolve_builder_with_examples` implemented in `domain/blueprint`; ingestion
  resolves examples + runs `validate_expand(validate_only=True)` before upsert;
  failures are skipped and collected.
* Example values/glyphs are used only for validation, never persisted into the
  stored blueprint.
* `PluginState.template_errors` populated; status reports per-template failures;
  install is never crashed by a bad template.
* `testFailValidation` fixture added; integration test verifies it is reported as
  failed and absent from the list.
* Focused unit tests; `just val` and `uv run prek` pass.
* `core-plugin_assets-06-result_summary.md` written: the final
  `resolve_builder_with_examples` contract, the pass/fail criteria used, and how
  template errors are surfaced -- this completes the feature, so also note any
  follow-ups or docstring/guideline updates still pending.
