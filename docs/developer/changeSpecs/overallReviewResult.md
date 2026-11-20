# Overall Architecture Review: Results

Review of `backend/src/forecastbox` against `backend/development.md`, at commit `a797ab8e`.

Scope notes:
* items already listed as ruled-out in `overallReviewState.md` are not repeated here,
* the leaking of domain/external types into route contracts is tracked separately in `backend-leaking_entities.md`.
* `backend/packages/*`, `frontend/`, and `cli/` were only consulted where needed for a particular issue.

Each section below is meant to be a self-contained task. Sections are roughly ordered by priority
(correctness/security first, mechanical cleanups last). Line numbers are indicative, as of the commit above.

---

## 1. Domain modules import from `entrypoint`

**Guideline**: "Make sure you don't break importing hierarchies: utility < schemata < domain < routes < entrypoint."

**Breach**:
* `domain/gateway/service.py:37` -- `from forecastbox.entrypoint.bootstrap.config import BACKEND_LOG_DIRECTORY_ENV`
* `domain/lens/manager.py:34` -- same import

Both only need the name of the env var under which the entrypoint exported the log directory
(`entrypoint/bootstrap/config.py::init_logging_base`).

**Fix options**:
* move `BACKEND_LOG_DIRECTORY_ENV` and ideally a small `get_backend_log_directory() -> str` accessor into
  `utility/config.py` next to the other process-wide settings;
  `entrypoint/bootstrap/config.py` then imports it from there,
* verify with `rg "forecastbox\.entrypoint" backend/src/forecastbox/domain` returning nothing.

---

## 2. Domain dependency cycle Run <-> Experiment, and stale domain docstrings

**Guideline**: "the hierarchy within domains must stay acyclic" and "When making any change to a code in a domain,
consult the docstring to see if you need to make a change in the docstring itself."

**Breach**:
* Experiment depends on Run (`domain/experiment/service.py`, `domain/experiment/scheduling/*` import `domain.run.db`,
  `domain.run.service`), as documented in both docstrings.
* Run also imports Experiment: `domain/run/db.py:33` and `domain/run/service.py:42` import
  `ExperimentDefinitionId` from `domain/experiment/types.py`. This is a (type-only) cycle, and the Run docstring
  (`domain/run/__init__.py`) does not mention it.
* Other docstring/import mismatches:
  * `domain/blueprint/display.py:21` imports `domain.artifact.manager.ArtifactManager`, but `domain/blueprint/__init__.py`
    does not list Artifact as a dependency (and `domain/artifact/__init__.py` says "Depended on by Run domain" only).
  * `domain/experiment/__init__.py` states "Depends on the Glyph domain", but no module in `domain/experiment` imports
    `domain.glyphs` (the glyph use is indirect, via Run). Either drop the line or rephrase as indirect.

**Fix options**:
* for the cycle: (a) move the `ExperimentDefinitionId` to `domain/run/types.py`, and explain there it is needed due to the Run database entity requiring a knowledge of experiments.
* update `domain/run/__init__.py`, `domain/blueprint/__init__.py`, `domain/artifact/__init__.py`,
  `domain/experiment/__init__.py` docstrings to match the actual imports. Indirect/transitive dependencies need not be mentioned.

---

## 3. Missing authorization checks

**Guideline**: `db.py` "is always expected to ... enforce authorization"; routes and services pass `AuthContext`
precisely so that ownership is enforced. Several entry points accept an `auth_context` but do not use it, or do not take
one at all.

**Breach**:
* `routes/run.py::get_compilation_detail` (`/run/getCompilationDetail`) -- `auth_context` is unused; the detail is read
  from the in-memory cache by `run_id` only, so any caller can read any Run's compilation detail. Fix: resolve the run
  first via `_resolve_run_record(spec, auth_context)` (which maps `RunNotFound`/`RunAccessDenied`).
* `domain/experiment/service.py::get_next_run` -- `auth_context` is unused; it uses the explicitly unauthenticated
  `experiment_db.get_experiment_definition`. Fix: use `get_schedule(auth_context, experiment_id)` (the scoped lookup)
  as the existence/ownership check. `get_schedule_runs` has the same unauthenticated existence check (it leaks
  existence via 404 vs empty list).
