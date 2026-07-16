# Overall Architecture Review: Current State Hints

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
- **hierarchy-breaching imports inside functions in domain.plugin** -- as documented, this is
  a known issue and will require high level effort first to be overcome
