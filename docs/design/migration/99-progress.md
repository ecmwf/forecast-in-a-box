# Backend migration progress

Update only the row for the step you worked on. Keep summaries short and factual.

| Step | Status | Summary |
| --- | --- | --- |
| `01-prune_obsolete_code_and_migration` | done | Removed `GlobalDefaults` ORM class and helpers, deleted `db/migrations.py`, removed `forecastbox.models` and `forecastbox.products` packages, deleted corresponding unit tests, removed migration call from entrypoint. |
| `02-reorganize_top_level_packages` | done | Created `utility/`, `domain/`, `routes/`, `schemata/`, `entrypoint/` package skeletons. Moved `config.py` → `utility/config.py`, `rjsf/` → `utility/rsjf/`, `auth/` → `entrypoint/auth/`, `standalone/` → `entrypoint/bootstrap/`. Converted `entrypoint.py` to `entrypoint/__init__.py` (preserving `forecastbox.entrypoint:app` uvicorn string). Updated all internal imports across src and tests. |
| `03-extract_definition_domain` | done | Created `domain/definition/` with `exceptions.py` (DefinitionNotFound, DefinitionAccessDenied), `db.py` (JobDefinition CRUD + ActorContext auth; uses `db.jobs.async_session_maker` via module reference), and `service.py` (validate_expand, compile_builder, save_builder, load_builder, compile_definition, moved from `api.fable`). Removed JobDefinition write functions from `db/jobs.py`; kept `get_job_definition` as thin proxy for execution/scheduling callers. Updated `api/fable.py` to re-export from service; updated `api/routers/fable.py` to use service + translate domain exceptions to HTTP. Updated unit tests to use `definition_db` with ActorContext, added ownership/admin auth tests. |
| `04-extract_experiment_domain` | pending |  |
| `05-extract_execution_domain` | pending |  |
| `06-create_canonical_entity_routes` | pending |  |
| `07-reorganize_support_routes` | pending |  |
| `08-switch_entrypoint_to_discovery` | pending |  |
