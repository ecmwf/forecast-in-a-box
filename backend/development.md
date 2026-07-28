# General
* tests are separated into `tests/unit` which are quick to run with mocks, and `tests/integration` which are heavyweight multi-process tests
  * when adding new functionality, try to add both unit tests and integration tests
  * there are additionally `tests/largeE2E` -- you are not expected to run or modify these during regular work, those are for releases
* project is managed by `uv` -- utilize that for running any python-related subcommands like `uv run pytest` or `uv run ty`
* utilize `just` for command running -- `just val` is the "all typechecking and testing". Always run this prior to a commit, as well as utilizing pre-commit with prek
  * during development, utilize granular validation -- first, run type checking, then unit tests for the code you have created or changed, then all integration tests
  * don't change formatting on a whim. When you notice a bug or breach of guidelines that is not related or affecting your current task, ignore it.
* when you are creating a new package in backend/packages, initialize it with uv, add it to the backend/pyproject.toml workspace listing, and create there a basic justfile with the `val` recipe. When filling the `justfile` and the `pyproject.toml`, use the existing packages as templates
* 

# General Code Guidelines
* always use type annotations -- it is enforced
  * when working with a package with insufficient typing coverage like sqlalchemy, use `ty:ignore` comment
  * when `ty` is not powerful enough, use `ty:ignore `
  * use `typing.cast` when the code logic is implicitly erasing the type information
* prioritize using pydantic BaseModel or dataclasses.dataclass object for capturing contracts and interfaces.
  * when using pydantic, use `FiabBaseModel` from `forecastbox.utility.pydantic` (or `FiabCoreBaseModel` from `fiab_core.pydantic_utils` in fiab-core) instead of `pydantic.BaseModel` directly, unless the model requires dynamic field handling (e.g., `extra="allow"` for JSON Schema types). These base models set `extra="forbid"` to catch misconfigured constructors early. If you need the dynamic model handling, mark it clearly with a comment.
  * ideally keep them plain, stateless, frozen, without functions -- we end up serializing those objects often over to other python processes or different languages
    * having a few methods that provide convenience views, ser/de, validation, conversion does not necessarilly hurt -- its primarily about keeping the codebase generally functional and data-oriented rather than object-oriented.
  * for simple immutable data transfer objects, use `@dataclass(frozen=True, eq=True, slots=True)` directly for best type checker support -- provides immutability, hashability, and memory efficiency via slots. We set `eq=True` explicitly, despite being a default, for clarity.
  * a convenience decorator `frozendc` exists in `forecastbox.utility.structural` but direct decorator syntax is preferred for type safety
  * when using a primitive type in a semantically restricted context, utilize typing.NewType -- for example, dont do `user_id: str` but `UserId = typing.NewType("UserId", str); user_id: UserId`, because not every string is a valid UserId. This prevents a mixture of ids and gives a stronger type validity
* use comments sparingly, for non-obvious code only. Add docstrings to functions called from other modules only. When adding docstring, use compact style -- dont separate out Args and Returns, describe everything in one or two paragraphs. Do not make two spaces after a dot.
* all imports belong to top level of the file, dont import inside function definitions unless necessiated by runtime
* dont alias in imports unless there is a name collision, or unless its a standard shortcut: `datetime as dt`, `multiprocessing as mp`, `numpy as np`, `xarray as xr`, `earthkit.data as ekd`
* never use python keywords and builtins as variable names -- for example, don't use `id` variable, prefer `id_<something>` or `id_`

# High Level Code Organization and Placement
When adding new code, make sure you place it in the right submodule:
* routes: *all* backend routes are declared here. There is autodiscovery mechanism, do _not_ make submodules here; only declare routes in `routes/*.py` files.
  * when making changes to any code in the routes submodule, consult `routes/__init__.py` docstring!
* schemata: *all* database schemata, ie, ORM classes, are declared here. There is autodiscovery mechanism, do _not_ make submodules here; only declare schemata in `routes/*.py` files.
  * do not declare any functions in these files, only the ORM classes themselves, and the function related to discovery: `create_db_and_tables`
