# Overall Codebase Review — Alignment with `backend/development.md`

This document records all identified misalignments between the codebase and the guidelines in
`backend/development.md`. Each section is self-contained and can be handed to a developer or
agent as an independent task.

---

## Section 1 — Route files: `PREFIX` constant declared before imports

**Guideline reference**: _General Code Guidelines_ — "all imports belong to top level of the file"

The conventional Python file order is: module docstring → imports → code. In every route file
the `PREFIX` constant is declared on the line immediately after the docstring, **before** the
import block. This is a cosmetic but consistent violation of the convention that imports come
first, and can confuse static-analysis tools.

**Affected files and lines**

| File | Line |
|------|------|
| `backend/src/forecastbox/routes/run.py` | 18 |
| `backend/src/forecastbox/routes/blueprint.py` | 22 |
| `backend/src/forecastbox/routes/admin.py` | 16 |
| `backend/src/forecastbox/routes/artifacts.py` | 16 |
| `backend/src/forecastbox/routes/auth.py` | 16 |
| `backend/src/forecastbox/routes/experiment.py` | 19 |
| `backend/src/forecastbox/routes/gateway.py` | 15 |
| `backend/src/forecastbox/routes/plugins.py` | 17 |
| `backend/src/forecastbox/routes/status.py` | 12 |

**Hint**: Move each `PREFIX = "..."` line to after the import block (after all `import` /
`from … import` statements) in every affected file.

---

## Section 2 — Import inside function body without runtime necessity

**Guideline reference**: _General Code Guidelines_ — "all imports belong to top level of the
file, dont import inside function definitions unless necessiated by runtime"

Two functions in `fiab-plugin-test` import standard-library modules inside the function body
with no documented runtime justification.

**Affected files and lines**

| File | Line | Import |
|------|------|--------|
| `backend/packages/fiab-plugin-test/src/fiab_plugin_test/runtime.py` | 9 | `import time` inside `source_sleep()` |
| `backend/packages/fiab-plugin-test/src/fiab_plugin_test/runtime.py` | 28 | `import pathlib` inside `sink_file()` |

> Note: `entrypoint/bootstrap/launchers.py:49` (`import forecastbox.entrypoint.app`) and
> `domain/run/cascade.py:56` (`from earthkit.plots import Figure`) both carry inline comments
> explicitly justifying why the import must stay inside the function. Those are acceptable.

**Hint**: Move `import time` and `import pathlib` to the top of the file.

---

## Section 3 — Missing type annotations in package code

**Guideline reference**: _General Code Guidelines_ — "always use type annotations — it is enforced"

Several function parameters in the packages lack type annotations.

**Affected files and locations**

| File | Function / line | Missing annotation |
|------|-----------------|--------------------|
| `backend/packages/fiab-core/src/fiab_core/fable.py` | `PluginCompositeId.from_str`, line 62 | Parameter `v` has no type; should be `str` |
| `backend/packages/fiab-plugin-ecmwf/src/fiab_plugin_ecmwf/runtime/sinks.py` | `write_zarr`, line 1 | Parameter `fieldlist` has no type; should be typed (e.g. `earthkit.data.FieldList` or a suitable protocol) |
| `backend/packages/fiab-plugin-test/src/fiab_plugin_test/runtime.py` | `sink_file`, line 27 | Parameter `data` has no type; could be `object` if truly unconstrained, or a concrete type |

**Hint**: Add annotations to each untyped parameter. Use `ty:ignore` only if the type checker
cannot resolve the annotation; prefer a concrete or protocol-based type where possible.

---

## Section 4 — `NewType` not used for semantically restricted IDs in `fiab-core`

**Guideline reference**: _General Code Guidelines_ — "when using a primitive type in a
semantically restricted context, utilize `typing.NewType`"

In `fiab-core`, several names that serve as distinct domain identifiers are defined as plain
`str` type aliases (`X = str`) rather than `NewType`. This means the type checker cannot
distinguish a `PluginId` from an `ArtifactStoreId`, defeating the purpose of strong typing.