* `routes/lens.py::post_lens_metadata` -- any (non-admin) user can create a `public=True` row, which then becomes
  visible to everyone. The module comment and `domain/lens/metadata_db.py` docstring describe public rows as
  "admin-provided default/template"; the analogous glyph route (`routes/blueprint.py::post_global_glyph`) rejects
  non-admins with 403. Apply the same check.
* `routes/lens.py` -- `/start/skinnyWMS`, `/status`, `/stop`, `/list` take no `auth_context` at all, ie they do not
  even require an authenticated user in a non-passthrough deployment.
* `routes/admin.py::patch_user` (`PATCH /admin/users/{user_id}`) -- takes a raw `update_dict: dict` and writes it into
  `UserTable` via `domain/auth/db.py::patch_user_by_id`, ie an admin request can set any column (`hashed_password`,
  `id`, ...). Replace with a dedicated request contract (ideally to reuse `UserUpdate` as in the `PUT` variant).

---

## 4. Blocking work on the event loop

**Guideline**: "we do not want to block the user-facing async loop for long" and, in `routes/__init__.py`,
"blocking work is submitted to a named `ConcurrentPools` pool via `execution_manager.awaitable_submit` ...; direct calls
are limited to in-memory reads and short lock sections".

**Breach**:
* `domain/blueprint/service.py::validate_expand` (async) awaits only the glyph-bucket DB read, and then runs
  `_validate_expand_with_buckets` directly on the loop. That function calls into every plugin's validation and
  expansion code (qube computations, `resolve_configurations`, ...), which is arbitrary-cost plugin code.
  Used by `routes/blueprint.py` `/create`, `/update`, `/expand`. Fix: submit `validate_expand_sync` (already exists)
  as a single task to `ConcurrentPools.General` via `awaitable_submit` -- it calls the jobs-DB helper directly, which is
  allowed from a pool worker.
* `routes/blueprint.py::resolve_display` calls `domain/blueprint/display.py::configOption2display` directly; it opens and
  queries the thread-local Metkit `ParamDB` (`utility/metkit.py`) on the loop thread. Fix: in the `if paramdb is None`
  branch in the `utility/metkit.py`, in case the caller is in the asyncio loop, do the `ParamDB()` call in the General pool.
  The dependency on concurrency manager here is fine. But extract the return value from the Future and set it to the thread's
  local, so that the next call in the loop thread needs not submit anything.
* `domain/plugin/compatibility.py::get_fiabcore_version` (an `importlib.metadata.version` lookup, ie a filesystem scan)
  is called per request from `routes/blueprint.py::get_blueprint` and `list_blueprints`, and inside the jobs-DB lock in
  `domain/blueprint/db.py::upsert_blueprint`. Handle similarly to the metkit param db -- store the `raw` to thread local,
  and in case it is missing, compute it, in the asyncio case via the General pool.
* lower priority: `routes/admin.py` performs small synchronous file IO on the loop (`get_local_release`, `save_pylock`,
  `mark_release`, `config.save_to_file`) -- run each via the IO pool.

---

## 5. ORM objects materialized outside the session

**Guideline**: "no ORM object may cross the `db.py` module boundary ... materialize everything the caller needs before
the session closes."

**Breach**:
* `utility/db.py::querySingle` returns the raw ORM instance after its session has closed and after the lock has been
  released; callers convert it afterwards. Affected: `domain/run/db.py::get_run`, `get_run_unchecked`;
  `domain/blueprint/db.py::get_blueprint`; `domain/experiment/db.py::get_experiment_definition`;
  `domain/glyphs/global_db.py::get_global_glyph`; `domain/plugin/db.py::get_plugin_state`;
  `domain/experiment/scheduling/db.py::get_experiment_next`, `upsert_experiment_next`.
  It works today only because `expire_on_commit=False` and the tables have no lazy relationships.
  Fix: give `querySingle` a converter parameter (`querySingle(query, session_maker, convert: Callable[[Row], T]) -> T | None`)
  applied inside the session, or inline the session block in each helper as the list helpers already do.
    (note to the architect: have look at some examples prior to prompt -- I dont like the convert)
