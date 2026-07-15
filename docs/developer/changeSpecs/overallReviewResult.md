# Overall Architecture Review Result

This document captures the result of a codebase-wide review of `backend/src/forecastbox`
and `backend/packages/*/src` against the guidelines in `backend/development.md` and the
module docstrings (notably `routes/__init__.py`, `schemata/__init__.py`, and each
`domain/*/__init__.py`).

Each section below is scoped to be actionable as a standalone task. It states the guideline
element it addresses, the files/lines that constitute the breach, and a hint for fixing.
A final section lists candidate issues that were investigated and deliberately **ruled out**
as false positives, so they are not re-chased.

Overall, the backend core is well aligned with the guidelines. The genuine findings cluster
around the `routes` contract rules; the rest are minor or documented technical debt.

---

## Section 1: Route response contracts omit mandatory lifecycle fields

**Guideline:** `routes/__init__.py` docstring -- "the contract is always materialized as a
dedicated self-contained pydantic class, which always contains at a minimum key+version, any
foreign keys, and the created/updated" and "every domain entity contains `created_at`,
`updated_at`, `user` fields".

**Breaches:**
- `backend/src/forecastbox/routes/blueprint.py`
  - `BlueprintGetResponse` (lines ~122-131): has `blueprint_id` + `version` but no
    `created_at`, `updated_at`, or `user`/`created_by`.
  - `BlueprintListItem` (lines ~133-141): exposes `created_by` but no `created_at` /
    `updated_at`.
- `backend/src/forecastbox/routes/experiment.py`
  - `ExperimentDetail` (lines ~81-94): has `created_at` + `created_by` but no `updated_at`,
    despite the entity being versioned (`experiment_version` present).
- `backend/src/forecastbox/routes/run.py`
  - `RunDetailResponse` (lines ~93-106): has `created_at` + `updated_at` but no `user` /
    owner field.

**Fix hint:** Add the missing `created_at` / `updated_at` / owner fields to these response
DTOs, and standardize the owner field name (`created_by` is used in some places, the
guideline calls it `user`). Because these are client-facing contracts, coordinate any
serialized-name change with the frontend (see Section 5 note on `/api/v1` stability).

---

## Section 2: Enum-like route fields typed as bare `str`

**Guideline:** `routes/__init__.py` docstring -- "for enum-like fields, the contract
explicitly lists the values (either as `typing.Literal`, or `enum.Enum` -- the former is
generally preferred)".

**Breaches:**
- `backend/src/forecastbox/routes/run.py`
  - `RunDetailResponse.status: str` (line ~95). The domain already defines the closed set
    `RunStatus = Literal["submitted", "preparing", "running", "completed", "failed"]` in
    `backend/src/forecastbox/schemata/jobs.py:32`.
- `backend/src/forecastbox/routes/blueprint.py`
  - `BlueprintListItem.source: str | None` (line ~139). `BlueprintSource` already exists as
    an enum-like type (used elsewhere, e.g. `domain/blueprint/db.py`), and the sibling filter
    class `BlueprintListFilters.source` is correctly typed `BlueprintSource | None`.

**Fix hint:** Replace the bare `str` with a route-local `typing.Literal` (preferred, to keep
the contract self-contained and decoupled from domain refactors) mirroring the domain enum
values, or reuse the existing enum-like type where the routes docstring already permits direct
domain-type use.

---

## Section 3: Domain classes used directly in route contracts without the required marker

**Guideline:** `routes/__init__.py` docstring -- "there are a few places where classes
declared in the `domain` modules are utilized directly by `routes`. Those are **explicitly
marked** in the code. Do not change those classes. Do not add new such classes unless having a
very good reason." The intent is that each route module declares its own Request/Response
classes for contract stability, and that any deliberate domain-type exposure is annotated.

**Breaches (domain types embedded in route request/response contracts with no marker
comment):**
- `backend/src/forecastbox/routes/blueprint.py`: `BlueprintBuilder`,
  `BlueprintValidationExpansion`, `SerializedBlockExpansion`, `Tag` (imported from
  `domain.blueprint.service`) are used directly in the request/response classes (e.g.
  `BlueprintCreateRequest.builder`, `BlueprintGetResponse.builder`).
- `backend/src/forecastbox/routes/experiment.py`: `ExperimentDefinition` / related domain
  types surfaced in the create/detail/runs contracts.
- `backend/src/forecastbox/routes/run.py`: `TaskId`, `BlockInstanceId` from the domain/fiab
  layer surfaced directly (e.g. `RunOutputsResponse.outputs`,
  `RunDetailResponse.completed_block_ids`).
- `backend/src/forecastbox/routes/plugins.py`: `PluginListing`, `PluginCompositeId`,
  `PluginSettings`, `BlockInstanceId`, `ConfigurationOptionId` returned/consumed directly.
- `backend/src/forecastbox/routes/artifacts.py`: `MlModelOverview`, `MlModelDetail`,
  `CompositeArtifactId` used directly in route signatures.
- `backend/src/forecastbox/routes/admin.py`: `Release`, `UserRead`, `UserUpdate` used
  directly (note: some of these -- `UserRead`/`UserUpdate` from fastapi-users -- may be
  legitimately exposed, but are still unmarked).

