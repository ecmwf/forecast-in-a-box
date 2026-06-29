# Plugin Assets -- Implementation Overview (read this first)

This is the shared context for the multi-part implementation of the
**plugin assets** feature. The originating high-level proposal is
`docs/developer/changeSpecs/core-plugin_assets.md` -- read it once for the user
stories and motivation. This document and the per-task documents
(`core-plugin_assets-0X-*.md`) are the concrete implementation guidelines.

## How to use these documents

* Every developer reads **this overview** plus the **single `0X` document** for
  their task. If a prior task produced a `0X-result_summary.md`, read those too
  (they are short and record deviations from the plan).
* When you finish your task, write `core-plugin_assets-0X-result_summary.md`
  next to your task document. Keep it short (see "Result summary" below).
* Tasks are **sequential**: 01 -> 02 -> 03 -> 04 -> 05 -> 06. Each builds on the
  previous one's merged code. Do not start a task before its predecessor is
  merged unless told otherwise.

## What we are building (in one paragraph)

Plugins (pip-installable wheels exposing a `fiab_core.plugin.Plugin`) can today
declare only `BlockFactory` catalogues. We extend them so a plugin can also ship
**blueprint templates** -- partial, ready-to-customise blueprints with display
metadata, example values, and example glyphs. Installing a plugin becomes a
**stateful, persisted** operation: we record per-plugin settings (version,
timestamp, install error, the set of excluded templates, and glyph-name
remappings), and on every (re)install we read the plugin's templates and
**upsert** them into the existing `blueprint` table as `source="plugin_template"`
rows that are visible to all users and immutable by them. Excluded templates are
soft-deleted; glyph names can be rewritten to match this backend's global
glyphs; and each template is validated (with its example values applied) before
insertion, with failures recorded rather than aborting the whole install.

## Architecture orientation (where things live)

The backend lives in `backend/src/forecastbox/` with a strict import hierarchy
`utility < schemata < domain < routes < entrypoint` (see
`backend/development.md`). The packages in `backend/packages/` are separate
wheels: `fiab-core` (the plugin contract), `fiab-plugin-test` (the integration
test plugin), and others you will not touch.

Modules you must understand:

* **`packages/fiab-core/src/fiab_core/fable.py`** -- the plugin-facing data
  contract: `BlockInstance`, `BlockInstanceId`, `ConfigurationOptionId`,
  `PluginBlockFactoryId`, `BlockFactoryCatalogue`, `PluginCompositeId`. These are
  `FiabCoreBaseModel` (pydantic, `extra="forbid"`).
* **`packages/fiab-core/src/fiab_core/plugin.py`** -- the `Plugin` frozen
  dataclass (`catalogue`, `validator`, `expander`, `compiler`). Task 01 adds the
  blueprint-template field here.
* **`packages/fiab-plugin-test/src/fiab_plugin_test/__init__.py`** -- the test
  plugin. Defines `catalogue`, `validator`, `expander`, `compiler`, and a
  module-level `plugin = lambda: Plugin(...)`. Tasks add template fixtures here.
* **`domain/plugin/manager.py`** -- `PluginManager` (class-level mutable state
  guarded by a `threading.Lock`, shared state held in `pyrsistent` `PMap`s).
  `load_plugins` (initial load thread), `update_single` (single-plugin reinstall
  thread), `status_full`/`status_brief` (status synthesis). This is where the
  install lifecycle lives.
* **`domain/plugin/store.py`** -- plugin store parsing and `submit_install_plugin`.
* **`domain/plugin/compatibility.py`** -- `get_fiabcore_version`, version pinning.
* **`domain/blueprint/db.py`** -- `upsert_blueprint`, `get_blueprint`,
  `list_blueprints`, `soft_delete_blueprint`. The persistence for blueprints,
  including `source` and `created_by`.
* **`domain/blueprint/service.py`** -- `BlueprintBuilder` (the full builder used
  by the web API), `validate_expand(...)` (validation/expansion entry point),
  `save_builder`, `load_builder`.
* **`domain/blueprint/cascade.py`** -- `EnvironmentSpecification` (the full
  environment model; backend-only, not in fiab-core).
* **`domain/glyphs/`** -- glyph resolution. `jinja_interpolation.py` has
  `render_expression` / `extract_glyph_names`; `resolution.py` has the
  block-level helpers; `global_db.py` resolves user/global glyph buckets.
* **`schemata/jobs.py`** -- ORM models (`Blueprint`, `GlobalGlyph`, ...), the
  jobs-DB engine and `async_session_maker`, and `create_db_and_tables`.
* **`routes/plugins.py`** and **`routes/blueprint.py`** -- the HTTP layer.
* **`entrypoint/app.py`** -- `lifespan`, which calls `create_db_and_tables` for
  each schemata module, `submit_load_plugins(...)`, etc.

## Concurrency model (critical -- read carefully)

This bites people. The plugin install/update code runs in **background threads**
(`load_plugins`, `update_single`), not in the FastAPI async event loop.

* **Database access must go through the async loop.** SQLite allows one writer;
  all DB access is serialised by the async `Lock` in `utility/db.py` and uses the
  jobs-DB `async_session_maker`. Background threads must dispatch coroutines to
  the loop with `asyncio.run_coroutine_threadsafe(coro, loop).result()` -- see
  `domain/run/background.py` for the canonical pattern. The plugin updater threads
  currently have **no loop reference**; task 02 must capture the running loop
  (in `lifespan`, where `submit_load_plugins` is called) and stash it on
  `PluginManager` so the threads can use it. Do **not** create a second engine or
  call `asyncio.run(...)` inside a thread.
