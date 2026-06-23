# Codebase Review Against backend/development.md

This document records misalignments found between the current codebase and the
developer guidelines in `backend/development.md`. Each section is a self-contained
task suitable for a developer or agent.

---

## Task 1: Complete Dataclass Decorator Arguments

**Guideline reference:**
> for simple immutable data transfer objects, use `@dataclass(frozen=True, eq=True, slots=True)`
> directly for best type checker support -- provides immutability, hashability, and memory
> efficiency via slots. We set `eq=True` explicitly, despite being a default, for clarity.

Several dataclasses use incomplete decorator arguments. The cases split into two sub-groups:

### 1a. Fully mutable dataclasses that should be frozen

These hold only plain value types and should be made fully frozen:

- `backend/packages/fiab-plugin-ecmwf/src/fiab_plugin_ecmwf/datasets/__init__.py:10`
  `@dataclass(frozen=True)` -- missing `eq=True, slots=True`
- `backend/src/forecastbox/domain/glyphs/jinja_interpolation.py:77`
  `@dataclass(frozen=True)` -- missing `eq=True, slots=True`
- `backend/src/forecastbox/utility/pagination.py:22`
  `@dataclass(frozen=True)` -- missing `eq=True, slots=True`
- `backend/src/forecastbox/utility/tunnel.py:94` and `:109`
  `@dataclass(frozen=True, slots=True)` -- missing `eq=True` (the guideline requires explicit
  `eq=True` for clarity even though it is the default)
- `backend/packages/fiab-core/src/fiab_core/artifacts.py:106`
  `ArtifactResolved` uses bare `@dataclass` -- missing `frozen=True, eq=True, slots=True`
- `backend/src/forecastbox/domain/artifact/compatibility.py:11`
  `PlatformInfo` uses bare `@dataclass` -- missing `frozen=True, eq=True, slots=True`

**Fix:** Change each decorator to `@dataclass(frozen=True, eq=True, slots=True)`. For
`PlatformInfo`, verify nothing mutates the fields after construction (nothing does in the
current code).

### 1b. Dataclasses with mutable fields -- frozen is not straightforwardly applicable

These hold mutable fields and therefore cannot be literally frozen without first
converting those fields to immutable equivalents:

- `backend/src/forecastbox/domain/lens/manager.py:50`
  `LensInstance` uses bare `@dataclass`. Fields: `process: subprocess.Popen | None`,
  `lens_params: dict[str, Any]`, `ports: set[int]`. The `set` and `dict` can be replaced
  with `frozenset` / `tuple` or a pyrsistent map to enable `frozen=True`.
- `backend/src/forecastbox/entrypoint/bootstrap/procs.py:18`
  `ChildProcessGroup` uses bare `@dataclass`. Field: `procs: list[BaseProcess]`. Consider
  changing to `tuple[BaseProcess, ...]` to allow `frozen=True`.

**Fix options:** Either convert mutable fields to their immutable equivalents and add the
full decorator, or add a comment explicitly documenting why the class is intentionally
mutable and cannot comply.

---

## Task 2: Imports Inside Function Bodies Without Justification

**Guideline reference:**
> all imports belong to top level of the file, dont import inside function definitions
> unless necessiated by runtime.

The following files contain imports inside function bodies with no comment justifying
runtime necessity:

- `backend/src/forecastbox/entrypoint/app.py:118`
  `from starlette.responses import JSONResponse` inside the `circumvent_auth` middleware
  function. The surrounding comment reads "TODO this is a hotfix" -- this does not
  constitute a runtime justification. The import should be moved to the top of the file.

- `backend/packages/fiab-plugin-ecmwf/src/fiab_plugin_ecmwf/anemoi/utils.py:30`
  `from earthkit.data.utils.dates import to_timedelta` inside `_timestep_seconds`. No
  justification comment. Move to top-level unless there is a concrete import-time side-effect
  or optional-dependency reason; if so, add a comment.

- `backend/packages/fiab-plugin-ecmwf/src/fiab_plugin_ecmwf/runtime/plots.py:32`
  `from earthkit.plots.schemas import schema` inside `_configure_schema`. `earthkit.plots`
  is an optional dependency whose top-level import is guarded by `TYPE_CHECKING`, but the
  runtime import inside the function is not commented.

- `backend/packages/fiab-plugin-ecmwf/src/fiab_plugin_ecmwf/runtime/plots.py:80-82`
  Three `earthkit.plots` imports inside `_plot_fields`. Same situation as above.