**Fix hint:** For each intentional exposure, add a short explicit comment at the field/class
(e.g. `# domain type exposed intentionally: BlueprintBuilder is the shared build contract`).
Where the exposure is incidental, introduce a route-local DTO wrapper. This is primarily a
documentation/marking gap rather than a functional bug; prioritize marking over rewriting to
avoid destabilizing existing clients. Treat this as an audit-and-annotate task per route
module.

---

## Section 4: Plugin -> Blueprint circular dependency implemented via in-function imports

**Guideline:** `backend/development.md` -- "all imports belong to top level of the file, dont
import inside function definitions unless necessitated by runtime". Also the import-hierarchy
rules and the documented (temporary) circularity between the `plugin` and `blueprint` domains.

**Breach:**
- `backend/src/forecastbox/domain/plugin/manager.py`
  - Lines ~129-136 and ~377: `from forecastbox.domain.blueprint.db import ...`,
    `from forecastbox.domain.blueprint.service import ...`, `from forecastbox.utility.auth
    import AuthContext`, and `from forecastbox.domain.blueprint.db import
    soft_delete_all_plugin_templates` are imported **inside functions**.

**Context / status:** This is the runtime workaround for the documented circular dependency
(`domain/plugin/__init__.py` and `domain/blueprint/__init__.py` both note: "This will be fixed
later by refactoring into events"). The in-function import of `AuthContext` from
`utility.auth`, however, is *not* part of the circularity and could be safely hoisted to module
top level now.

**Fix hint:** Short term -- hoist the `utility.auth` import to top level (no cycle there).
Long term -- resolve the plugin<->blueprint cycle via the planned event-based refactor so the
in-function `blueprint` imports can be hoisted. Track under the same effort as the documented
circularity note.

---

## Section 5: Minor -- mutable literal defaults on a pydantic contract

**Guideline:** `backend/development.md` -- prefer plain, stateless, frozen data objects;
general good-practice for default collections.

**Breach:**
- `backend/src/forecastbox/domain/plugin/store.py` (lines ~67-70): `PluginStore` declares
  `plugins: dict[...] = {}` and `remote: dict[...] = {}` using bare mutable literals.

**Context:** Pydantic deep-copies mutable defaults per instance, so this is **not** a
shared-mutable-default bug; it is a style/consistency nit only.

**Fix hint:** Use `pydantic.Field(default_factory=dict)` for clarity and consistency with the
codebase's data-oriented conventions. Low priority.

---

## Section 6: Minor -- plugin (ecmwf) general-rule nits

**Guideline:** `backend/development.md` -- top-level imports; never use builtins as variable
names.

**Breaches:**
- `backend/packages/fiab-plugin-ecmwf/src/fiab_plugin_ecmwf/anemoi/utils.py` (lines ~198-199):
  `from fiab_core.tools.plugins import _detect_editable_install` imported inside a function.
  Hoist to module scope unless a runtime-only need is proven (and if so, add a comment).
- `backend/packages/fiab-plugin-ecmwf/src/fiab_plugin_ecmwf/runtime/plots.py` (lines ~71-77):
  parameter named `format` shadows the `format` builtin. Rename to `fmt` (or similar).

**Fix hint:** Straightforward local edits. Low priority; these are in a runtime plugin, not
the backend core.

---

## Ruled-out candidates (investigated, NOT breaches)

These were flagged during review and then verified as compliant or intentionally justified.
Documented here so they are not re-investigated:

- **`lens/manager.py` `LensInstance` mutability** -- Intentional and already documented with an
  in-code comment: `process` holds a `subprocess.Popen` whose state is mutated by the OS.
  Guarded by a `threading.Lock`; not a violation of the pyrsistent shared-state rule.
- **`utility/config.py` required nested fields** (`PluginSettings.pip_source/module_name`,
  `PluginStoreConfig.url/method`, `ArtifactStoreConfig.url/method`, gateway `*_type`
  discriminators, etc.) -- These are required-by-design (a plugin/store entry is meaningless
  without them; `*_type` are pydantic discriminators that must be required). The backwards-
  compat rule concerns *newly added* fields lacking defaults, which is not the case here.
- **`utility/rsjf/from_pydantic.py` and `utility/rsjf/jsonSchema.py` raw `pydantic.BaseModel`**
  -- Compliant: both are explicitly annotated with `# NOTE ... cant use FiabBaseModel`
  because they require dynamic field handling, exactly as the guideline permits.
- **schemata module** -- Only `create_db_and_tables` is declared as a function; no submodules;
  no other functions. Compliant.
- **DB access / concurrency** -- All domain `db.py`/`global_db.py` route access through the
  `utility/db.py` async `lock` helpers; background threads (`run/background.py`,
  `plugin/manager.py`, `plugin/store.py`, `artifact/manager.py`, `lens/manager.py`) submit DB
  work to the event loop and use `pyrsistent` structures with lock-protected swaps for shared
  state. Compliant.
- **`fiab-core`** -- No `import forecastbox`; models use `FiabCoreBaseModel`. Compliant.
- **Builtin variable names in backend core** -- No misuse of `id`/`type`/`input` as variable
  names found in `backend/src/forecastbox`.
