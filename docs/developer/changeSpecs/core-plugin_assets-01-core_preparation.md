# Task 01 -- fiab-core preparation: the BlueprintTemplate entity

**Read `core-plugin_assets-00-overview.md` first.**

Goal: extend the **`fiab-core`** package with a `BlueprintTemplate` entity that a
plugin can ship, expose it on the `Plugin` contract, add an example template to
the **`fiab-plugin-test`** package, and cover both with minimal unit tests.

This task is **package-local**: you work in `backend/packages/fiab-core/` and
`backend/packages/fiab-plugin-test/` only. No changes to
`backend/src/forecastbox/` and **no integration tests**.

## Background -- why a new entity (not reuse BlueprintBuilder)

The backend's full builder, `forecastbox.domain.blueprint.service.BlueprintBuilder`,
references backend-only types (`EnvironmentSpecification` in
`domain/blueprint/cascade.py`) and lives above the import hierarchy, so plugins
cannot depend on it. `fiab-core` is the plugin-facing contract. The proposal
deliberately exposes only a **restricted, public subset** of the builder to
plugin authors. This restricted subset is `BlueprintTemplate`.

The fields to expose (from the proposal's Technical Details):

* root level: `display_name`, `display_description` (exclude `tags` and other
  internal blueprint fields);
* `blocks`: a `dict[BlockInstanceId, BlockInstance]` -- included **as is**
  (validation that it is instantiable happens later, in the backend);
* environment: **only** `environment_variables` (a `dict[str, str]` KV). Exclude
  `cascade_infra`, `hosts`, `workers_per_host`, `runtime_artifacts`;
* `local_glyphs`: a `dict[str, str]` -- included as is.

Plus the two "guiding" maps, clearly separated from the builder so the user
knows they are examples to override:

* `example_values: dict[BlockInstanceId, dict[ConfigurationOptionId, str]]`
* `example_glyphs: dict[str, str]`

## Files to inspect

* `packages/fiab-core/src/fiab_core/fable.py` -- has `BlockInstance`,
  `BlockInstanceId`, `ConfigurationOptionId`, `FiabCoreBaseModel` usage. Model
  your new types in the same style (these are the types you reference).
* `packages/fiab-core/src/fiab_core/plugin.py` -- the `Plugin` frozen dataclass.
  You will add one field.
* `packages/fiab-core/src/fiab_core/pydantic_utils.py` -- `FiabCoreBaseModel`
  (`extra="forbid"`). Use it for the new pydantic models.
* `packages/fiab-plugin-test/src/fiab_plugin_test/__init__.py` -- the test plugin
  catalogue and the `plugin = lambda: Plugin(...)` factory at the bottom.
* `packages/fiab-core/tests/test_base.py`, `tests/test_fable.py` -- unit-test
  style for fiab-core.
* `packages/fiab-plugin-test/tests/test_base.py` -- unit-test style for the test
  plugin.
* Both packages' `justfile` (`val` recipe) and `pyproject.toml`.

## Implementation

### 1. Define the entity in fiab-core

Add the models to `fiab_core/fable.py` (it already holds the block/plugin data
contract -- keep the new types there rather than a new module, unless you have a
strong reason). Suggested shape:

```python
class BlueprintTemplateEnvironment(FiabCoreBaseModel):
    environment_variables: dict[str, str] = Field(default_factory=dict)


class BlueprintTemplate(FiabCoreBaseModel):
    """A partial, ready-to-customise blueprint shipped by a plugin.

    Exposes the public subset of a blueprint builder plus separate guiding
    example values/glyphs the user is expected to override. `display_name` is the
    stable key used by the backend for upsert and exclusion; it must be unique
    within a plugin.
    """
    display_name: str
    display_description: str
    blocks: dict[BlockInstanceId, BlockInstance]
    environment: BlueprintTemplateEnvironment | None = None
    local_glyphs: dict[str, str] = Field(default_factory=dict)
    example_values: dict[BlockInstanceId, dict[ConfigurationOptionId, str]] = Field(default_factory=dict)
    example_glyphs: dict[str, str] = Field(default_factory=dict)
```

Notes / caveats:
* Use `FiabCoreBaseModel` and `Field(default_factory=...)` for the collections,
  matching existing fable models. Do not use mutable default literals.
* Keep it a plain data model: no methods beyond what pydantic gives you. It is
  serialised and shipped across process/package boundaries.
* `example_values` values are **strings** (the same string-serialised form the
  frontend sends for `configuration_values`); the backend resolves/parses them
  later. Do not pre-convert.

### 2. Expose templates on the Plugin contract

In `fiab_core/plugin.py`, add a field to the `Plugin` dataclass **with a
default** so existing plugins keep working unchanged:

```python
blueprint_templates: tuple[BlueprintTemplate, ...] = field(default_factory=tuple)
```

* Use a `tuple` (immutable, matches the frozen-dataclass spirit) defaulting to
  empty. The backend keys templates by each template's `display_name`.
* Import `BlueprintTemplate` from `fiab_core.fable` at module top level.
* **Backwards compatibility:** verify `fiab-plugin-ecmwf` and `fiab-plugin-demo`
  still construct their `Plugin(...)` without changes (they simply won't pass the
  new field). Do not edit those plugins.

### 3. Add an example template to the test plugin

In `fiab_plugin_test/__init__.py`, construct **one** small, valid template named
`testBasic` (see the fixtures table in the overview) and pass it via the new
field on the `plugin` factory. Build it from existing test-plugin factories so it
is genuinely instantiable, e.g. a `source_text` block whose `text` references a
glyph, with a matching `example_values` / `example_glyphs` entry that would make
it valid. Keep it to one or two blocks.

* The template need not be valid *without* the example values (it is a partial
  template) but **must** be valid once example values/glyphs are applied -- that
  is what task 06 will check. Choose values that satisfy the test plugin's
  `validator`.
* Only add `testBasic` in this task. The `testExclusion` / `testRemapping` /
  `testFailValidation` fixtures are added by tasks 04/05/06 respectively.
* Do not change the existing `catalogue`/`validator`/`expander`/`compiler` or the
  `plugin` lambda's existing arguments -- only add the new keyword argument.

## Tests (minimal)

Add a couple of focused unit tests; do not over-test.

* In `packages/fiab-core/tests/` (e.g. extend `test_fable.py` or a small new
  file): assert a `BlueprintTemplate` constructs, rejects an unknown extra field
  (`extra="forbid"`), and round-trips `model_dump()`/`model_validate()`.
* In `packages/fiab-plugin-test/tests/`: assert `plugin().blueprint_templates`
  contains the `testBasic` template and that its `display_name` matches.

Run `just val` in **each** package (`backend/packages/fiab-core` and
`backend/packages/fiab-plugin-test`). Then, from `backend/`, run `just val` to
confirm nothing downstream broke (the backend depends on `fiab-core`).

## Out of scope (do NOT do here)

* No backend (`forecastbox`) code, no DB, no routes, no install logic.
* No glyph remapping, exclusion, or validation wiring -- later tasks.
* No integration tests.

## Definition of done

* `BlueprintTemplate` (+ environment sub-model) defined in fiab-core with the
  exact field set above; `Plugin` exposes `blueprint_templates` with a default.
* `fiab-plugin-test` ships the `testBasic` template, valid under its example
  values.
* Minimal unit tests added; `just val` passes in both packages and in `backend/`;
  `uv run prek` clean.
* `core-plugin_assets-01-result_summary.md` written, recording the final field
  names/types of `BlueprintTemplate`, the `Plugin` field name, and the exact
  `testBasic` shape -- task 03 needs these to read templates off the plugin.