* domain: the domain entities, related service functions, database helpers, domain dataclasses, et cetera. Most of the business logic lives here. Consult each domain's docstring in `__init__.py` to understand its role. When making *any* change to a code in a domain, consult the docstring to see if you need to make a change in the docstring itself.
  * within domain submodules there is often a `db.py` which contains helper functions to operate on top of ORMs from schemata. This module is always expected to handle automated version increments when mutating versioned entities, and to enforce authorization.
    * no ORM object may cross the `db.py` module boundary -- convert query results into a plain dataclass (e.g. `RunRecord`) before returning. Sessions, active result objects, and lazy-loaded attributes must never be handed to callers; materialize everything the caller needs before the session closes.
* utility: code that can be utilized across domains, that is, helper functions operating primarily on standard library constructs
  * an exception is utility/config.py, which is containing a lot of domain-specific code. We chose to place it in `utility` to have all config centralized and available to the whole application.
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
There is currently async loop which serves all the requests to the FastAPI app, as well as multiple background threads: scheduler thread, plugin thread, artifact thread, event dispatcher, database garbage collector. Particular care must be paid to handling things correctly

* sqlite, the jobs persistence layer, supports only one concurrent writer -- jobs-database access is synchronous and serialized by a `threading.RLock` in `utility/db.py` (`dbRetry`/`dbLock`). Every `db.py` helper across domains is a synchronous, operation-local function that acquires this lock internally; it never submits itself to a pool. Concurrent reads are deferred to a later iteration -- see the TODO comment beside the lock.
  * async code (routes, services) must never call a jobs `db.py` helper directly -- submit the whole helper call through `execution_manager.await_jobs_db()` (backed by the single-worker `ConcurrentPools.JobsDb` pool). Synchronous code (background threads, pool workers) calls the helper directly, on its own thread, without touching the event loop.
  * the users database (`domain/auth/db.py`) is a separate, independent concern -- it keeps its own async lock/retry helper and remains fully async via aiosqlite. Do not mix jobs-database and users-database locking.
  * a read-modify-write sequence with business logic in between must be split into two separate locked callables (two lock acquisitions), rather than one callable holding the lock across the business logic.
* multiple state structures are updated via the background threads, but consumed by the async loop -- to achieve synchronization, we rely on immutable data structures from the `pyrsistent` package. All concurrently accessed state is declared as pyrsistent structure, reads are lock-free, and the lock only needs to provide for atomic swap after updates. When working with shared state, make sure you utilize this pattern -- see `Manager` classes in plugin or artifact domains.
* threads and thread pools must not be created ad hoc. Use the central `ExecutionManager` (`utility/concurrency/manager.py`, module-level `execution_manager` instance) for both named bounded pools (`ConcurrentPools`) and long-lived threads (`ConcurrentThreads`) -- register at startup with a stage, submit work with `submit_monitored`/`submit_unmonitored`/`awaitable_submit`/`submit_after`, and provide a non-blocking component status. Do not instantiate `ThreadPoolExecutor` or `threading.Thread` directly in domain code.
  * some pre-existing background threads (e.g. scheduler, plugin updater, run background submission) still use ad hoc, pre-manager thread creation rather than the manager -- this is known technical debt, not a pattern to copy for new code.
  * for one-to-many, loosely coupled reactions (crossing or reversing the usual dependency hierarchy), use the process-local event dispatcher (`utility/dispatcher.py`) instead of a direct call or a new thread -- producers publish an immutable `Event` and never import consumers; the entrypoint discovers and wires handlers via each domain's optional `dispatchers.py`.
  * for a linear workflow where the next step just needs a different pool/lock, prefer `execution_manager.submit_after` (a non-blocking continuation) over the event bus -- the event bus is not a substitute for an ordinary same-direction function call.
* sometimes a request to the FastAPI app triggers a possibly long operation, which we offload to a named `ExecutionManager` pool -- for example, submitting a Run domain entity. It is imperative that all such operations are fully wrapped in a try-catch block, and any error manifests by updating the database state with the respective error message.
* common cross-domain utility exceptions (e.g. `ExecutionManagerError` and its subclasses, `NoFreePortsException`) must get a registered FastAPI exception handler -- see `utility/fastapi.register_common_exception_handling`, wired once in `entrypoint/app.py` -- rather than being handled ad hoc in every route that might raise them.
