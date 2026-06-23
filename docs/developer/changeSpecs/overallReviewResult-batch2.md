This document records selected misalignments found between the current codebase and the developer guidelines in `backend/development.md`.
You are a software engineer, and your role is to fix the issues listed in this document.
Do not focus on other issues.

## Task 1: Imports Inside Function Bodies Without Justification

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

## Task 2: Non-Standard Import Aliases

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

**Fix:** For each case above, remove the alias and update all usages to the unaliased name,
unless a genuine name collision can be identified in the same file.

## Task 3: Admin Domain Structural Inconsistency

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

## Conclusion

Make the changes to fix these issues.
Do not attempt to fix other issues.
Then verify the test suite is still passing.
Then make a commit, dont push.

There is a venv ready at `UV_PROJECT_ENVIRONMENT=/tmp/uv/forecast-in-a-box`, do not create a new one.
The binaries `uv` and `just` are also installed.
