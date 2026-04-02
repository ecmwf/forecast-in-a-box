# Backend API and routes
- resides in /api/v1
- provides CRUD-like functionality for domain entities (JobExecution, JobDefinition, ExperimentDefinition, JobOptionDefaults...)
- organized into main subrouters: execution/, definition/, experiment/
- each domain entity is keyed by its own Id and (optionally) a Version. In every operation Version can be omitted, defaulting to latest
- each domain entity exposes a `get(id, version)` and `list(?filter, pagination)` GET endpoints
- entities either reflect user activity (JobDefinition, ExperimentDefinition, JobOptionDefaults) or computation activity (JobExecution)
- user activity entities are internally immutable -- they do expose a POST update endpoint, but it creates a new entity with incremented version
  - the POST update accepts a mandatory version parameter which must equal to the most recent one, to guarantee atomicity
  - the POST update accepts a generic KV structure for updates. Unrecognized/unaccepted keys always cause the whole operation to fail
  - the POST delete endpoints allows for a delete, which is actually realized by setting `is_deleted` tombstone field to true
- computation activity entities are not versioned, and are mutated by the backend when they reflect computation change -- thus should not be cached. They cannot be mutated via the API
- we never use path parameters, to prevent misrouting, long url trimming and normalization, etc
- every domain entity contains `created_at`, `updated_at`, `user` fields, which pertain to creation (and cannot be updated via API).
  - `created_at` always refers to the first version of the entity, `updated_at` to the creation time of the referred version (ie, latest if omitted)
- the API-exposed contract always contains, at a minimum, key+version, any foreign keys, and the created/updated
  - the contract is always materialized as a dedicated pydantic class. This class is self contained, and not used in the rest of the backend code internally, to prevent accidental internal refactoring causing contract change
  - the contract follows encapsulation -- for example, the pair (id, version) is a subclass, both in request and response
  - the contract correctly sets nullability -- thus request and response classes for (id, version) must be different, as in request the version is nullable, but in response it is not
  - the contract semantically distinguishes -- thus JobExecutionIdRequest(id, version) and JobDefinitionIdRequest(id, version) are two distinct classes, despite both being `str, int|None` in primitive types
  - for enum-like fields, the contract explicitly lists the values (either as typing.Literal, or enum.Enum -- the former is generally preferred)
  - utility classes like PaginationSpec are also encapsulated, but since they are generic all endpoints use the same class
- routers related to domain entities additionally contain the following endpoints:
  - utility endpoints related to JobDefinition building -- those reside in definition/building/ subrouter, and utilize a JobDefinitionBuilder ephemeral class, which is eventually used as input to `definition/create` endpoint (that results in a JobDefinitionIdResponse)
  - operational endpoints related to experiments -- those reside in experiments/operational, and consist of eg `scheduler/restart`, `scheduler/current_time`
  - additional lookup GET endpoints related to experiments -- those reside in experiment/runs, consist of eg `list` or `next` and accept a single ExperimentIdRequest
  - operational endpoints related to job executions -- those reside in execution, and consist of create and restart
  - additional lookup GET endpoints related to job executions -- those reside in execution, provide more detail of a given execution (eg, outputAvailability, outputContent, definition, logs), and accept a single JobExecutionIdRequest
- environment management routers: artifacts/ and plugins/ -- those mix lookups (list, get) and operational commands (install, download, delete-uninstall), and mostly follow specific convention, except for basics like being self contained and isolated wrt contract pydantic classes
- admin and operational routers: admin, auth, gateway -- specific conventions only

# Backend Internals
There are 5 top level modules:
 - utility: domain independent functionality and concerns
 - routes: endpoints which the backend exposes
 - schemata: definition of sql alchemy models corresponding to domain entities
 - domain: specific functionality for domain entities
 - entrypoint: the bootstrapping module for starting the app

Notes:
 - the primary reason for exposing `routes` and `schemata` on the top level is that `entrypoint` automatically discovers tables to be created and routes to be exposed.
   - thus each table/router is expected to be at exactly 1-level of nesting under `routes`/`schemata`, exposed there in a module-level global `router` or `create_db_and_tables()`
   - routers contain endpoints and also the classes representing the contracts
 - entrypoint is not just a simple FastAPI's `app`-exposing file, it also deals with multiprocessing bootstrapping, self-verifying logic, logging config
   - it has its own utility submodules, which are not part of the top-level `utility`, because they would be of no use to `domain`
 - `domain` contains majority of business logic, separated roughly along the domain entity lines
   - code in `routes` is often a single call of a function from `domain`, with a translation of domain errors to HTTPExceptions
   - `domain` submodules typically contain a `db` submodules which handles storage and retrieval of entities from `schemata`
     - each `db` submodule handles automated version increments and validation of atomicity of updates
     - each `db` submodule handles authorization enforcement: entities whose `user` is None can only be affected when `user` of the post request (update/delete) is None or admin, entities whose `user` is not None can only be affected by the same user or admin
   - there are usually two classes representing a domain entity -- the ORM class from the `schemata` module, and a pydantic class utilized by the API endpoints
     - the ORM class is often utilized with a composition design pattern, that is, enriching/combination is handled by using the ORM class in a DTO dataclass, in a list, in a dict, ... instead of creating a new class or a child
     - the endpoint-exposed class is used minimally in the codebase, to prevent accidental contract changes. It is declared in the `routes` module, with a class factory method `from_db(e: DbEntity)`
     - instead of primitive types like `str` we use newtypes like `JobExecutionId = typing.NewType("JobExecutionId", str)` for safety andreadabily
 - `utility` is invoked from the `domain` module, and handles aspects like multiprocessing/futures -- anything shareable across multiple domains
 - generally the import/dependency order is as follows: (utility < schemata < domain < routes < entrypoint)
   - `utility.config` is a bit of an oddity -- while the config is mostly pertaining to domains, it needs to drive the selected behaviours in utility or schemata. We could have separated config, but we prefer a centralization under a single model. Or we could have introduced some sort of dependency injection to provide it to utility/schemata and move it to domain and register during endpoint, but that would weaken type safety and complicate -- so we accept this weakening of hierarchy-fitness

Tests are organized in three top level modules:
 - unit
 - integration
 - largeE2E
Where unit are single-process, mostly-mocking fast tests; integration spin up backend instance without any mock, and test it via regular http client, but invoke only trivial computations; and largeE2E comprises of actual workflows which can take tens of minutes to finish.
Regular development should rely primarily on type checking via `ty` and execution of first `unit` and then `integration` tests, as captured in the `val` recipe of the `justfile`.
The largeE2E are executed only manually on demand, prior to release or after large changes.
