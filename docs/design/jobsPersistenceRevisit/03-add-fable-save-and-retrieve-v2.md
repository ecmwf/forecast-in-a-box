# Goal
Add a v2 save/load path for persisted job definitions while leaving the current fable endpoints untouched.

## Scope
- Add `POST /api/v1/fable/upsert_v2`.
- Add `GET /api/v1/fable/retrieve_v2`.
- Persist saved fables as `JobDefinition` rows with `source=user_defined`.
- Store enough payload to reconstruct the current builder-oriented workflow: at minimum the builder JSON plus display metadata/tags/source/parent linkage fields needed by the new schema.
- Return an explicit `(id, version)` reference from save operations.
- Keep `/upsert` and `/retrieve` exactly as they are.

## Main files
- `backend/src/forecastbox/api/routers/fable.py`
- new/updated API type models under `backend/src/forecastbox/api/types/`
- `backend/src/forecastbox/db/jobs2.py`

## Validation
- A client can save a builder through `save_v2` and load the same payload back through `retrieve_v2`.
- Saving the same logical definition again creates a new version instead of mutating the old row.
- Existing `/fable/upsert` and `/fable/retrieve` behavior is unchanged.
- `cd backend && uv run ty check`
- `cd backend && uv run pytest tests/integration -k fable_v2_save`
- At the very end run `cd backend && just val`.

## Non-goals
- No compile behavior yet
- No frontend changes
- No block/config filtering features