**Affected files and lines**

| File | Lines | Identifiers |
|------|-------|-------------|
| `backend/packages/fiab-core/src/fiab_core/artifacts.py` | 24–25 | `MlModelCheckpointId = str`, `ArtifactStoreId = str` |
| `backend/packages/fiab-core/src/fiab_core/fable.py` | 50–53 | `BlockFactoryId = str`, `BlockInstanceId = str`, `PluginId = str`, `PluginStoreId = str` |

**Hint**: Replace plain aliases with `NewType`:

```python
# Before
MlModelCheckpointId = str

# After
import typing
MlModelCheckpointId = typing.NewType("MlModelCheckpointId", str)
```

Propagate through all usages in the codebase; the `str` base means callsites that pass plain
strings still type-check after an explicit `MlModelCheckpointId(...)` call.

---

## Section 5 — `Plugin` dataclass missing `frozen=True, eq=True, slots=True`

**Guideline reference**: _General Code Guidelines_ — "for simple immutable data transfer
objects, use `@dataclass(frozen=True, eq=True, slots=True)`"

`Plugin` in `fiab-core` carries four callable fields (`catalogue`, `validator`, `expander`,
`compiler`). These are assigned once at plugin load time and never mutated. The bare `@dataclass`
decorator omits the recommended options, making instances mutable and unhashable, and using more
memory than a slotted class.

**Affected file and line**

| File | Line |
|------|------|
| `backend/packages/fiab-core/src/fiab_core/plugin.py` | 42 |

```python
# Current
@dataclass
class Plugin:

# Target
@dataclass(frozen=True, eq=True, slots=True)
class Plugin:
```

**Hint**: Verify that no code mutates a `Plugin` instance after creation (a grep for
`plugin.catalogue =`, `plugin.validator =`, etc. should return nothing). If subclassing is
needed, `slots=True` may need to be applied to the subclass as well.

---

## Section 6 — `ANN` type-annotation linting not enabled in sub-package `pyproject.toml` files

**Guideline reference**: _General Code Guidelines_ — "always use type annotations — it is
enforced"

The main `backend/pyproject.toml` selects `["I", "ANN"]` ruff rules to enforce type
annotations. All four sub-packages select only `["I"]`, so missing annotations in those packages
are never caught by CI.

**Affected files**

| File | Relevant lines |
|------|----------------|
| `backend/packages/fiab-core/pyproject.toml` | `lint.select = [ "I" ]` |
| `backend/packages/fiab-mcp-server/pyproject.toml` | `lint.select = [ "I" ]` |
| `backend/packages/fiab-plugin-ecmwf/pyproject.toml` | `lint.select = [ "I" ]` |
| `backend/packages/fiab-plugin-test/pyproject.toml` | `lint.select = [ "I" ]` |

**Hint**: Add `"ANN"` to `lint.select` and `"ANN401"` to `lint.ignore` (to allow `Any`) in all
four files, matching the main backend config:

```toml
lint.select = ["I", "ANN"]
lint.ignore = ["E731", "ANN401"]
```

After enabling, fix any newly surfaced annotation errors (primarily covered by Sections 3 and 5
above).

---

## Section 7 — Import hierarchy violation: `routes` imports from `entrypoint`

**Guideline reference**: _High Level Code Organization_ — "Make sure you don't break importing
hierarchies: utility < schemata < domain < routes < entrypoint"

`routes/gateway.py` imports `launch_cascade` from `forecastbox.entrypoint.bootstrap.launchers`.
Routes must not depend on entrypoint; the hierarchy explicitly forbids this direction.

**Affected file and line**

| File | Line | Import |
|------|------|--------|
| `backend/src/forecastbox/routes/gateway.py` | 31 | `from forecastbox.entrypoint.bootstrap.launchers import launch_cascade` |

