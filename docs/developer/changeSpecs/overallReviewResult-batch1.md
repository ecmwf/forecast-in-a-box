This document records selected misalignments found between the current codebase and the developer guidelines in `backend/development.md`.
You are a software engineer, and your role is to fix the issues listed in this document.
Do not focus on other issues.

# Complete Dataclass Decorator Arguments

**Guideline reference:**
> for simple immutable data transfer objects, use `@dataclass(frozen=True, eq=True, slots=True)`
> directly for best type checker support -- provides immutability, hashability, and memory
> efficiency via slots. We set `eq=True` explicitly, despite being a default, for clarity.

Several dataclasses use incomplete decorator arguments. The cases split into two sub-groups:

## Fully mutable dataclasses that should be frozen

- `backend/packages/fiab-plugin-ecmwf/src/fiab_plugin_ecmwf/datasets/__init__.py:10`
  `@dataclass(frozen=True)` -- missing `eq=True, slots=True`
- `backend/src/forecastbox/domain/glyphs/jinja_interpolation.py:77`
  `@dataclass(frozen=True)` -- missing `eq=True, slots=True`
- `backend/src/forecastbox/utility/pagination.py:22`
  `@dataclass(frozen=True)` -- missing `eq=True, slots=True`
- `backend/src/forecastbox/utility/tunnel.py:94` and `:109`
  `@dataclass(frozen=True, slots=True)` -- missing `eq=True` (the guideline requires explicit
  `eq=True` for clarity even though it is the default)
- `backend/src/forecastbox/domain/artifact/compatibility.py:11`
  `PlatformInfo` uses bare `@dataclass` -- missing `frozen=True, eq=True, slots=True`

**Fix:** Change each decorator to `@dataclass(frozen=True, eq=True, slots=True)`. For
`PlatformInfo`, verify nothing mutates the fields after construction (nothing does in the
current code).

## Dataclasses with mutable fields -- frozen is not straightforwardly applicable

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

## Conclusion

Make the changes to fix these issues.
Do not attempt to fix other issues.
Then verify the test suite is still passing.
Then make a commit, dont push.

There is a venv ready at `UV_PROJECT_ENVIRONMENT=/tmp/uv/forecast-in-a-box`, do not create a new one.
The binaries `uv` and `just` are also installed.
