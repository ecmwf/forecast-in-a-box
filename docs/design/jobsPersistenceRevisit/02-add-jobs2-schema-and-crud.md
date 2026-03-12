# Goal
Create the new persistence model and DB helpers behind the new database, including composite keys, soft delete, and latest-version / latest-attempt lookup helpers.

## Scope
- Add a new schema package, recommended layout: `backend/src/forecastbox/schemas/jobs2.py`.
- Add ORM models for:
  - `JobDefinition`
  - `ExperimentDefinition`
  - `JobExecution`
  - `GlobalDefaults`
  - `ExperimentNext` (or similarly named mutable next-run table)
- Include required metadata fields (`id`, `created_by`, `created_at`) plus `updated_at` on mutable rows.
- Model composite keys exactly where the design requires them:
  - `JobDefinition`: `(id, version)`
  - `ExperimentDefinition`: `(id, version)`
  - `JobExecution`: `(id, attempt_count)`
- Add db helpers under `backend/src/forecastbox/db/jobs2.py` for insert/get/latest-version/latest-attempt/list/update-runtime/soft-delete.
- Prefer compatibility-first payload columns: store builder/spec/runtime context JSON directly instead of over-normalizing.

## Main files
- `backend/src/forecastbox/schemas/jobs2.py`
- `backend/src/forecastbox/db/jobs2.py`
- `backend/src/forecastbox/db/core.py` only if a small shared helper is truly needed

## Validation
- Tables are created in `jobs2.db` with the expected keys and foreign-key relationships.
- DB helpers can resolve “latest version” and “latest attempt” deterministically.
- Soft-delete helpers exclude deleted rows from normal reads.
- `cd backend && uv run ty check`
- `cd backend && uv run pytest tests/unit -k jobs2`
- If baseline noise is resolved on the branch, also run `cd backend && just val`.

## Non-goals
- No router changes yet
- No garbage collector behavior
- No GlobalDefaults business logic beyond schema + storage
