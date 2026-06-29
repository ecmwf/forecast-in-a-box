# Task 03 -- ingest plugin blueprint templates into the database

**Read `core-plugin_assets-00-overview.md`, then the result summaries of tasks
01 and 02.**

Goal: during the install lifecycle, read the `blueprint_templates` a plugin
exposes and **upsert** them into the existing `blueprint` table as
`plugin_template` rows visible to all users. In this task you **ignore**
exclusion, glyph remapping, and validation -- those arrive in tasks 04/05/06.

## Behaviour to implement (proposal "Backend processes plugin blueprints")

When a plugin is (re)installed and successfully imported, for each
`BlueprintTemplate` it exposes:

* Convert the template into a stored `Blueprint` row with:
  * `source = "plugin_template"` (already a valid `BlueprintSource` literal in
    `schemata/jobs.py`) -- makes it visible to all users via
    `list_blueprints` (which `OR`s `source == "plugin_template"`).
  * `created_by = PluginCompositeId.to_str(plugin_id)` -- the plugin's id, so the
    row is owned by the plugin and immutable by ordinary users (the blueprint
    route/db ownership checks compare `created_by`).
  * `display_name` / `display_description` from the template.
  * `builder` = the JSON of a `BlueprintBuilder` reconstructed from the template
    (see "Mapping template -> builder").
* **Upsert keyed by `display_name`** (proposal): if a non-deleted blueprint with
  this `display_name` already exists **created by this plugin**, reuse its
  `blueprint_id` and append a new version; otherwise generate a fresh
  `blueprint_id` (version 1). This is exactly what `upsert_blueprint` already
  does when given / not given a `blueprint_id` -- you only need to **find** the
  existing id by `(created_by, display_name)`.

User stories this satisfies: a plugin update leaves prior executions/derived
templates untouched (they reference pinned `(blueprint_id, version)`), while a
new version of the template becomes the latest visible row.

## Files to inspect

* `domain/blueprint/db.py` -- `upsert_blueprint(...)` (note its `source`,
  `created_by`, `builder`, `blueprint_id`, `expected_version`, and the
  `id_provided` ownership check) and `get_blueprint`. This is the insertion
  primitive; **reuse it**, do not duplicate insert logic.
* `domain/blueprint/service.py` -- `BlueprintBuilder` (fields: `blocks`,
  `environment: EnvironmentSpecification | None`, `local_glyphs`). You construct
  one from the template.
* `domain/blueprint/cascade.py` -- `EnvironmentSpecification`; check its fields so
  you can build it from the template's `environment_variables` only (leave the
  rest at defaults).
* `schemata/jobs.py` -- `Blueprint`, `BlueprintSource`.
* `domain/plugin/manager.py` + `domain/plugin/db.py` (from task 02) -- where the
  install lifecycle and the loop-stashing live; you add the template-ingestion
  call here, on success, after a plugin imports.
* `fiab_core.fable.BlueprintTemplate` (task 01) and the test plugin's `testBasic`
  fixture.
* `tests/integration/test_blueprint.py` + `tests/integration/conftest.py` --
  `testPluginId`, the `/blueprint/list` route shape (`BlueprintListResponse` /
  `BlueprintListItem` with `source`, `display_name`), and how the harness is
  driven.

## Mapping template -> builder

Add a pure helper (suggested: in `domain/blueprint/service.py` or a small new
`domain/blueprint`-level function, wherever the import hierarchy stays clean --
`service.py` already knows both `BlueprintBuilder` and the core types) that turns
a `fiab_core.fable.BlueprintTemplate` into a `BlueprintBuilder`:

* `blocks` -> `builder.blocks` directly (same `dict[BlockInstanceId, BlockInstance]`).
* `template.environment.environment_variables` -> set on a fresh
  `EnvironmentSpecification` (everything else default/None). If
  `template.environment is None`, leave `builder.environment = None`.
* `local_glyphs` -> `builder.local_glyphs` directly.
* `example_values` / `example_glyphs` are **not** copied into the builder here --
  they are guiding-only and used by validation (task 06). In this task they are
  ignored. (Decide where to stash them if you want them retrievable later, but do
  not put them into `configuration_values`; the proposal keeps them separate. The
  minimal correct behaviour for this task is to ignore them.)

Then persist via `upsert_blueprint(builder=builder.model_dump(mode="json"), ...)`,
mirroring `save_builder` in `service.py`.

## Finding the existing blueprint id by (plugin, display_name)

Add a query helper (in `domain/blueprint/db.py`, next to the other blueprint
queries) such as:

```python
async def find_plugin_template_id(*, created_by: str, display_name: str) -> BlueprintId | None:
    # latest non-deleted plugin_template blueprint with this created_by + display_name
```

Use it to decide whether to pass an existing `blueprint_id` (reuse -> new
version) or `None` (fresh insert) to `upsert_blueprint`. Pass an **admin**
`AuthContext` (e.g. `AuthContext(user_id=<plugin id str>, is_admin=True)`) so the
`upsert_blueprint` ownership check passes for the plugin-owned row.

## Wiring into the lifecycle (loop + ordering)

* The ingestion runs in the **updater thread**, after a successful import, using
  the loop stashed on `PluginManager` in task 02:
  `asyncio.run_coroutine_threadsafe(ingest_templates(...), loop).result()`.
  Reuse task 02's pattern; do not invent a new one.
* Ingest **all** templates the plugin exposes (`plugin.blueprint_templates`).
  Iterate deterministically. A failure ingesting one template should be recorded
  (you may reuse the `error`/`template_errors` surfacing from task 02 minimally),
  but in this task there is no validation gate yet -- just insert.
* Do not block the async DB lock for the whole loop; each `upsert_blueprint`
  acquires/releases it per call (it already uses `dbRetry`).

## Tests

* **Unit (minimal):** test the template->builder mapping function purely
  (environment_variables propagated, local_glyphs/blocks preserved,
  example_values not leaked into configuration_values). Optionally a small test of
  `find_plugin_template_id` against an in-memory DB.
* **Integration (one assertion):** the harness installs `fiab-plugin-test`, which
  now ships `testBasic` (task 01). Add an assertion -- extend an existing list
  test or add a small focused one -- that after startup `GET /blueprint/list`
  (as an authenticated non-admin user; the harness has
  `backend_client_with_auth`) returns an item with `source == "plugin_template"`
  and `display_name == "testBasic"`. This proves the template reached the list
  route. Keep it minimal; do not restructure the harness.

  Note on timing: plugin load happens in a background thread on startup. Follow
  whatever readiness/wait approach existing plugin-dependent integration tests
  use (e.g. polling `/plugin/status` or the catalogue) before asserting, so the
  test is not racy.

## Out of scope

* Exclusion (task 04), glyph remapping (task 05), validation-with-examples
  (task 06). Ignore all three here.
* Any change to existing blueprint routes/contracts.

## Definition of done

* Plugin templates are read on (re)install and upserted as `plugin_template`
  blueprints keyed by `display_name`, reusing `upsert_blueprint`.
* `testBasic` from the test plugin appears in `/blueprint/list`.
* Minimal unit tests + one integration assertion; `just val` and `uv run prek`
  pass.
* `core-plugin_assets-03-result_summary.md` written: the mapping helper and
  `find_plugin_template_id` signatures, where the ingestion call sits in the
  lifecycle, and how example_values/glyphs were handled -- tasks 04/05/06 hook
  exclusion/remap/validation into this same ingestion path.
