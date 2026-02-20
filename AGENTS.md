# Repository and Organization
* this is a monorepo with multiple packages, which combine together to form a single installable python wheel
* the code directories:
  * frontend/ where javascript code is located,
  * backend/ where code for the python backend is located, and which is the final `forecastbox` package whose wheel contains everything
  * backend/packages/* are auxiliary python wheels which are optional or mandatory requirements of the `forecastbox` wheel
* additionally, there are scripts/ and install/ directories, which facilitate getting the wheel installed and configured correctly on target hosts
* lastly, docs/ contains documentation -- currently contains all of end-user docs, developer docs, faqs and troubleshootings
* there is pre-commit configured. Ideally do `uv run prek` before every commit

# Python-Related
* utilize `just` for command running -- `just val` in backend is the "typechecking and testing". Always run this after you make any changes to python code
* project is managed by `uv` -- utilize that for running any python-related subcommands like `uv run pytest` or `uv run ty` for typechecking
* tests are separated into `tests/unit` which are quick to run with mocks, and `tests/integration` which are heavyweight
  * when adding new functionality, try to add both unit tests and integration tests
* always use type annotations, it is enforced
  * when working with a package with bad typing coverage like sqlalchemy, use ty:ignore comment
  * when ty is not powerful enough, use ty:ignore 
  * use typing.cast when the code logic is implicitly erasing the type information
* prioritize using pydantic.BaseModel or dataclasses.dataclass object for capturing contracts and interfaces.
  * ideally keep them plain, stateless, frozen, without functions -- we end up serializing those objects often over to other python processes or different languages
  * for simple immutable data transfer objects, use `@dataclass(frozen=True, eq=True, slots=True)` directly for best type checker support -- provides immutability, hashability, and memory efficiency via slots. We set `eq=True` explicitly, despite being a default, for clarity.
  * a convenience decorator `frozendc` exists in `forecastbox.ecpyutil` but direct decorator syntax is preferred for type safety
* when adding new fields to config.py, make sure they contain defaults -- we need to be backwards compatible wrt users configs
* when adding new fields to database schemata, make sure you explicitly handle migrations -- we need to be backwards compatible wrt users sqlite instances
* use comments sparingly, for non-obvious code only. Add docstrings to functions called from other modules only. When adding docstring, use compact style -- dont separate out Args and Returns, describe everything in one or two paragraphs.

# Frontend
* if you would develop frontend features, consult the `frontend/AGENTS.md`.