* `domain/auth/db.py` returns `UserTable` ORM objects (`list_users`, `get_user_by_id`, `update_user_by_id`) which
  `routes/admin.py` returns directly as `UserRead` with `# type: ignore[invalid-return-type]`. Convert to `UserRead`
  (or a plain dataclass) inside the db helper. The users database is a separate concern for locking, but the
  no-ORM-crossing rule applies to all `db.py` modules.
    (note to the architect: check prior to prompt, but probably agreed)
* `domain/experiment/scheduling/db.py::upsert_experiment_next` does a read and a write in two separate lock
  acquisitions (`querySingle`, then `executeAndCommit`/`addAndCommit`), with no business logic in between, so the
  split brings no benefit and opens a race (the `experiment_id` column is unique, so a concurrent insert fails with an
  `IntegrityError`). Make it one locked callable.
    (note to the architect: check prior to prompt, but probably agreed)

---

## 6. Versioned-entity consistency handled outside `db.py`

**Guideline**: `db.py` "is always expected to handle automated version increments when mutating versioned entities,
and to enforce authorization"; `routes/__init__.py`: update requests "must specify version to guarantee consistency".

**Breach**:
* `domain/experiment/db.py::upsert_experiment_definition` has no `expected_version` parameter (unlike
  `upsert_blueprint`). The version check for `/experiment/update` and `/experiment/delete` is done in
  `routes/experiment.py` by a separate read before calling the service -- a time-of-check/time-of-use race.
  `ExperimentVersionConflict` is caught in `routes/experiment.py::update_experiment` but never raised anywhere.
* `domain/experiment/db.py::soft_delete_experiment_definition` and `domain/blueprint/db.py::soft_delete_blueprint` read
  the entity via `get_*` (one lock acquisition) and then `executeAndCommit` the update (another one). For blueprints the
  `expected_version` check is therefore not atomic with the delete.

**Fix options**:
* add `expected_version` to `upsert_experiment_definition` and to the experiment soft-delete, raising
  `ExperimentVersionConflict` inside the locked callable (mirror `upsert_blueprint`); pass it through
  `domain/experiment/service.py::update_schedule`/`delete_schedule`; drop the pre-check in the route,
* fold the soft-delete checks into a single locked callable, or make the `UPDATE` itself conditional (owner and
  max-version in the `WHERE`, check `rowcount`). These are cheap checks, not business logic, so one lock acquisition is
  appropriate here.

---

## 7. Builtin exceptions (and `HTTPException`) instead of domain exceptions

**Guideline**: "we prefer domain-specific exceptions over ValueError everywhere. These exceptions should be translated
into corresponding HTTP status codes in the route modules."

**Breach** (only cases that reach a route or that are part of a domain's public contract; internal assertion-like
`ValueError`s are fine):
* Experiment: `domain/experiment/service.py` raises `ValueError` for an invalid crontab, a stale `first_run_override`,
  and page-out-of-range (caught as `ValueError` in `routes/experiment.py`), and `ExperimentNotFound` for a missing
  *Blueprint* in `create_schedule`. Add eg `InvalidSchedule`, `PageOutOfRange` (or validate paging in the route), and a
  distinct "blueprint not found" error.
* Admin: `domain/admin/__init__.py` raises only `ValueError` and has no `exceptions.py`; `routes/admin.py` does not
  catch them, so eg `POST /admin/release?tag=garbage` (`Release.from_string`) or a GitHub hiccup in
  `get_most_recent_release` results in an unhandled 500.
* Artifact: no `exceptions.py`; `domain/artifact/manager.py` signals "not found" via `KeyError` and "busy" via
  `TimeoutError`, mapped in `routes/artifacts.py`.
