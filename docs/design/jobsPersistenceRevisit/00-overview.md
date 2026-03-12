# Jobs persistence revisit implementation plan

## Problem
`docs/design/jobsPersistenceRevisit.md` asks for a staged refactor from the current single mutable `job.db` model to a new immutable/versioned jobs persistence model. The rollout must keep v1 endpoints alive, avoid frontend changes, and keep each step independently validatable.

## Current state observed in the codebase
- Database config currently exposes only `sqlite_userdb_path` and `sqlite_jobdb_path` in `backend/src/forecastbox/config.py`.
- Backend startup in `backend/src/forecastbox/entrypoint.py` auto-discovers top-level modules under `forecastbox.db` and calls `create_db_and_tables()` if present.
- Current persistence is split across three unrelated table groups inside `job.db`:
  - jobs: `backend/src/forecastbox/schemas/job.py` + `backend/src/forecastbox/db/job.py`
  - saved fables: `backend/src/forecastbox/schemas/fable.py` + `backend/src/forecastbox/db/fable.py`
  - schedules: `backend/src/forecastbox/schemas/schedule.py` + `backend/src/forecastbox/db/schedule.py`
- Current routers map directly to those tables:
  - `backend/src/forecastbox/api/routers/fable.py`
  - `backend/src/forecastbox/api/routers/job.py`
  - `backend/src/forecastbox/api/routers/schedule.py`
- Scheduler runtime is still v1-only and reads `ScheduleDefinition`, `ScheduleNext`, `ScheduleRun` via `backend/src/forecastbox/api/scheduling/scheduler_thread.py` and `job_utils.py`.
- Integration tests boot a real backend with temp sqlite files under `FIAB_ROOT` via `backend/tests/integration/conftest.py`, which makes them a good harness for staged rollout checks.
- Backend validation command is `cd backend && just val`.

## Architecture decisions for this rollout
- Add a third database setting, recommended name: `sqlite_jobs2db_path`, defaulting to `~/.fiab/jobs2.db`. Do not reuse `job.db`.
- Keep naming aligned with the repo and use `forecastbox.schemas.jobs2`, not a brand-new `schemata` package. The design doc says `schemata`, but the codebase is already standardized on `schemas`.
- Implement the new persistence layer as a `forecastbox.db.jobs2` package which exposes `create_db_and_tables()`. That lets existing startup auto-discovery create the v2 database without special router logic.
- Keep v1 tables, db modules, routers, and frontend behavior untouched throughout this sequence.
- Use `_v2` at the endpoint leaf level. For routes that currently terminate at `/{id}`, use explicit leafs such as `/{id}/get_v2` or `/{id}/update_v2`, because a bare-path suffix does not compose cleanly.
- Hide version/attempt composite keys behind API defaults where possible: `version` should default to latest, and `attempt_count` should default to latest for read endpoints.
- `JobExecution` should own runtime state and store internal execution identity separately from `cascade_job_id` / `cascade_proc`.
- Add the `GlobalDefaults` table now for schema completeness, but leave behavior unused in this rollout.
- Add a mutable `ExperimentNext`-style table alongside immutable `ExperimentDefinition`; do not force next-run state into immutable rows.
- Support both saved definitions and one-off execution. The v2 execution API should be able to link to an existing `JobDefinition` or materialize a `source=oneoff_execution` definition from a raw `ExecutionSpecification`, because current integration tests and non-fable flows still submit raw specs.
- Soft-delete columns belong in the new schema from day one, but garbage collection behavior remains out of scope.

## Baseline validation note
`cd backend && just val` currently passes typing and unit tests, but the repo baseline is not fully green: integration fails in `tests/integration/test_fable.py::test_fable_contruction` and `tests/integration/test_submit_job.py::test_submit_job`. The first failure is an existing runtime execution problem (`capacity exceeded` in the ECMWF-source flow), and the second is a downstream assertion failure caused by the leftover errored job in the shared integration session. Implementation work should still run `just val`, but each step below also names focused validation so regressions can be judged accurately even while the baseline is noisy.

## Planned implementation sequence
1. `01-add-jobs2-db-plumbing.md`
2. `02-add-jobs2-schema-and-crud.md`
3. `03-add-fable-save-and-retrieve-v2.md`
4. `04-add-fable-compile-v2.md`
5. `05-add-job-execute-v2.md`
6. `06-add-job-read-and-rerun-v2.md`
7. `07-add-schedule-persistence-v2.md`
8. `08-add-scheduler-runtime-and-runs-v2.md`

## Cross-cutting notes for implementers
- Reuse the existing async DB pattern from `forecastbox.db.core` (`dbRetry`, `addAndCommit`, `executeAndCommit`, `querySingle`, `queryCount`).
- Preserve current serialization style: JSON payloads are stored in sqlite and converted at the API/db boundary using Pydantic models.
- Keep new test coverage parallel to v1. Prefer new `*_v2` integration test files instead of mutating v1 tests.
- Do not add frontend work, delete v1 endpoints, or attempt migration of old `job.db` data in this sequence.
- Prefer stable test inputs for v2 execution coverage. In particular, copy the simple raw-job patterns from `tests/integration/test_submit_job.py` for v2 execution checks instead of depending only on the open-data fable path.
