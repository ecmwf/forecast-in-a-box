# Goal
Add the read-side and rerun semantics for `JobExecution`, including latest-attempt defaults and attempt-aware restart behavior.

## Scope
- Add v2 job read endpoints, recommended set:
  - `GET /api/v1/job/status_v2`
  - `GET /api/v1/job/{job_id}/status_v2`
  - `GET /api/v1/job/{job_id}/outputs_v2`
  - `GET /api/v1/job/{job_id}/specification_v2`
  - `POST /api/v1/job/{job_id}/restart_v2`
- Accept optional `attempt_count` on single-execution reads; default to latest attempt.
- Make `restart_v2` create a new `JobExecution` attempt under the same logical `id`.
- For specification reads, return the linked `JobDefinition` payload or compiled spec in a way that supports re-execution and debugging.
- Keep v1 job read endpoints unchanged.
- Current `forecastbox.api.execution.execute_v2` method inserts into v1 jobs table, so that it can be polled/retrieved using v1 endpoints -- you can now remove that, since you will repalce that polling/retrieval with the new endpoints you are adding.

## Main files
- `backend/src/forecastbox/api/routers/job.py`
- `backend/src/forecastbox/api/execution.py`
- jobs2 db helpers and schema
- focused unit tests around latest-attempt resolution

## Validation
- Status and outputs can be read for the latest attempt without explicitly passing `attempt_count`.
- `restart_v2` increments attempt count and keeps lineage to the same definition.
- A copied v2 integration test covers submit -> wait -> inspect -> restart.
- `cd backend && uv run ty check`
- `cd backend && uv run pytest tests/unit -k latest_attempt`
- `cd backend && uv run pytest tests/integration -k submit_job_v2_read`
- At the very end run `cd backend && just val`.

## Non-goals
- No endpoint deletion
- No frontend migration
