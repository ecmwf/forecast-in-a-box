# Backend Development Guide Misalignments

This document records places where the codebase conflicts with the instructions in
`backend/development.md`. It is intended as a reference for future clean-up work.

---

## 🔴 Package Structure

| Issue | Location |
|---|---|
| `fiab-plugin-anemoi` has no `justfile`, no `pyproject.toml`, and is not listed in the workspace | `backend/pyproject.toml` `[tool.uv.workspace]`; `backend/packages/fiab-plugin-anemoi/` |
| `fiab-plugin-test` has no `justfile` | `backend/packages/fiab-plugin-test/` |

---

## 🔴 Import Hierarchy Violations

The required hierarchy is `utility < schemata < domain < routes < entrypoint`.

### `utility` importing from `schemata`

- `utility/auth.py:14` — `from forecastbox.schemata.user import UserRead`

### `routes` importing from `entrypoint`

- `routes/blueprint.py:44` — `from forecastbox.entrypoint.auth.users import get_auth_context`
- `routes/auth.py:19–20` — `from forecastbox.entrypoint.auth.oidc import oauth_client` / `from forecastbox.entrypoint.auth.users import auth_backend, fastapi_users`
- `routes/experiment.py:31` — `from forecastbox.entrypoint.auth.users import get_auth_context`
- `routes/run.py:39` — `from forecastbox.entrypoint.auth.users import get_auth_context`
- `routes/gateway.py:31` — `from forecastbox.entrypoint.bootstrap.launchers import launch_cascade`
- `routes/admin.py:28` — `from forecastbox.entrypoint.auth.users import current_active_user`

---

## 🟠 Imports Inside Function Bodies

Guide: _"Do not import inside function definitions unless necessitated by runtime."_

- `routes/status.py:42` — `import requests as http_requests` inside `get_status()` — no runtime necessity; also a double violation as an alias
- `domain/run/cascade.py:57` — imports inside `encode_result()` — no runtime necessity

> Note: `entrypoint/bootstrap/launchers.py` also has imports inside functions but these are
> likely justified by circular-import avoidance at runtime — borderline case.

---

## 🟠 Aliased Imports Without Name Collisions

Guide: _"Do not alias imports unless there is a name collision."_

- `import datetime as dt` — used in **11 files**, including:
  `domain/plugin/manager.py:28`, `domain/experiment/service.py:23`, `domain/run/db.py:21`,
  `routes/experiment.py:20`, and others
- `import forecastbox.domain.blueprint.db as blueprint_db` and similar module-level aliases
  throughout `domain/` and `routes/` — used purely for brevity, no collision
- `from fastapi import status as http_status` — `routes/blueprint.py:27`
- `import numpy as np`, `import xarray as xr`, `import earthkit.data as ekd` — `domain/run/cascade.py:19–21`
- `from sqlalchemy import delete as sa_delete` — `domain/experiment/scheduling/db.py:19`
- `from multiprocessing import BaseProcess as Process` — `entrypoint/bootstrap/procs.py:11`

---

## 🟠 Functions Declared in Schemata Files

Guide: _"do not declare any functions in these files, only the ORM classes themselves."_

- `schemata/jobs.py:190` — `create_db_and_tables()`
- `schemata/user.py:66` — `create_db_and_tables()`
- `schemata/user.py:71` — `get_async_session()`
- `schemata/user.py:76` — `get_user_db()`

---

## 🟡 Dataclasses / BaseModels with Methods

Guide: _"ideally keep them plain, stateless, frozen, without functions."_

- `domain/admin.py:42` — `Release` dataclass has a `from_string()` classmethod
- `utility/auth.py:35,43` — `AuthContext` dataclass has `has_admin()` and `allowed()` methods
- `utility/pagination.py:28,32` — `PaginationSpec` has `start()` and `total_pages()` methods
- `routes/gateway.py:41,44` — `GatewayProcess` dataclass has `cleanup()` and `kill()` methods
- `routes/admin.py:59` — `ExposedSettings` BaseModel has a `to_rjsf()` method
- `domain/plugin/store.py:73,98` — `PluginStore` has `fetch()` and `populate()` methods
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