* Plugin:
  * `domain/plugin/store.py::resolve_plugin_from_store` raises `ValueError` for unknown store/plugin; uncaught in
    `routes/plugins.py::install_plugin` -> 500 instead of 404. It also contains a bug: `if StoresManager is None` is
    always false -- should be `if StoresManager.stores is None` (currently an uninitialized store map yields an
    `AttributeError`).
  * `domain/plugin/submit.py::submit_uninstall_single` raises `ValueError` for a not-installed plugin; uncaught in
    `routes/plugins.py::uninstall_plugin_endpoint` -> 500. Use `PluginNotFound`.
  * `submit_update_single` / `submit_install_single` return an error *string*, which the routes map to 500 for every
    case -- including "not configured" (should be 404) and "operation not idle" (should be 409/503). Raise
    `PluginNotFound` / `PluginManagerBusy` instead.
  * `submit_unload_single` / `submit_uninstall_single` signal a refused reservation by raising the utility
    `SubmissionRejected`, conflating domain busy-ness with pool saturation; `PluginManagerBusy` exists for this.
  * `domain/plugin/db.py::delete_plugin_state` raises `ValueError` on a missing row.
* Blueprint: `domain/blueprint/display.py::configOption2display` raises `ValueError` for an unparseable type, mapped
  to 404 in `routes/blueprint.py::resolve_display`.
* Lens: `domain/lens/proxy.py:285-287` raises `fastapi.HTTPException` (502/504) from the domain layer; introduce
  `LensUnreachable`/`LensTimeout` in `domain/lens/exceptions.py` and map them in `routes/lens.py::proxy_lens`.
  `domain/lens/manager.py` uses `TimeoutError`/`RuntimeError` for lock timeouts and failed starts.
* Run: `domain/run/db.py::upsert_run` raises `KeyError` for an unknown `run_id`; `domain/run/logs.py::get_run_logs_archive`
  raises `ValueError` (the route pre-checks, so it is currently unreachable).
* `domain/auth/users.py::UserManager.on_after_login` raises `HTTPException` -- tolerable since it is a `fastapi_users`
  hook, but note it if the auth domain gets an `exceptions.py`.

---

## 8. Runtime mutation of the shared config object

**Guideline**: "All concurrently accessed state is declared as pyrsistent structure, reads are lock-free, and the lock
only needs to provide for atomic swap after updates."

**Breach**: `routes/admin.py::update_settings` (`PATCH /admin/settings`) mutates the global `config` in place with
`setattr` on `config.backend`, `config.external`, `config.cascade`, while pool workers and managed threads read the
same objects concurrently (eg `domain/gateway/service.py::launch_gateway`, `domain/artifact/manager.py`,
`domain/lens/manager.py`). Additionally, it assigns `new.model_dump()` values, ie nested settings models are replaced by
plain `dict`s (no `validate_assignment` on `FiabBaseModel`), so subsequent attribute access like
`config.backend.lens.worker_max_requests` would fail with `AttributeError` after a settings update.
The `ExposedSettings` defaults are also bound to the `config` sub-objects at import time.

**Fix options**: build a new validated `FIABConfig` (eg `config.model_copy(update=...)` with validation), persist it,
and either swap a module-level reference atomically, or -- simpler and arguably more honest -- persist only and report
"restart required", as most of these settings are consumed at startup anyway.

---

## 9. Route-level code that belongs elsewhere

**Guideline**: placement rules in "High Level Code Organization and Placement" (domain holds business logic; routes
declare routes and translate exceptions) and "routes: *all* backend routes are declared here".

**Breach**:
* `entrypoint/app.py:104-109` declares a route (`/share/{job_id}/{dataset_id}`) outside `routes/`, using path
  parameters, and linking to `/job/{job_id}/{dataset_id}`, which no longer exists. The frontend does not reference it.
  Most likely dead -- delete it together with `entrypoint/templates/share.html`, or move to `routes/` without path
  params.
* `routes/lens.py:161` (`/proxy/{lens_instance_id}/{upstream_path:path}`) uses path parameters, which
  `routes/__init__.py` allows only in `routes/admin.py`. For a reverse proxy this is likely unavoidable (relative URLs
  emitted by the lens must resolve) -- in that case add it as a second documented exception to the
  `routes/__init__.py` docstring.
* `routes/plugins.py::get_template_example_values` implements template exclusion and glyph remapping of the example
  values; `_pluginId2settings` and `_source2Versions` resolve settings and query the package index. These are plugin
  domain operations (cf. `domain/blueprint/template_ingest.py` which does the same remapping for ingestion) -- move to
  `domain/plugin/service.py` (or a new `domain/plugin/templates.py`) and keep the route to contract mapping.
