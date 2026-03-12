# Goal
Add v2 schedule persistence backed by `ExperimentDefinition` and `ExperimentNext`, without changing the existing schedule router behavior.

## Scope
- Add v2 schedule endpoints with explicit leaf names, recommended set:
  - `PUT /api/v1/schedule/create_v2`
  - `GET /api/v1/schedule/list_v2`
  - `GET /api/v1/schedule/{experiment_id}/get_v2`
  - `POST /api/v1/schedule/{experiment_id}/update_v2`
  - `GET /api/v1/schedule/{experiment_id}/next_run_v2`
- On create, persist a `JobDefinition` for the static execution payload (if one does not already exist for the request flow) and then persist an `ExperimentDefinition` with `experiment_type=cron_schedule`.
- Persist the next scheduled time in the mutable `ExperimentNext` table.
- Reuse the existing cron parsing and next-run calculation helpers where possible.
- Keep v1 schedule endpoints unchanged.

## Main files
- `backend/src/forecastbox/api/routers/schedule.py`
- `backend/src/forecastbox/api/types/scheduling.py` or v2 companion types
- `backend/src/forecastbox/api/scheduling/dt_utils.py`
- jobs2 experiment helpers

## Validation
- A v2 schedule can be created, fetched, listed, updated, and queried for next run without touching v1 tables.
- Updating cron or enabled state regenerates `ExperimentNext` correctly.
- A copied v2 integration test mirrors the stable CRUD/list/next-run checks from `tests/integration/test_schedule.py`.
- `cd backend && uv run ty check`
- `cd backend && uv run pytest tests/integration -k schedule_v2_persistence`
- If baseline noise is resolved on the branch, also run `cd backend && just val`.

## Non-goals
- No scheduler-thread execution yet
- No schedule rerun endpoint unless needed by the next step