* **Shared in-memory state uses `pyrsistent`.** `PluginManager.plugins`,
  `.errors`, `.versions`, `.updatedatetime` are immutable `PMap`s: reads are
  lock-free; writes acquire `PluginManager.lock` only to swap the pointer. Keep
  that pattern for any new in-memory state.
* **Install must be atomic / single-flight.** Two installs of the same plugin
  must not run concurrently. The existing `submit_update_single` already enforces
  "updater is idle" via `PluginManager.lock` + the `updater` thread handle; build
  on that. Install can take time, and a user may trigger it repeatedly -- a
  second trigger while one is running must be rejected/queued, not run in
  parallel.

## Cross-cutting rules (apply to every task -- definition of done)

1. **Follow `backend/development.md`.** (The proposal calls it "guidelines.md";
   the actual file is `backend/development.md`.) In particular: full type
   annotations; `FiabBaseModel`/`FiabCoreBaseModel` instead of `pydantic.BaseModel`;
   frozen dataclasses for plain DTOs; `typing.NewType` for semantic ids; imports
   at module top level; respect the domain import hierarchy and each domain's
   `__init__.py` docstring (update the docstring if your change alters the
   domain's responsibilities or dependencies).
2. **`just val` must pass before you commit.** From `backend/`, `just val` runs
   `ty check` + unit tests + integration tests. Also run `uv run prek`
   (pre-commit) before committing. For package-local changes (task 01), also run
   that package's `just val`.
3. **No backwards-incompatible changes.**
   * **Routes:** never change an existing route's path, request, or response
     shape. Read `routes/__init__.py`'s docstring before touching `routes/`. New
     routes only; new request/response pydantic classes only.
   * **Database:** there is no migration mechanism. **Do not modify existing ORM
     classes** in `schemata/`. You may **add** new ORM classes and **add** nullable
     / defaulted columns only via new classes -- never alter existing columns.
   * **Config:** new `config.py` fields must have defaults.
   * **Plugin contract (`fiab-core`):** new fields on `Plugin` must have defaults
     so existing plugins (e.g. `fiab-plugin-ecmwf`) keep constructing unchanged.
4. **You work in `backend/` (Python) only.** You do **not** need to read or modify
   `frontend/`. No frontend change is required or expected by any of these tasks.
5. **Tests -- be frugal.**
   * Add a **small** number of focused unit tests (mocks where appropriate),
     covering the new logic you wrote. Do not add large unit-test suites.
   * **Do not modify integration tests at will.** Touch
     `backend/tests/integration/` **only** where your task explicitly asks for it
     (each task names the exact integration assertion to add). The integration
     harness is heavyweight (`tests/integration/conftest.py` boots the real app
     with the test plugin); adding a small assertion to an existing test, or one
     new focused test, is expected -- broad refactors are not.
   * `tests/largeE2E/` is out of scope; do not run or change it.

## The test plugin fixtures (the shared contract for integration tests)

Integration coverage relies on specifically-named blueprint templates shipped by
`fiab-plugin-test`. To avoid churn, each task adds the fixture it needs:

| Template `display_name` | Added by | Purpose |
|-------------------------|----------|---------|
| a basic valid template (e.g. `testBasic`) | task 01 | demonstrates the entity; reused by task 03's "present in list" check |
| `testExclusion`         | task 04  | excluded via the settings route; must disappear from the list |
| `testRemapping`         | task 05  | a glyph name is remapped; remapped result verified in the list |
| `testFailValidation`    | task 06  | fails validation-with-examples; reported as a per-template error |

Each template's `display_name` is the stable **key** for upsert and exclusion
(see the proposal's Technical Details). `display_name` must be unique within a
plugin. Keep fixtures minimal -- one or two blocks is enough.

## Glossary

* **BlueprintTemplate** -- the new fiab-core entity a plugin ships: the public,
  restricted subset of a `BlueprintBuilder` (`display_name`,
  `display_description`, `blocks`, environment `environment_variables`,
  `local_glyphs`) plus `example_values` and `example_glyphs`.
* **example_values** -- `dict[BlockInstanceId, dict[ConfigurationOptionId, str]]`:
  guiding values the user is *expected to override*. Kept separate from the
  builder's real `configuration_values`.
* **example_glyphs** -- `dict[str, str]`: example glyph values, same idea.
* **Plugin settings (persisted)** -- per-plugin record: installed version, update
  timestamp, install error, the set of excluded template names, and the glyph
  remapping map. Persisted in a new DB table (task 02).
* **Exclusion** -- a template `display_name` the admin chose not to import; its
  existing `plugin_template` blueprint rows are soft-deleted.
* **Glyph remapping** -- a flat (non-recursive, "regexp-style") rename of glyph
  names inside a template, applied at install time so a plugin's glyph names line
  up with this backend's global glyphs.

## Result summary -- what to write when done

Create `core-plugin_assets-0X-result_summary.md` containing, briefly:
* what you implemented and the key files you added/changed;
* any deviation from this plan and why;
* the new functions/classes/DB columns the **next** task will build on
  (names + one-line contracts), so the next developer need not re-read your diff;
* anything you deliberately deferred to a later task.