* `routes/admin.py::get_admin_user` is an auth dependency imported by `routes/artifacts.py` and `routes/plugins.py`
  (route modules importing each other). Move it next to `get_auth_context` in `domain/auth/users.py`.
* `routes/admin.py::update_settings` contains the config-update logic (see section 8) -- move to `utility/config.py`
  or `domain/admin`.

---

## 10. Datetime handling bypassing `utility.time`

**Guideline**: "prefer existing code in `utility` submodules ... don't manually convert `datetime` objects to string
with `strftime`, instead use `utility.time.value_dt2str`, etc."

**Breach**:
* string conversion via `str()`/`isoformat()` instead of `value_dt2str`:
  * `routes/blueprint.py::_row_to_global_response` -- `created_at=str(row.created_at)`, `updated_at=str(row.updated_at)`
    (and the redundant `str()`/`bool()` casts on already-typed record fields),
  * `routes/experiment.py::list_experiment_runs` -- `created_at=str(ex.created_at)`, `updated_at=str(ex.updated_at)`,
  * `domain/experiment/service.py::get_next_run` -- `return str(next_entry.scheduled_at)`,
  * `domain/experiment/scheduling/background.py:76` -- `runnable.scheduled_at.isoformat()`.
  These produce a different format (space separator, microseconds) than the rest of the API, ie this is a client-visible
  inconsistency -- coordinate with the frontend.
* current time / timestamps:
  * `routes/admin.py:89` -- `datetime.now(timezone.utc)` instead of `current_time(...)`,
  * `domain/admin/__init__.py:93` -- `datetime.fromtimestamp(...)` (naive, local tz) instead of
    `utility.time.from_timestamp`,
  * `entrypoint/bootstrap/config.py:30` -- `dt.datetime.now().strftime(...)` for the log directory prefix (low
    priority; a dedicated helper in `utility/time.py` would make it consistent).

---

## 11. Route contracts not materialized as pydantic classes

**Guideline** (`routes/__init__.py`): "the contract is always materialized as a dedicated self-contained pydantic class";
"for enum-like fields, the contract explicitly lists the values". `development.md`: "if an object would cross
language/host boundaries go with pydantic".

**Breach** (types defined in domain/utility modules are covered in `backend-leaking_entities.md`; this is about the
form of the contract):
* `routes/status.py::StatusResponse` and `routes/admin.py::ConfigResponse` are `@dataclass`es.
* `routes/artifacts.py::download_model_endpoint` / `delete_model_endpoint` return ad hoc `dict[str, str | int]` /
  `dict[str, str]` with an implicit `status` enum.
* `routes/gateway.py` and `routes/lens.py::stop_lens`, `routes/experiment.py::get_next_experiment_run` return bare
  strings whose values are effectively enums (`"started"`, `"not managed"`, `"not scheduled currently"`, ...).
* `routes/experiment.py::ExperimentRunDetail.status: str` -- should be a `Literal` (cf. `RunDetailStatus` in
  `routes/run.py`).
* `routes/admin.py` user routes return `HTMLResponse` with prose content for success.

All of these are frontend-visible: coordinate the change with the frontend (keep `/api/v1` per `routes/__init__.py`).

---

## 12. Contract shape conventions for domain entities

**Guideline** (`routes/__init__.py`): "the contract follows encapsulation -- for example, a pair (id, version) is a
subclass, both in request and response"; "the contract semantically distinguishes -- BlueprintId(uuid, int) and
RunId(uuid, int) are two distinct classes"; "every domain entity contains `created_at`, `updated_at`, `user` fields".

**Breach**: no route currently follows the encapsulation rule -- ids and versions are flat fields everywhere
(`routes/blueprint.py::BlueprintDetail`, `BlueprintUpdateRequest`, `BlueprintDeleteRequest`; `routes/run.py::RunDetailResponse`,
`RunRestartRequest`, `RunCreateRequest.blueprint_id/blueprint_version`; `routes/experiment.py::ExperimentDetail`,
`ExperimentUpdateRequest`, ...). The `*Lookup` classes (`BlueprintLookup`, `RunLookup`, `ExperimentLookup`) are a start
but are used only as query-param groups. Owner naming is inconsistent: `user` in Blueprint/Run/Experiment details,
`created_by` in `GlobalGlyphResponse`, `IntrinsicGlyphResponse`, `LensMetadataResponse`; `ExperimentRunDetail` has none.