**Hint**: Move the `launch_cascade` function (or an appropriate subset of its logic) out of
`entrypoint` and into a lower layer — either `utility` or a dedicated `domain` module — so
that `routes/gateway.py` can import it without crossing the hierarchy boundary. An alternative
is to pass the function as a dependency/callable injected at startup, keeping `routes` free of
any entrypoint import.

---

## Section 8 — Path parameters used in admin routes

**Guideline reference**: `routes/__init__.py` docstring — "we never use path parameters in
routes — to prevent misrouting, long url trimming and normalization, etc"

Four admin route handlers accept `{user_id}` as a URL path segment.

**Affected file and lines**

| File | Line | Route |
|------|------|-------|
| `backend/src/forecastbox/routes/admin.py` | 147 | `@router.get("/users/{user_id}", …)` |
| `backend/src/forecastbox/routes/admin.py` | 158 | `@router.delete("/users/{user_id}", …)` |
| `backend/src/forecastbox/routes/admin.py` | 171 | `@router.put("/users/{user_id}", …)` |
| `backend/src/forecastbox/routes/admin.py` | 189 | `@router.patch("/users/{user_id}", …)` |

**Hint**: Replace path parameters with query parameters or a request body. For example:

```python
# Before
@router.get("/users/{user_id}", …)
async def get_user(user_id: UUID4, …):

# After
@router.get("/users/get", …)
async def get_user(user_id: UUID4, …):
```

This is a breaking API change; coordinate with any existing clients.

---

## Section 9 — Non-ORM classes declared in `schemata/user.py`

**Guideline reference**: _High Level Code Organization_ — "do not declare any functions in
these files, only the ORM classes themselves, and the function related to discovery:
`create_db_and_tables`"

`schemata/user.py` defines three pydantic request/response schemas (`UserRead`, `UserCreate`,
`UserUpdate`) alongside the ORM classes. These are not ORM classes; the guideline restricts
schemata files to ORM declarations only.

**Affected file and lines**

| File | Lines | Classes |
|------|-------|---------|
| `backend/src/forecastbox/schemata/user.py` | 25–33 | `UserRead`, `UserCreate`, `UserUpdate` |

**Hint**: Move `UserRead`, `UserCreate`, `UserUpdate` to the appropriate domain module (e.g.
`domain/auth/users.py` already imports from `schemata.user`, so it is a natural home) or to
`routes/auth.py` if they are purely a route contract. Update all import sites accordingly.
Note this is a refactor touching multiple files; verify that `fastapi_users` integration still
works after the move.

---

## Section 10 — Direct database session access in `routes/admin.py` bypasses the db lock

**Guideline reference**: _Concurrency Considerations_ — "When doing database access, you *must*
respect this lock, as all existing `db.py` submodules across domains do"

All domain `db.py` modules funnel writes through `dbRetry` (and reads through `querySingle` /
`dbRetry`), which internally acquires the `utility/db.py` async lock. The admin routes access
the user database by opening sessions directly from `schemata.user.async_session_maker` without
the lock, creating a potential concurrent-write race for the user SQLite file.

**Affected file and lines**

| File | Lines | Operation |
|------|-------|-----------|
| `backend/src/forecastbox/routes/admin.py` | 142–144 | `async with async_session_maker() as session:` (list users) |
| `backend/src/forecastbox/routes/admin.py` | 150–155 | direct session (get user) |
| `backend/src/forecastbox/routes/admin.py` | 161–164 | direct session (delete user) |
| `backend/src/forecastbox/routes/admin.py` | 174–184 | direct session (update user) |
| `backend/src/forecastbox/routes/admin.py` | 191–194 | direct session (patch user) |

**Hint**: Extract these operations into a `domain/auth/db.py` (or extend the existing
`domain/auth/users.py`) and wrap them with `dbRetry` from `utility/db.py`, as done in all
other domain db modules. The user and jobs databases are separate SQLite files, so a single
shared lock is conservative but consistent with the stated policy.

---

*Review performed by GitHub Copilot — 2026-04-17*
