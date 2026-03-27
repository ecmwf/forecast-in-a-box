# Backend migration progress

Update only the row for the step you worked on. Keep summaries short and factual.

| Step | Status | Summary |
| --- | --- | --- |
| `01-prune_obsolete_code_and_migration` | done | Removed `GlobalDefaults` ORM class and helpers, deleted `db/migrations.py`, removed `forecastbox.models` and `forecastbox.products` packages, deleted corresponding unit tests, removed migration call from entrypoint. |
| `02-reorganize_top_level_packages` | pending |  |
| `03-extract_definition_domain` | pending |  |
| `04-extract_experiment_domain` | pending |  |
| `05-extract_execution_domain` | pending |  |
| `06-create_canonical_entity_routes` | pending |  |
| `07-reorganize_support_routes` | pending |  |
| `08-switch_entrypoint_to_discovery` | pending |  |
