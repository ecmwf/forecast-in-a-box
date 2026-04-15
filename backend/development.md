# General
* tests are separated into `tests/unit` which are quick to run with mocks, and `tests/integration` which are heavyweight multi-process tests
  * when adding new functionality, try to add both unit tests and integration tests
  * there are additionally `tests/largeE2E` -- you are not expected to run or modify these during regular work, those are for releases
* project is managed by `uv` -- utilize that for running any python-related subcommands like `uv run pytest` or `uv run ty`
* utilize `just` for command running -- `just val` is the "all typechecking and testing". Always run this prior to a commit, as well as utilizing pre-commit with prek
  * during development, utilize granular validation -- first, run type checking, then unit tests for the code you have created or changed, then all integration tests
* when you are creating a new package in backend/packages, initialize it with uv, add it to the backend/pyproject.toml workspace listing, and create there a basic justfile with the `val` recipe. When filling the `justfile` and the `pyproject.toml`, use the existing packages as templates
* 

# General Code Guidelines
* always use type annotations -- it is enforced
  * when working with a package with insufficient typing coverage like sqlalchemy, use `ty:ignore` comment
  * when `ty` is not powerful enough, use `ty:ignore `
  * use `typing.cast` when the code logic is implicitly erasing the type information
* prioritize using pydantic.BaseModel or dataclasses.dataclass object for capturing contracts and interfaces.
  * ideally keep them plain, stateless, frozen, without functions -- we end up serializing those objects often over to other python processes or different languages
  * for simple immutable data transfer objects, use `@dataclass(frozen=True, eq=True, slots=True)` directly for best type checker support -- provides immutability, hashability, and memory efficiency via slots. We set `eq=True` explicitly, despite being a default, for clarity.
  * a convenience decorator `frozendc` exists in `forecastbox.utility.structural` but direct decorator syntax is preferred for type safety
  * when using a primitive type in a semantically restricted context, utilize typing.NewType -- for example, dont do `user_id: str` but `UserId = typing.NewType("UserId", str); user_id: UserId`, because not every string is a valid UserId. This prevents a mixture of ids and gives a stronger type validity
* use comments sparingly, for non-obvious code only. Add docstrings to functions called from other modules only. When adding docstring, use compact style -- dont separate out Args and Returns, describe everything in one or two paragraphs.
* all imports belong to top level of the file, dont import inside function definitions unless necessiated by runtime. Dont alias imports unless there is a name collision
* never use python keywords and builtins as variable names -- for example, don't use `id` variable, prefer `id_<something>` or `id_`

# High Level Code Organization and Placement
When adding new code, make sure you place it in the right submodule:
* routes: *all* backend routes are declared here. There is autodiscovery mechanism, do _not_ make submodules here; only declare routes in `routes/*.py` files.
  * when making changes to any code in the routes submodule, consult `routes/__init__.py` docstring!
* schemata: *all* database schemata, ie, ORM classes, are declared here. There is autodiscovery mechanism, do _not_ make submodules here; only declare schemata in `routes/*.py` files.
  * do not declare any functions in these files, only the ORM classes themselves
* domain: the domain entities, related service functions, database helpers, domain dataclasses, et cetera. Most of the business logic lives here. Consult each domain's docstring in `__init__.py` to understand its role. When making *any* change to a code in a domain, consult the docstring to see if you need to make a change in the docstring itself.
  * within domain submodules there is often a `db.py` which contains helper functions to operate on top of ORMs from schemata. This module is always expected to handle automated version increments when mutating versioned entities, and to enforce authorization.
* utility: code that can be utilized across domains, that is, helper functions operating primarily on standard library constructs
  * there is one exception: utility/config.py, which is containing a lot of domain-specific code. We chose to place it in `utility` to have all config centralized and available to the whole application. 
* entrypoint: code related to bootstrapping the FastAPI backend itself, including self-checks, config management, logging setup, et cetera.
  * there are utility-like functions here as well -- when deciding whether to add here or to top-level utility module, consider whether its entrypoint-only or of plausible usage to domains as well

Make sure you don't break importing hierarchies: utility < schemata < domain < routes < entrypoint.
There are additional rules for hierarchy within domains -- when you change imports in a particular domain, consult its docstring to understand if that is allowed.

# Backwards Compatibility
This application is deployed at multiple machines owned by users, over which we have no control. Changes you make need to preserve compatibility:
* when adding new fields to config.py, make sure they contain defaults -- we need to be backwards compatible wrt users configs. Do not change existing fields -- there are currently no means for migrations.
* there is currently no mechanism for handling migrations -- do not change existing classes in the schemata module. You can add new classes
* when changing anything in the `routes` submodule, consult its docstring for mandatory guidelines

# Concurrency Considerations
There is currently async loop which serves all the requests to the FastAPI app, as well as multiple background threads created in various domains: scheduler thread, plugin thread, artifact thread. Particular care must be paid to handling things correctly

* sqlite, the current persistence layer, supports only one concurrent writer -- thats why we have async Lock in the `utility/db.py` module, and this lock governs all database access. Eventually we'll allow concurrent reads as those are allowed by sqlite. When doing database access, you *must* respect this lock, as all existing `db.py` subdomules across domains do.
  * this is particularly interesting in the background threads which don't run in the async loop -- for now, all such threads receive a reference of the loop, and submit their database access there. When implementing a new background thread, it is critical you utilize this pattern.
* multiple state structures are updated via the background threads, but consumed by the async loop -- to achieve synchronization, we rely on immutable data structures from the `pyrsistent` package. All concurrently accessed state is declared as pyrsistent structure, reads are lock-free, and the lock only needs to provide for atomic swap after updates. When working with shared state, make sure you utilize this pattern -- see `Manager` classes in plugin or artifact domains.
* sometimes a request to the FastAPI app triggers a possibly long operation, which we offload to the default thread pool executor registered to asyncio -- for example, submitting a Run domain entity. It is imperative that all such operations are fully wrapped in a try-catch block, and any error manifests by updating the database state with the respective error message.