**Fix:** For each violation, either move the import to the top of the file, or -- if the
import is genuinely deferred because the dependency is optional and importing at module
level would fail -- add a short comment explaining why (following the established pattern
in `entrypoint/bootstrap/launchers.py:46`: "import inside function justified due to side
effects").

---

## Task 3: Non-Standard Import Aliases

**Guideline reference:**
> dont alias in imports unless there is a name collision, or unless its a standard shortcut:
> `datetime as dt`, `multiprocessing as mp`, `numpy as np`, `xarray as xr`

The following aliases are neither listed standard shortcuts nor unambiguous collision
avoidances:

- `backend/src/forecastbox/domain/glyphs/jinja_interpolation.py:28`
  `from jinja2 import nodes as jnodes` -- `nodes` does not collide with any local name.
  Import as `nodes` and qualify usages as `nodes.X`.

- `backend/src/forecastbox/domain/run/detail.py:18-19`
  `from forecastbox.utility.memcache import get as memcache_get`
  `from forecastbox.utility.memcache import insert as memcache_insert`
  `get` and `insert` are not Python builtins; the aliases add redundant module-name
  prefix. Import the names directly.

- `backend/packages/fiab-plugin-ecmwf/src/fiab_plugin_ecmwf/blocks.py:30`
  `from fiab_core.tools.blocks import BlockInstanceRich as BlockInstance`
  Same line in `anemoi/blocks.py:27`. This renames the class to a shorter form rather
  than resolving a collision. Use the canonical name `BlockInstanceRich` throughout.

- `backend/packages/fiab-plugin-ecmwf/src/fiab_plugin_ecmwf/runtime/plots.py:15`
  `import earthkit.data as ekd` -- `ekd` is not a listed standard shortcut. Use the full
  module path or a clearly justified alias.

**Fix:** For each case above, remove the alias and update all usages to the unaliased name,
unless a genuine name collision can be identified in the same file.

---

## Task 4: Admin Domain Structural Inconsistency

**Guideline reference:**
> domain: ... Consult each domain's docstring in `__init__.py` to understand its role.
> When making *any* change to a code in a domain, consult the docstring to see if you
> need to make a change in the docstring itself.

All business domains under `domain/` are Python packages (directories with `__init__.py`):
`artifact`, `auth`, `blueprint`, `experiment`, `gateway`, `glyphs`, `lens`, `plugin`, `run`.
The `admin` domain, however, is a single flat module file:

- `backend/src/forecastbox/domain/admin.py`

This breaks the uniform structure expected by the guideline: there is no `__init__.py`
to carry the domain docstring, no natural place to add sub-modules if the domain grows,
and the tooling convention (consult `__init__.py`) does not apply.

**Fix:** Convert `admin.py` into a package:
1. Create `backend/src/forecastbox/domain/admin/` directory.
2. Move the contents of `admin.py` into `admin/__init__.py`.
3. Ensure all existing imports (`from forecastbox.domain.admin import ...`) continue to
   work -- since the package `__init__.py` re-exports the same names this is transparent
   to callers.

---

## Task 5: Known Pyrsistent Gap in PluginsStatus

**Guideline reference:**
> multiple state structures are updated via the background threads, but consumed by the
> async loop -- to achieve synchronization, we rely on immutable data structures from the
> `pyrsistent` package.

The `PluginsStatus` Pydantic response model in
`backend/src/forecastbox/domain/plugin/manager.py:184-190` uses plain `dict` fields:

```
plugin_errors: dict[PluginCompositeId, str]
plugin_versions: dict[PluginCompositeId, str]
plugin_updatedatetime: dict[PluginCompositeId, str]
```

A `TODO` comment acknowledges this: "Change these fields to use pyrsistent types (PMap)
instead of dict once we solve pydantic serialization". The underlying `PluginManager`
class fields correctly use `PMap`, but the snapshot is converted to `dict` when building
the status response, creating a window where a freshly-built dict may be partially-stale
relative to a concurrent update.

**Fix options:**
1. Snapshot the `PMap` values under the existing `PluginManager.lock` when constructing
   `PluginsStatus`, converting to `dict` only for the Pydantic model (which happens after
   the lock is released). This is already safe as long as the snapshot is taken atomically
   inside a single `timed_acquire` block -- verify that `status_full()` does this.
2. If the pydantic serialization issue is resolved in the future, switch the fields to
   `PMap` directly and remove the TODO.

---

## Task 6: Pydantic BaseModel Used Directly Without Comment (utility/rsjf)

**Guideline reference:**
> when using pydantic, use `FiabBaseModel` from `forecastbox.utility.pydantic` ... instead
> of `pydantic.BaseModel` directly, unless the model requires dynamic field handling
> (e.g., `extra="allow"` for JSON Schema types). ... If you need the dynamic model
> handling, mark it clearly with a comment.

- `backend/src/forecastbox/utility/rsjf/jsonSchema.py:20`
  `class BaseSchema(BaseModel):` with the comment `# NOTE we need dynamicity, cant use
  FiabBaseModel` -- the comment exists and is correctly placed. This is **compliant** and
  serves as the reference pattern for other files.

No other `pydantic.BaseModel` direct uses were found in the main backend without a
justifying comment. This task is a **verification reminder**: any future `BaseModel`
direct use must include an equivalent comment. The rsjf module is the canonical example.

No code changes are required for this task; it exists to document the current state and
set the baseline for reviewers.
