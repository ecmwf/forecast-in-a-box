# Goal
Introduce a dedicated `jobs2.db` and make backend startup create it automatically, without affecting the existing `user.db` and `job.db` paths.

## Scope
- Add `sqlite_jobs2db_path` to `backend/src/forecastbox/config.py` with a backwards-compatible default.
- Create a new `backend/src/forecastbox/db/jobs2.py` package which exposes `create_db_and_tables()`.
- Keep startup auto-discovery working; only touch `backend/src/forecastbox/entrypoint.py` if the package is not discovered cleanly.
- Do not add any v2 API behavior yet.

## Main files
- `backend/src/forecastbox/config.py`
- `backend/src/forecastbox/db/jobs2.py`
- `backend/src/forecastbox/entrypoint.py` only if needed
- focused startup test(s)

## Validation
- Booting the backend with the existing integration fixture creates `jobs2.db` under the temp `FIAB_ROOT`.
- Existing startup still creates `user.db` and `job.db`.
- `cd backend && uv run ty check`
- `cd backend && uv run pytest tests/integration -k jobs2_startup`
- At the very end, run `cd backend && just val`.

## Non-goals
- No new tables beyond the bootstrap needed for startup
- No v2 endpoints
- No migration logic for existing databases