**Fix**: this is a contract-breaking change, to be done together with the frontend. Either execute it (introduce
`BlueprintRef`, `RunRef`, `ExperimentRef` pydantic classes and nest them) or, if the team decides against it, relax the
guideline in `routes/__init__.py`.

---

## 13. Missing `NewType`s for semantically restricted primitives

**Guideline**: "when using a primitive type in a semantically restricted context, utilize typing.NewType".

**Breach**:
* user ids: `utility/auth.py::AuthContext.user_id: str`, and every `created_by: str` in the db records
  (`domain/run/db.py`, `domain/blueprint/db.py`, `domain/experiment/db.py`, `domain/glyphs/global_db.py`,
  `domain/lens/metadata_db.py`, `domain/experiment/scheduling/job_utils.py`). Note that `created_by` holds either a user id
  or a stringified `PluginCompositeId` (plugin templates), so a `UserId`/`OwnerId` type should capture that.
* cascade job id: `cascade_job_id: str` throughout `domain/run/*` (`db.py`, `service.py`, `stop.py`, `logs.py`,
  `cascade.py`) -- cascade's own `JobId` could be used.
* plugin ids: `plugin_id: str` (stringified `PluginCompositeId`) in `domain/plugin/db.py` and `domain/plugin/events.py`,
  with `PluginCompositeId.to_str/from_str` scattered over routes and domain.
* `BlueprintRecord.parent_id: str | None` and the `parent_id` request fields (presumably a `BlueprintId`),
  `ExperimentNextRecord.experiment_next_id: str`, `lens_id`/`lens_metadata_id: str` in `domain/lens/metadata_db.py`.

---

## 14. Untyped persisted JSON instead of contracts

**Guideline**: "prioritize using pydantic BaseModel or dataclasses.dataclass object for capturing contracts and interfaces".

**Breach**:
* `ExperimentDefinitionRecord.experiment_definition: dict[str, Any]` holds the cron schedule
  (`cron_expr`, `max_acceptable_delay_hours`, `enabled`), and is parsed with `.get(..., default)` in four places:
  `routes/experiment.py::_experiment_to_detail`, `domain/experiment/service.py::_update_schedule_sync`,
  `domain/experiment/scheduling/job_utils.py::experiment2runnable`, `domain/experiment/scheduling/background.py`
  (with a defensive `try/except (TypeError, KeyError)`). Introduce eg `CronScheduleDefinition(FiabBaseModel)` in
  `domain/experiment/types.py`, validate it in `_to_experiment_record` (or in the service), and use it everywhere.
* similarly `RunRecord.outputs` / `compiler_runtime_context` are `dict[str, Any]` and are re-validated into
  `RunOutputs` / `CompilerRuntimeContext` at many call sites (`domain/run/service.py`, `routes/run.py`); and
  `BlueprintRecord.tags: list[dict]` is re-validated into `Tag` in `routes/blueprint.py` and `domain/blueprint/service.py`.
  Converting in `db.py` would remove the repeated `model_validate` + broad `except Exception` blocks.

---

## 15. pydantic vs dataclass choice

**Guideline**: "if an object would cross language/host boundaries go with pydantic to have json serde, otherwise
dataclass"; "use `@dataclass(frozen=True, eq=True, slots=True)`".

**Breach** (low priority):
* dataclasses that cross the HTTP boundary: `domain/artifact/base.py::MlModelOverview`, `MlModelDetail`,
  `domain/admin/__init__.py::Release` (and the two route dataclasses from section 11).
* `FiabBaseModel`s used only in-process: `domain/run/service.py::RunDetail`, `ExecuteResult`;
  `domain/blueprint/service.py::BlueprintSaveResult`, `BlueprintRetrieveResult`, `BlueprintSaveCommand`;
  `domain/lens/manager.py::LensInstanceDetail`; `domain/run/detail.py::TaskDetail`, `CompilationDetail`
  (only stored in the in-memory cache). Not harmful, but contrary to the guideline; `RunDetail` also carries mutable
  `set` fields.
