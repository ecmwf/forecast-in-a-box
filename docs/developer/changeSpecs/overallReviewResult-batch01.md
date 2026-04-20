There are multiple subtasks in this file, each corresponding to fixing a particular style breach.

The subtasks are not related, you can use subagents per task.

There is no behaviour change, thus only syntactic or cosmetic changes to tests are expected. No new tests are expected.

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


