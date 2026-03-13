# Goal
Add a v2 execution write path that always creates a `JobExecution` and can either link to an existing `JobDefinition` or materialize a one-off definition first.

## Scope
- Add `POST /api/v1/job/execute_v2`.
- Introduce a request model that supports both:
  - executing an existing `JobDefinition` reference, and
  - executing a raw `ExecutionSpecification` by first persisting a `source=oneoff_execution` `JobDefinition`
- Reuse the current `forecastbox.api.execution` submission path as much as possible.
- Persist a `JobExecution` row before/after submission with runtime fields separated from definition fields.
- Store `cascade_job_id` / `cascade_proc` separately from the logical execution id.
- Keep `/job/execute` unchanged.

## Main files
- `backend/src/forecastbox/api/routers/job.py`
- `backend/src/forecastbox/api/execution.py` or a small v2 companion module
- jobs2 execution helpers and API type models

## Validation
- Submitting a raw `ExecutionSpecification` through `execute_v2` creates both a one-off `JobDefinition` and a linked `JobExecution`.
- Submitting a saved `JobDefinition` reference through `execute_v2` links the execution to the existing definition instead of cloning it.
- Use the stable raw-job patterns from `tests/integration/test_submit_job.py` for focused v2 validation.
- `cd backend && uv run ty check`
- `cd backend && uv run pytest tests/integration -k submit_job_v2_execute`
- At the very end run `cd backend && just val`.

## Non-goals
- No restart / rerun semantics yet
- No non-blocking execution redesign