* frozen dataclasses missing the explicit `eq=True`: `utility/http_pools.py::_Registry`,
  `domain/run/compile.py::CompilationResult`.
* `utility/initializer.py::Initializer` is a non-frozen dataclass but is never mutated -- can be frozen.

---

## 16. Docstrings and comments: historical references, stale content, style

**Guideline**: "do not refer to the previous state in the docstring or the comment"; "compact style -- dont separate
out Args and Returns"; "Do not make two spaces after a dot"; AGENTS.md: no fancy unicode, no "instead of" / "rather than"
contrasts.

**Breach**:
* references to a previous state:
  * `domain/blueprint/service.py:13-14,191` -- "(formerly in ``api.blueprint``)",
  * `domain/experiment/service.py:12` -- "previously embedded in route code",
  * `domain/run/compile.py:109` -- "previously a side effect of ``execute_cascade``",
  * `domain/plugin/__init__.py` -- "Now also owns persisted install state",
  * `domain/plugin/state.py` module docstring -- "preserves the existing global failure surface",
  * `utility/concurrency/manager.py:615` -- "instead of each module defining its own alias".
* stale content:
  * `domain/blueprint/service.py` module docstring lists "compiling a stored blueprint to an ExecutionSpecification",
    which lives in `domain/run/compile.py`,
  * `domain/run/db.py::CompilerRuntimeContext` -- "Merged via deep_union into the compiled spec"; `deep_union` is no
    longer used anywhere in `src` (only in `tests/unit/ecpyutil/test_deepunion.py`) -- fix the docstring and consider
    removing `utility/structural.py::deep_union` (and the unused `frozendc`, which its own docstring says not to use),
  * `domain/experiment/scheduling/background.py` module docstring -- "and the lock protecting the schedule tables"; the
    lock is in `runtime.py`,
  * `domain/lens/manager.py::get_status` -- "Raises KeyError", actually raises `NoLensFound`;
    `domain/artifact/manager.py::get_model_details` -- typo "KeyErorr".
* non-compact docstring sections: `domain/run/detail.py::retrieve_compilation_detail` ("Raises / ------"),
  `utility/rsjf/from_pydantic.py`, `utility/rsjf/utils.py` ("Parameters / Returns").
* double space after a dot (find with `rg "\.  [A-Za-z(\`]" backend/src/forecastbox`): `domain/blueprint/service.py`,
  `domain/glyphs/global_db.py`, `domain/glyphs/jinja_interpolation.py`, `domain/glyphs/resolution.py`,
  `domain/plugin/db.py`, `domain/plugin/detail.py`, `domain/run/compile.py`, `domain/run/db.py`,
  `domain/run/service.py`, `routes/blueprint.py`, `utility/auth.py`, `utility/packages.py`, `utility/pagination.py`.
* non-ASCII characters (mostly em dashes and arrows; find with `rg "[^\x00-\x7F]" backend/src/forecastbox`): all
  route module docstrings, `domain/blueprint/service.py`, `domain/glyphs/*`, `domain/lens/manager.py`,
  `domain/run/{compile,detail,service}.py`, `schemata/blueprint.py`.
* trivial bug: `routes/run.py:566` -- `logger.info("will fetch logs for {spec=}")` lacks the `f` prefix.

---

## 17. Typing nits

**Guideline**: "use `ty:ignore` comment"; "do not use annotation-as-string unless necessary".

**Breach** (mechanical, low priority):
* `# type: ignore[...]` is used in ~45 places instead of `ty:ignore` (find with `rg "# type: ignore" backend/src/forecastbox`),
  heaviest in `domain/auth/db.py`, `domain/run/service.py`, `utility/rsjf/from_pydantic.py`, `routes/admin.py`.
  Several of them (`domain/auth/db.py`, `routes/admin.py`) disappear with the fix from section 5.
* `domain/admin/__init__.py:43` -- `-> "Release"` should be `-> Self`.
* `domain/run/service.py::_poll_and_update_once` -- `getattr(execution, "cascade_proc", None)` on a `RunRecord` that
  has the field; use the attribute directly.
* `domain/run/compile.py` imports the private `_fluentName_to_taskId` from `domain/run/detail.py`; make it public or
  move it.
