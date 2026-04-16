# Backend Development Guide Misalignments

This document records places where the codebase conflicts with the instructions in
`backend/development.md`. It is intended as a reference for future clean-up work.

## 🟡 Dataclasses / BaseModels with Methods

Guide: _"ideally keep them plain, stateless, frozen, without functions."_

- `domain/admin.py:42` — `Release` dataclass has a `from_string()` classmethod
- `utility/auth.py:35,43` — `AuthContext` dataclass has `has_admin()` and `allowed()` methods
- `utility/pagination.py:28,32` — `PaginationSpec` has `start()` and `total_pages()` methods
! - `routes/gateway.py:41,44` — `GatewayProcess` dataclass has `cleanup()` and `kill()` methods
- `routes/admin.py:59` — `ExposedSettings` BaseModel has a `to_rjsf()` method
! - `domain/plugin/store.py:73,98` — `PluginStore` has `fetch()` and `populate()` methods
- `utility/config.py` — multiple `BaseSettings` subclasses have validation/conversion methods
  (`validate_runtime`, `pass_to_secret`, `local_url`, `save_to_file`, etc.)
- `utility/rsjf/forms.py:60,71,80` — `FormDefinition` has `export_jsonschema()`, `export_uischema()`, `export_all()`
- `utility/rsjf/jsonSchema.py:41` — `BaseSchema` has `update()`
- `utility/rsjf/uiSchema.py:73` — `UIField` has `export_with_prefix()`

---

## 🟡 No `typing.NewType` Usage

Guide: _"when using a primitive type in a semantically restricted context, utilize `typing.NewType`."_

There are zero `NewType` declarations in the entire codebase. IDs are typed as plain `str`
throughout — e.g. `run_id: str`, `blueprint_id: str`, `experiment_id: str` — across
`domain/*/db.py`, `routes/*.py`, and service files.
