"""
Declaration of all backend routes for the FastAPI app defined in the top level entrypoint module.
Make sure *all* routes are declared in a router in a file in this module, not in a submodule -- otherwise the autodiscovery registration would not see them.

Guidelines:
* each route module should declare their own classes for Request and Responses, to provide stablility to the clients and prevent internal refactoring causing contract change
  * do not change the existing classes, unless part of an effort that simulatenously changes the client codebases.
    * when there is such a change, ideally keep to /api/v1 and make simultaneous change to the frontend. Use /api/v2 only sparringly and temporarily
  * there are a few places where classes declared in the `domain` modules are utilized directly by `routes`. Those are explicitly marked in the code. Do not change those classes. Do not add new such classes unless having a very good reason.
  * the contract is always materialized as a dedicated self-contained pydantic class, which always contains at a minimum key+version, any foreign keys, and the created/updated
  * the contract follows encapsulation -- for example, a pair (id, version) is a subclass, both in request and response
  * the contract semantically distinguishes -- BlueprintId(uuid, int) and RunId(uuid, int) are two distinct classes, despite both having the same primitive type signature
  * for enum-like fields, the contract explicitly lists the values (either as typing.Literal, or enum.Enum -- the former is generally preferred)
  * utility classes like PaginationSpec are also encapsulated, but since they are generic all endpoints use the same class
* most route modules handle particular domains, as defined in their docstring. When adding new routes, always consult the module docstring
  * some route modules additionally contain operational routes (statuses, restarts), utility routes (authorization), etc
* many routes provide basic CRUD operations on user-managed Domain Entities, such as Blueprint, Run, Experiment. These Domain Entities share some common traits:
  * each has its own Id, consisting of uuid + version. Version can be omitted in GET requests, which defaults to latest version
  * each is immutable -- a POST for update creates a new version of that entity. These requests must specify version to guarantee consistency
  * deletion is tombstone-based, ie, we mark the entity as deleted with an internal flag, and only later it is collected
  * CRUD endpoints have standard names: create, get, list, delete, update; which have a similar signature, eg, Paging parameters for the list
  * every domain entity contains `created_at`, `updated_at`, `user` fields, which pertain to creation (and cannot be updated via API).
    * `created_at` always refers to the first version of the entity, `updated_at` to the creation time of the referred version (ie, latest if omitted)
* the second type of Domain Entity backend-managed, and contains eg Run, a reflection of backend's internal computation. As such, it is not versioned but backend internally mutates it, but user cannot create or update or delete. Other backend-managed entity examples are Artifact and Plugin -- those are reflections of persisted state of which plugins are installed and which artifacts are downloaded, and similarly to Runs the operations by the user are not a full CRUD control
* when adding new Domain Entity, make a decision based on context whether its user-managed or backend-managed, then use existing entities and their routes as templates and follow the same patterns
* we never use path parameters in routes -- to prevent misrouting, long url trimming and normalization, etc
  * the *only* exception is the `routes/admin.py`, where the `{user_id}` in routes is an accepted non-domain convention
* each route module is additionally responsible for converting Exception classes from domain submodules into concrete HttpExceptions + codes
"""
