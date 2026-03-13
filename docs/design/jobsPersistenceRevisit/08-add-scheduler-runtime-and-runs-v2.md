# Goal
Make the scheduler and schedule run read-model work against v2 persistence so scheduled executions create `JobExecution` rows linked to `ExperimentDefinition`.

## Scope
- Add v2 scheduler helpers parallel to the current `schedule2runnable` / `run2runnable` flow.
- Teach the scheduler thread to consume v2 experiment rows without breaking the current v1 scheduler path.
- Add a v2 runs endpoint, recommended: `GET /api/v1/schedule/{experiment_id}/runs_v2`.
- Represent reruns vs normal cron runs in `JobExecution` runtime context instead of a dedicated `ScheduleRun` table.
- Make v2 schedule run reads join experiment metadata with linked `JobExecution` rows.
- Add focused unit tests for the experiment-to-runnable conversion and targeted integration coverage for the v2 read model.

## Main files
- `backend/src/forecastbox/api/scheduling/job_utils.py` or a v2 companion module
- `backend/src/forecastbox/api/scheduling/scheduler_thread.py`
- `backend/src/forecastbox/api/routers/schedule.py`
- jobs2 experiment/execution helpers

## Validation
- The scheduler can derive runnable work from `ExperimentDefinition` + `ExperimentNext`.
- Scheduled executions produce `JobExecution` rows linked back to the originating experiment.
- `runs_v2` can distinguish normal scheduled runs from reruns using runtime context.
- `cd backend && uv run ty check`
- `cd backend && uv run pytest tests/unit -k experiment_runnable`
- `cd backend && uv run pytest tests/integration -k schedule_v2_runs`
- At the very end run `cd backend && just val`.

## Non-goals
- No garbage collection
- No batch experiments or external-trigger experiments
- No frontend migration
