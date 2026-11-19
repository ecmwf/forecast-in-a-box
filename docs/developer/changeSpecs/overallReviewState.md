# Overall Architecture Review: Current State Hints

## Ruled-out candidates (investigated, NOT breaches)

These were flagged during review and then verified as compliant or intentionally justified.
Documented here so they are not re-investigated:

- **`lens/manager.py` `LensInstance` mutability** -- Intentional and already documented with an
  in-code comment: `process` holds a `subprocess.Popen` whose state is mutated by the OS.
  Guarded by a `threading.Lock`; not a violation of the pyrsistent shared-state rule.
  (The lock-free write of `LensInstance.bound` from the status probe is a separate, still open item.)
- **`utility/config.py` required nested fields** (`PluginSettings.pip_source/module_name`,
  `PluginStoreConfig.url/method`, `ArtifactStoreConfig.url/method`, gateway `*_type`
  discriminators, etc.) -- These are required-by-design (a plugin/store entry is meaningless
  without them; `*_type` are pydantic discriminators that must be required). The backwards-
  compat rule concerns *newly added* fields lacking defaults, which is not the case here.
- **`utility/rsjf/from_pydantic.py` and `utility/rsjf/jsonSchema.py` raw `pydantic.BaseModel`**
  -- Compliant: both are explicitly annotated with `# NOTE ... cant use FiabBaseModel`
  because they require dynamic field handling, exactly as the guideline permits.
- **`utility/rsjf` string annotations and field names** -- the quoted annotations
  (`"FieldSchema"`, `"UISchema"`) are self-references of recursive models and thus necessary;
  the fields named `type`/`format` are mandated by the JSON Schema / RJSF wire format.
- **`utility/concurrency/manager.py` raw `pydantic.BaseModel`** -- only used as the
  `SerializeAsAny[BaseModel]` annotation for heterogeneous component status models; all
  declared models there derive from `FiabBaseModel`.
- **schemata module** -- Only `create_db_and_tables` is declared as a function; no submodules;
  no other functions. Compliant.
- **`fiab-core`** -- No `import forecastbox`; models use `FiabCoreBaseModel`. Compliant.
- **Builtin variable names in backend core** -- No misuse of `id`/`type`/`input` as variable
  names found in `backend/src/forecastbox`.
- **Imports inside functions** -- the only ones are `entrypoint/bootstrap/launchers.py`
  (side-effect import of the app, commented) and `__init__.py`'s `_version` import, both
  justified. The `skinnywms` import in `routes/lens.py` is a guarded module-level optional
  import, not an in-function one. The former hierarchy-breaching in-function imports in
  `domain.plugin` were removed by the template hooks (`domain/plugin/template_hooks.py`).
- **Thread/pool/http-client creation** -- the only `ThreadPoolExecutor`/`threading.Thread`
  instantiations are in `utility/concurrency/manager.py`; the only `httpx.Client`s outside
  `utility/http_pools.py` are the documented bootstrap-check exceptions.
- **Mutable internal dataclasses** -- `utility/concurrency/manager.py::_ThreadRecord` and
  `utility/dispatcher.py::_QueuedEvent`/`_Aggregation` are private, lock-guarded bookkeeping
  records, not data transfer objects; not required to be frozen.
- **db module naming** -- `domain/glyphs/global_db.py` and `domain/lens/metadata_db.py` play the
  role of `db.py` (the guideline says "often a `db.py`"); the name difference is fine.
- **`domain/plugin/detail.py` response classes and `BlueprintBuilder`/`EnvironmentSpecification`**
  -- domain classes used directly in route contracts, but explicitly marked as such, as
  `routes/__init__.py` permits. Unmarked cases are tracked in `backend-leaking_entities.md`.
- **Async functions in domain services** (`domain/run/service.py`, `domain/blueprint/service.py`,
  `domain/experiment/service.py`, `domain/plugin/detail.py`, ...) -- allowed, as long as they
  bridge jobs-DB access via `execution_manager.await_jobs_db` and do not run blocking work
  inline (see the review result for the cases that do).
- **`domain/notification/service.py` holding the event loop** -- explicitly sanctioned by the
  concurrency guideline.

## Known items tracked elsewhere

- Domain/external types in route contracts: `backend-leaking_entities.md`.
- Validation v2 leftovers (expand left, type compliance suite, readiness metadata, ...):
  `backend-validationV2-leftovers.md`.
- Lack of a schema migration mechanism (blocks any schemata column change): `backend-db_migrations.md`.
